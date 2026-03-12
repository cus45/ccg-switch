# Team Research: macOS 自动更新后应用损坏修复

## 增强后的需求

**原始需求**：当前的获取最新的版本时，更新后，点击安装后，直接就退出了，然后 mac 点开后直接报错，无法使用，说已经损坏

**结构化需求**：
- **问题**：macOS 应用内自动更新后，应用无法启动，系统提示"已损坏"
- **用户确认**：使用 `sudo xattr -cr /Applications/CCG\ Switch.app` 可以修复，说明是**隔离属性**问题
- **目标**：修复自动更新安装流程，使更新后应用能正常启动
- **范围**：`src-tauri/src/services/updater_service.rs` 的 `install_update` 函数
- **验收标准**：
  1. 自动更新后应用能正常启动，无需手动执行 `xattr -cr`
  2. 复制应用到 `/Applications` 时保留正确的文件属性
  3. 保持跨平台兼容性（Windows/Linux 不受影响）

---

## 约束集

### 硬约束

- [HC-1] **`cp -R` 不保留扩展属性** — 来源：代码审查 + 用户反馈
  - `cp -R` 不保留 macOS 扩展属性（extended attributes）和资源分支
  - 会导致应用被标记为"已损坏"或无法启动
  - 用户确认 `sudo xattr -cr` 可以修复，证实是属性问题

- [HC-2] **macOS 隔离机制** — 来源：平台特性
  - 从网络下载的文件会被标记 `com.apple.quarantine` 属性
  - Gatekeeper 会检查此属性，首次打开时需要用户确认
  - 自动更新复制的应用不应继承隔离属性

- [HC-3] **必须使用条件编译** — 来源：现有代码模式
  - 使用 `#[cfg(target_os = "macos")]` 分隔平台逻辑
  - Windows/Linux 保持现有行为

- [HC-4] **复制后需要清理隔离属性** — 来源：问题分析
  - 即使用 `ditto` 复制，也可能需要显式移除隔离属性
  - 使用 `xattr -dr com.apple.quarantine` 清理

- [HC-5] **应用需要退出以完成更新** — 来源：现有逻辑
  - `lib.rs:602-607` 中 `install_update` 命令会调用 `app.exit(0)`
  - 新实现必须保持此行为

### 软约束

- [SC-1] **优先使用系统自带命令** — 来源：无额外依赖原则
  - 使用 `ditto`（macOS 自带）代替 `cp`
  - 或使用 `rsync`（需确认是否可用）

- [SC-2] **保持现有错误处理** — 来源：代码风格
  - 继续使用 `map_err(|e| format!(...))` 转换错误
  - 保持中文错误消息

- [SC-3] **保持前端 UI 不变** — 来源：最小化变更
  - `AboutPanel.tsx` 的状态机和事件监听已经完善
  - 只需修复后端复制逻辑

### 依赖关系

- [DEP-1] `install_update` → `lib.rs:602` 的 `install_update` 命令
  - Tauri 命令调用服务函数，然后调用 `app.exit(0)`
  - 服务函数返回错误会阻止 `app.exit()` 执行

- [DEP-2] `install_update` → 前端 `AboutPanel.tsx:handleInstall`
  - 前端通过 `invoke('install_update')` 调用
  - 错误会显示在 UI 中

### 风险

- [RISK-1] **`ditto` 不可用** — 缓解：`ditto` 是 macOS 自带命令，从 10.0+ 版本可用
- [RISK-2] **清理隔离属性需要权限** — 缓解：复制到 `/Applications` 本身就需要权限，清理属性在同一上下文
- [RISK-3] **某些系统配置可能阻止清理** — 缓解：捕获错误但不阻止安装，让用户手动处理

---

## 成功判据

- [OK-1] macOS 上自动更新后，应用能直接启动，无需 `xattr -cr`
- [OK-2] 复制到 `/Applications` 的应用具有正确的文件属性
- [OK-3] 隔离属性 `com.apple.quarantine` 已被移除
- [OK-4] Windows/Linux 平台行为不受影响
- [OK-5] 安装失败时有清晰的错误提示

---

## 技术方案

### 根本原因分析

```
问题链：
下载 .dmg → 挂载 → cp -R 复制 → 扩展属性丢失 → Gatekeeper 拒绝运行 → "已损坏"
```

`cp -R` 命令的问题：
1. **不保留扩展属性**：丢失 `com.apple.quarantine` 等属性
2. **不保留资源分支**：可能丢失应用元数据
3. **不保留文件标志**：可能丢失安全相关标志

### 推荐解决方案

**方案 A：使用 `ditto` 替代 `cp -R`**（推荐）

```rust
// 在 updater_service.rs 中修改 install_update 函数

#[cfg(target_os = "macos")]
{
    // ... 现有的挂载和查找 .app 代码 ...

    // 使用 ditto 代替 cp -R
    std::process::Command::new("ditto")
        .args([
            app_source.to_str().unwrap(),
            app_target.to_str().unwrap()
        ])
        .status()
        .map_err(|e| format!("复制应用失败: {}，请确保已授予写入 /Applications 的权限", e))?;

    // 清理隔离属性
    let _ = std::process::Command::new("xattr")
        .args(["-dr", "com.apple.quarantine", app_target.to_str().unwrap()])
        .status();

    // ... 其余代码 ...
}
```

**优势**：
- `ditto` 是 macOS 自带命令，无需额外依赖
- 自动保留扩展属性、资源分支和文件标志
- 支持进度显示（未来可扩展）

**方案 B：使用 `rsync`**（备选）

```rust
std::process::Command::new("rsync")
    .args(["-a", "--delete", app_source.to_str().unwrap(), app_target.to_str().unwrap()])
    .status()
    .map_err(|e| format!("复制应用失败: {}", e))?;
```

**优势**：跨平台可用
**劣势**：不确定是否在所有 macOS 环境可用

**方案 C：保留 `cp -R` + 事后清理属性**（不推荐）

```rust
// 先复制
std::process::Command::new("cp")
    .args(["-R", app_source.to_str().unwrap(), app_target.to_str().unwrap()])
    .status()?;

// 再清理属性
std::process::Command::new("xattr")
    .args(["-cr", app_target.to_str().unwrap()])
    .status()?;
```

**劣势**：`xattr -cr` 会清除**所有**扩展属性，可能影响应用功能

### 最终推荐

**使用 `ditto` + 清理 `com.apple.quarantine` 属性**

这是最安全、最符合 macOS 平台规范的方案。

---

## 代码修改位置

| 文件 | 行号 | 修改内容 |
|------|------|----------|
| `src-tauri/src/services/updater_service.rs` | ~270 | 将 `cp -R` 替换为 `ditto`，并添加清理隔离属性代码 |

---

## 上下文检查点

**当前上下文使用**：约 115k/200k tokens

**下一步**：研究完成，运行 `/clear` 后执行 `/ccg:team-plan macos-update-damaged-fix` 开始规划