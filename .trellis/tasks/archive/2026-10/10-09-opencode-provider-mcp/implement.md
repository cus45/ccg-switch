# Implement — OpenCode 供应商切换 + MCP 同步

## 步骤

1. [ ] 后端 `services/opencode_config.rs`（读 / 原子写 / provider / model / mcp）+ 单测（临时 HOME）。
2. [ ] `provider_service.rs`：`sync_to_opencode_config`、`preview_opencode_config`，分发点加分支；删除供应商时清理。单测：保留其它键与其它 provider、key 顺序。
3. [ ] `mcp/opencode.rs` + `mod.rs` re-export + `import.rs` 导入来源；单测：stdio/remote 双向转换。
4. [ ] `mcp_service.rs` 四处分发补 `"opencode"`。
5. [ ] 前端 `VISIBLE_APP_TYPES` 加 opencode，审查 10 处使用点，代理相关处过滤。
6. [ ] OpenCode 供应商表单字段（npm / baseURL / key / models）。
7. [ ] MCP 页应用开关加 OpenCode。
8. [ ] i18n zh/en。

## 校验命令

```bash
cd src-tauri && cargo test opencode && cargo test
npm run build
```

## 手动验证

- 新建 OpenCode 供应商 → 切换 → 打开 `~/.config/opencode/opencode.json` 检查；运行 `opencode` 确认能用该供应商发一次请求。
- MCP 启用 / 禁用到 OpenCode，检查 `mcp` 节点。

## 回滚点

- 步骤 1–4 为纯后端新增，可单独提交；步骤 5 是入口开关，出问题时只回退步骤 5。
