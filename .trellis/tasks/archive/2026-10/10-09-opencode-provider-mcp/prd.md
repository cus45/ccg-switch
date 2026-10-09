# OpenCode 供应商切换 + MCP 同步

## 目标

把 OpenCode 从"已废弃/隐藏"恢复为可见应用：在供应商页可增删改、切换供应商，在 MCP 页可把服务器同步到 OpenCode。

## 参考

- `demo/cc-switch/src-tauri/src/opencode_config.rs`：读写 `~/.config/opencode/opencode.json`（`provider`、`mcp` 两个对象）。
- `demo/cc-switch/src-tauri/src/services/provider/live.rs:136`：OpenCode 走 **additive（累加）模式**，切换时把供应商写进 `provider.<id>`，而不是覆盖整份配置。
- `demo/cc-switch/src-tauri/src/mcp/opencode.rs`：MCP 格式转换（OpenCode 用 `type: local|remote`、`command` 数组、`environment`）。
- 前端表单：`demo/cc-switch/src/components/providers/forms/hooks/useOpencodeFormState.ts`。

## 需求

1. **可见性**：`src/types/app.ts` 中 `VISIBLE_APP_TYPES` 包含 `opencode`；供应商页、MCP 页、故障转移、通用供应商面板都出现 OpenCode。
2. **配置路径**：`~/.config/opencode/opencode.json`（Windows 也是 `%USERPROFILE%\.config\opencode`，与 OpenCode 官方一致）。文件不存在时以 `{"$schema":"https://opencode.ai/config.json"}` 初始化。
3. **供应商切换**：
   - 供应商字段：`npm`（SDK 包，如 `@ai-sdk/openai-compatible` / `@ai-sdk/anthropic`）、`name`、`options.baseURL`、`options.apiKey`、`models`（模型映射）。
   - 切换 = 写入 / 更新 `provider.<id>`，并把顶层 `model` 设为 `<id>/<默认模型>`；**保留**文件中用户手写的其它字段与其它 provider。
   - 删除供应商时从 `provider` 中移除对应条目。
4. **MCP 同步**：MCP 页对 OpenCode 的启用/禁用 → 写入 / 移除 `mcp.<id>`，stdio 转 `{type:"local", command:[cmd,...args], environment}`，http/sse 转 `{type:"remote", url, headers}`；支持从 OpenCode 现有配置导入。
5. **代理接管**：本任务不要求 OpenCode 接入本地代理接管；UI 上对 OpenCode 隐藏接管开关或显示"暂不支持"。
6. **工具版本**：About 页已检测 `opencode`，无需改动。
7. i18n：新增文案同时更新 `zh.json` / `en.json`。

## 验收标准

- [ ] 供应商页出现 OpenCode 标签，可新增、编辑、删除、切换。
- [ ] 切换后 `opencode.json` 中 `provider.<id>` 与 `model` 正确，其它字段（含注释外的用户键）原样保留，key 顺序不乱（`preserve_order`）。
- [ ] MCP 页启用某服务器到 OpenCode 后 `mcp.<id>` 格式正确；禁用后被移除。
- [ ] 文件不存在 / JSON 损坏时给出明确错误，不覆盖损坏文件。
- [ ] Rust 单测覆盖：provider 写入保留其它字段、MCP stdio/remote 转换、移除。
- [ ] `cargo test`、`npm run build`（tsc）通过；Claude/Codex/Gemini 原有测试不回归。

## 非目标

- OpenCode 的 plugin（oh-my-opencode 等）管理。
- OpenCode 代理接管、用量统计。
- OpenClaw。
