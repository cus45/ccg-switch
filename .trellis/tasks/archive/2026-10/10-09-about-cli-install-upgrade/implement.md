# Implement — 关于页 CLI 工具一键安装/升级

## 步骤

1. [ ] `tool_installer_service.rs`：白名单、InstallKind 检测、npm 检测；单测：白名单外工具被拒、各平台命令构造。
2. [ ] `run_tool_install` / `cancel_tool_install` / `get_tool_install_plan` 命令 + 事件 + 结束后刷新版本；在 `lib.rs` 注册。
3. [ ] `types/about.ts` 新增事件 payload 类型；`useAboutStore` 状态与监听。
4. [ ] `ToolStatusGrid` 按钮状态机 + `ToolInstallLog` 组件 + 确认弹窗。
5. [ ] `InstallCommandPanel` 文案与 Windows 命令。
6. [ ] i18n zh/en。

## 校验

```bash
cd src-tauri && cargo test tool_installer && cargo test
npm run build
```

## 手动验证（Windows）

- 升级 Codex：不弹黑窗、日志实时滚动、版本号刷新。
- 临时把 PATH 中的 npm 去掉 → npm 类命令被拦截。
- 安装过程中点取消 → 进程树结束，UI 恢复。

## 回滚点

步骤 1–2 后端可单独提交；步骤 4 是入口。
