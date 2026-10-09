# 供应商预设库 + 托盘快速切换

## 背景

审查发现：添加供应商只有 Claude Official / OpenRouter 两个预设；托盘只能显示、不能切换（且切换后不刷新）。上游 cc-switch v4 有按应用划分的大量预设，并支持托盘快速切换。

## 需求

### 预设库
1. 从上游 cc-switch `origin/main` 的 `src/config/{claude,codex,gemini,opencode,claudeDesktop}ProviderPresets.ts` 生成本项目的预设数据 `src/config/providerPresets.generated.ts`（脚本 `scripts/sync-provider-presets.mjs`，可重复执行）。
2. 每条预设只保留本项目能用的字段：应用、名称、分类、官网、获取 Key 链接、Base URL、模型（主/Opus/Haiku 档）、OpenCode 的 npm 包。
3. 过滤掉本项目不支持的预设：需要 OAuth 的、隐藏的、Claude 预设中需要接口格式转换的（`apiFormat` 非 anthropic）、需要模板变量的。
4. 去掉链接里的推广 / 追踪参数（上游的 `aff` / `track_id` 等属于 cc-switch 的推广，本项目不应携带）。
5. 添加供应商表单：用可搜索的预设选择器替换原来两个按钮，按当前应用类型过滤，支持按名称和域名搜索；选中后填入名称、Base URL、模型、SDK 类型，并显示「获取 API Key」链接。
6. 删除未使用的 `ProviderPresets.tsx`。

### 托盘快速切换
7. 托盘按应用列出供应商子菜单（Claude Code / Claude Desktop / Codex / Gemini），当前项带勾选标记，点击即切换（走与界面相同的 `switch_provider_in_db`）。
8. 任何途径切换、增删改供应商后刷新托盘菜单；托盘切换后通知前端刷新供应商列表。

## 验收
- [ ] 预设数据由脚本生成，Claude / Codex / Gemini / OpenCode / Claude Desktop 都有预设；生成文件不含 `aff=`、`track_id=` 等推广参数。
- [ ] 表单可搜索并应用预设；编辑已有供应商时不显示预设选择器。
- [ ] 托盘能看到并切换供应商，切换后界面同步刷新。
- [ ] `npm test`、`cargo test`、`npm run build` 通过。
