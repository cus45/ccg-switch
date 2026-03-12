# Team Plan: macos-update-permission-fix

## 概述

修复 macOS 平台应用更新安装权限问题，实现 `.dmg` 镜像的自动挂载和应用安装功能。

## Gemini 分析摘要（前端权威）

### 前端变更评估
- 需要将 `installing: boolean` 扩展为状态机 `installStage: 'idle' | 'mounting' | 'copying' | 'verifying' | 'cleanup' | 'finished'`
- 引入 `listen('update-install-progress')` 事件监听细分阶段
- 成功后显示"立即重启"按钮

### UI/UX 方案
- **动态进度反馈**：根据 `installStage` 实时切换提示文本
  - `mounting` -> "正在挂载磁盘镜像..."
  - `copying` -> "正在复制应用文件 (可能需要系统授权)..."
  - `finished` -> "更新已准备就绪"
- **操作引导闭环**：安装成功后，"安装更新"按钮转换为"立即重启"按钮
- **沉浸式保护**：安装执行期间锁定设置界面的其他交互

### 错误处理优化
- **权限不足 (EPERM)**：弹出引导弹窗，提示用户手动操作或移动应用到 Applications
- **挂载失败**：若 DMG 损坏，提供"重新下载"快捷操作
- **错误视觉**：使用 Alert 组件替代简单文本

### i18n 补充
```json
"settings": {
  "installStage": {
    "mounting": "正在挂载镜像...",
    "copying": "正在替换旧版本...",
    "verifying": "正在验证安装...",
    "success": "安装完成，请重启应用"
  },
  "relaunchNow": "立即重启"
}
```

## 后端分析（基于研究文件）

### 技术方案

1. **条件编译**：使用 `#[cfg(target_os = "macos")]` 分隔平台逻辑
2. **挂载镜像**：调用 `hdiutil attach -nobrowse -readonly <dmg_path>`
3. **复制应用**：使用 `cp -R` 或 `rsync` 复制 `.app` 到 `/Applications`
4. **进度推送**：通过 `app.emit("update-install-progress", InstallProgress)` 发送阶段
5. **清理逻辑**：无论成功失败都执行 `hdiutil detach`

### 数据模型

```rust
#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct InstallProgress {
    pub stage: String,  // "mounting", "copying", "verifying", "cleanup", "success"
    pub message: String,
    pub percentage: f64,
}
```

### 实施步骤

1. 在 `updater_service.rs` 添加 `InstallProgress` 结构体
2. 修改 `install_update` 签名为 `pub fn install_update(app: &AppHandle, file_path: &str) -> Result<(), String>`
3. 实现 macOS 特定逻辑：
   - 挂载 DMG → 解析挂载点
   - 查找 `.app` 文件
   - 复制到 `/Applications`
   - 卸载镜像
4. 保持 Windows/Linux 原有行为

## 子任务列表

### Task 1: 后端安装逻辑（macOS 特定）
- **类型**: 后端
- **文件范围**: `src-tauri/src/services/updater_service.rs`
- **依赖**: 无
- **实施步骤**:
  1. 在文件顶部添加 `InstallProgress` 结构体定义
  2. 修改 `install_update` 函数签名，添加 `app: &AppHandle` 参数
  3. 实现 macOS 平台特定逻辑（`#[cfg(target_os = "macos")]`）：
     - 调用 `hdiutil attach` 挂载 DMG
     - 解析挂载点路径（从 stdout 提取 `/Volumes/xxx`）
     - 查找挂载点中的 `.app` 文件
     - 使用 `Command::new("cp").args(["-R", source, target])` 复制
     - 使用 `hdiutil detach` 卸载镜像
  4. 保持 Windows/Linux 平台原有行为不变（`#[cfg(not(target_os = "macos"))]`）
  5. 每个阶段通过 `app.emit("update-install-progress", ...)` 推送进度
  6. 添加详细的错误信息（权限不足、挂载失败、复制失败等）
- **验收标准**:
  - macOS 上能正确挂载 `.dmg` 文件
  - `.app` 被复制到 `/Applications` 目录
  - 权限不足时返回详细错误信息
  - Windows/Linux 行为不受影响

### Task 2: Tauri 命令注册更新
- **类型**: 后端
- **文件范围**: `src-tauri/src/lib.rs`
- **依赖**: Task 1
- **实施步骤**:
  1. 定位 `install_update` 命令（约 602-607 行）
  2. 修改函数签名，添加 `app: tauri::AppHandle` 参数
  3. 将 `app` 参数传递给 `services::updater_service::install_update`
- **验收标准**:
  - 命令能正确编译
  - `AppHandle` 能传递到服务层

### Task 3: 前端状态管理升级
- **类型**: 前端
- **文件范围**: `src/components/settings/AboutPanel.tsx`
- **依赖**: 无
- **实施步骤**:
  1. 添加 `installStage` 状态：`const [installStage, setInstallStage] = useState<string>('idle')`
  2. 添加 `listen('update-install-progress')` 事件监听（在 `useEffect` 中）
  3. 修改 `handleInstall` 函数，处理安装成功后的状态
  4. 添加"立即重启"按钮的渲染逻辑
  5. 安装期间禁用其他操作（设置 `installing` 时禁用检查更新等按钮）
- **验收标准**:
  - 能接收并显示后端推送的安装阶段
  - 安装成功后显示"立即重启"按钮
  - 安装期间其他按钮被禁用

### Task 4: i18n 翻译补充
- **类型**: 前端
- **文件范围**: `src/locales/zh.json`, `src/locales/en.json`
- **依赖**: 无
- **实施步骤**:
  1. 在 `zh.json` 的 `settings` 下添加：
     - `installStage.mounting`: "正在挂载镜像..."
     - `installStage.copying`: "正在替换旧版本..."
     - `installStage.verifying`: "正在验证安装..."
     - `installStage.success`: "安装完成，请重启应用"
     - `relaunchNow`: "立即重启"
  2. 在 `en.json` 添加对应英文翻译
- **验收标准**:
  - 中英文翻译完整
  - Key 命名与前端代码一致

### Task 5: 错误处理 UI 优化
- **类型**: 前端
- **文件范围**: `src/components/settings/AboutPanel.tsx`
- **依赖**: Task 3
- **实施步骤**:
  1. 分析错误消息，识别权限不足、挂载失败等场景
  2. 为权限不足添加引导文案："请将应用移动到应用程序文件夹后重试"
  3. 优化错误提示的视觉呈现（使用 Alert 组件样式）
  4. 为挂载失败添加"重新下载"按钮
- **验收标准**:
  - 权限错误有明确的用户指引
  - 错误提示更加友好和 actionable

## 文件冲突检查

| 任务 | 文件 | 冲突 |
|------|------|------|
| Task 1 | `src-tauri/src/services/updater_service.rs` | 无 |
| Task 2 | `src-tauri/src/lib.rs` | 无 |
| Task 3 | `src/components/settings/AboutPanel.tsx` | 无 |
| Task 4 | `src/locales/zh.json`, `src/locales/en.json` | 无 |
| Task 5 | `src/components/settings/AboutPanel.tsx` | 依赖 Task 3 |

**结论**: 文件范围完全隔离，Task 3 和 Task 5 按顺序执行，其他任务可并行。

## 并行分组

### Layer 1 (并行):
- Task 1: 后端安装逻辑（macOS 特定）
- Task 4: i18n 翻译补充

### Layer 2 (依赖 Layer 1):
- Task 2: Tauri 命令注册更新（依赖 Task 1）
- Task 3: 前端状态管理升级（可并行）

### Layer 3 (依赖 Layer 2):
- Task 5: 错误处理 UI 优化（依赖 Task 3）

## Builder 数量建议

- Layer 1: 2 个 Builder（后端 1 个，前端 1 个）
- Layer 2: 2 个 Builder（后端 1 个，前端 1 个）
- Layer 3: 1 个 Builder（前端）

## 预估工作量

- Task 1: 2-3 小时（核心逻辑，需测试）
- Task 2: 30 分钟（简单修改）
- Task 3: 1-2 小时（状态管理和事件监听）
- Task 4: 30 分钟（翻译补充）
- Task 5: 1 小时（UI 优化）

**总计**: 约 5-7 小时
