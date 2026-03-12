# Team Research: macOS 更新安装权限问题修复

## 增强后的需求

**原始需求**：mac 安装更新有权限问题，修复下

**结构化需求**：
- **问题**：当前更新机制使用 `std::process::Command::new(file_path).spawn()` 直接启动安装程序，在 macOS 上对 `.dmg` 文件无效
- **目标**：实现 macOS 平台的自动更新安装流程
- **范围**：`src-tauri/src/services/updater_service.rs` 的 `install_update` 函数，以及前端 `AboutPanel.tsx` 的错误处理
- **验收标准**：
  1. macOS 上能正确处理 `.dmg` 文件的安装
  2. 使用 `hdiutil` 挂载镜像，复制 `.app` 到 `/Applications`
  3. 权限不足时显示详细错误信息
  4. 保持跨平台兼容性（Windows/Linux 不受影响）

---

## 约束集

### 硬约束

- [HC-1] **macOS .dmg 文件不可直接执行** — 来源：代码探索
  - `.dmg` 是磁盘镜像，必须先挂载才能访问内容
  - `std::process::Command::new(file_path).spawn()` 对 `.dmg` 无效

- [HC-2] **需要系统调用挂载 .dmg** — 来源：macOS 平台特性
  - 使用 `hdiutil attach <dmg_path>` 挂载
  - 挂载点通常在 `/Volumes/<镜像名>`

- [HC-3] **复制到 /Applications 需要管理员权限** — 来源：用户确认
  - 用户选择"自动挂载并复制"方案
  - 需要处理权限不足的情况

- [HC-4] **必须使用条件编译** — 来源：现有代码模式
  - 使用 `#[cfg(target_os = "macos")]` 分隔平台逻辑
  - Windows/Linux 保持现有行为

- [HC-5] **安装成功后应用需要退出** — 来源：现有逻辑
  - `lib.rs:602-607` 中 `install_update` 命令会调用 `app.exit(0)`
  - 新实现必须保持此行为

- [HC-6] **错误信息必须传递到前端** — 来源：用户确认
  - 用户选择"显示错误详情"
  - Rust `Result<(), String>` 的错误消息会显示在 UI

### 软约束

- [SC-1] **优先使用现有依赖** — 来源：Cargo.toml 审查
  - 无需添加新依赖（如 `dmg` crate）
  - 使用 `std::process::Command` 调用系统命令

- [SC-2] **保持现有 UI 流程** — 来源：前端代码审查
  - 不修改 `AboutPanel.tsx` 的状态机
  - 只需要确保错误消息正确传递

- [SC-3] **代码风格与项目一致** — 来源：代码库规范
  - 使用 `map_err(|e| format!(...))` 转换错误
  - 使用中英文双语注释（如需要）

### 依赖关系

- [DEP-1] `install_update` → `lib.rs:602` 的 `install_update` 命令
  - Tauri 命令调用服务函数，然后调用 `app.exit(0)`
  - 服务函数返回错误会阻止 `app.exit()` 执行

- [DEP-2] `install_update` → 前端 `AboutPanel.tsx:handleInstall`
  - 前端通过 `invoke('install_update')` 调用
  - 错误会显示在 `checkError` 状态中

### 风险

- [RISK-1] **权限不足导致安装静默失败** — 缓解：显示详细错误，提示用户手动操作
- [RISK-2] **hdiutil 挂载点不确定** — 缓解：解析挂载输出，或使用固定挂载路径
- [RISK-3] **多个 .app 包时选择错误** — 缓解：按 Release 名称匹配，或选择唯一的 .app
- [RISK-4] **卸载不完整导致磁盘空间泄漏** — 缓解：安装后执行 `hdiutil detach`

---

## 成功判据

- [OK-1] macOS 上点击"安装更新"后，.dmg 文件被正确挂载
- [OK-2] .app 包被复制到 `/Applications` 目录
- [OK-3] 安装完成后应用退出，新版本可用
- [OK-4] 权限不足时，UI 显示明确的错误提示
- [OK-5] Windows/Linux 平台行为不受影响
- [OK-6] 挂载的镜像被正确卸载（`hdiutil detach`）

---

## 开放问题（已解决）

### Q1: 对于 macOS 更新，你期望的安装体验是什么？
**用户回答**：自动挂载并复制
**约束**：[HC-2], [HC-3]

### Q2: 安装失败时，你希望如何处理？
**用户回答**：显示错误详情
**约束**：[HC-6]

---

## 技术实施提示

### 推荐实现方案

```rust
// 在 updater_service.rs 中修改 install_update 函数

#[cfg(target_os = "macos")]
{
    // 1. 使用 hdiutil attach 挂载 .dmg
    let mount_output = Command::new("hdiutil")
        .args(["attach", "-nobrowse", "-readonly", file_path])
        .output()?;

    // 2. 解析挂载点（从输出中提取 /Volumes/xxx）
    let mount_point = parse_mount_point(&mount_output.stdout);

    // 3. 复制 .app 到 /Applications
    let app_name = find_app_in_mount(&mount_point)?;
    let source = mount_point.join(&app_name);
    let target = Path::new("/Applications").join(&app_name);

    // 使用 rsync 或 cp -R 进行复制
    Command::new("cp")
        .args(["-R", &source.to_string_lossy(), &target.to_string_lossy()])
        .status()?;

    // 4. 卸载镜像
    Command::new("hdiutil")
        .args(["detach", &mount_point.to_string_lossy()])
        .status()?;
}

#[cfg(not(target_os = "macos"))]
{
    // 保持现有逻辑
    std::process::Command::new(file_path).spawn()?;
}
```

### 关键注意事项

1. **挂载点解析**：`hdiutil attach` 输出格式为 `/Volumes/<镜像名>`，需要从 stdout 解析
2. **.app 查找**：挂载后可能只有一个 `.app`，或需要按名称匹配
3. **权限处理**：复制到 `/Applications` 可能失败，需要捕获错误并返回友好消息
4. **清理逻辑**：无论成功或失败，都应尝试卸载镜像

---

## 上下文检查点

**当前上下文使用**：约 105k/200k tokens

**下一步**：研究完成，运行 `/clear` 后执行 `/ccg:team-plan macos-update-permission-fix` 开始规划