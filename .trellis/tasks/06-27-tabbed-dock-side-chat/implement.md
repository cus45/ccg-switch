# Implement — Tab 化 dock + 侧边聊天分屏

按 Stage A→E 推进。每个 Stage 后跑验证门；Stage B、D 前后设 `[review-gate]`（主聊天回归风险点）。每段编辑后 `trellis-check`。

## Stage A — store tab 作用域 API（纯附加，行为不变）

- [x] A1 `useChatTab(tabKey)` selector：返回该 tab 切片 + 派生 `isStreaming`（活跃 tab 走顶层投影、背景 tab 读 `openTabs[key]`，二者等价）。
- [x] A2 tab 作用域 action：`sendInTab(tabKey,text,opts)`、`abortTab(tabKey)`、`updateTabConfig(tabKey,partial)`、`setTabDraft(tabKey,draft)`、`startNewSessionInTab(tabKey,cwd?)`。由现有 `send/abort/setProvider/...` 逻辑参数化提取；现有全局 action 改为 `xxxInTab(activeTabKey,...)` 薄封装。
- [x] A3 `dockChatTabKey` 状态 + `openSideChat(opts?)` / `closeSideChat(key)`（新建/移除 `ChatSessionTab`，默认继承 activeTab.currentCwd + 全局默认 provider/model；关闭时 `retirePendingSendsForTab`）。
- [x] A4 活跃 turn 守卫 / 权限单入幂等 / requestId 退役 等规则按 tab 复用验证（不回归现有全局行为）。
- [x] A5 验证门 A：`tsc` 干净；`useChatStore.test` 扩充——`sendInTab` 路由到指定 tab、并发两 tab 各自 requestId 不串扰、全局 action 等价于 activeTab 作用域、openSideChat/closeSideChat。`vitest run src/stores` 全绿。

## Stage B — `<ChatPane tabKey>`，中心主聊天切换 `[review-gate]`

- [x] B1 `components/chat/ChatPane.tsx`：吃 `tabKey` + `variant`；组合 转录(MessageList)+ ChatComposer + StatusStrip + 该 tab 权限弹窗。数据源 = `useChatTab(tabKey)` + tab actions。
  - 落地形态：`ChatPane.tsx`（会话列组合）+ `useChatPaneController.ts`（转录/搜索/锚点/状态摘要控制器，tab 未命中回退全局投影）。StatusStrip 仍常驻 dock 顶（设计原文），由 ChatPage 用同一 controller 实例喂数据；权限弹窗按取舍留在 ChatPage 全局队列。
- [x] B2 `ChatComposer` 重构：provider/model/draft/send/abort/setProvider… 从全局 `useChatStore()` 改为注入的 tab 切片 + tab actions（保持所有键盘/守卫/补全/增强契约不变）。
  - 落地形态：`useComposerChatBinding(tabKey?)` —— 缺省走全局路径（主聊天零改动，含真实 abort）；传 tabKey 走 tab 作用域 action（侧聊，canAbort=false，chat_abort 无法按 requestId 定向）。
- [x] B3 `ChatPage` 中心区改用 `<ChatPane tabKey={activeTabKey} variant="main"/>`；保留 `ChatSessionTabs`（中心会话 tab，收敛进 ChatPane 的 main variant）。
- [ ] B4 验证门 B：`tsc` ✓；`vitest run` 全量 677/677 ✓；`cargo test chat::` 41/41 ✓。**待用户手测**主聊天：发送/流式/工具块/中心会话切换/审查/文件树/状态条/权限弹窗无回归（AC6）。`[review-gate]` 通过后再进 C。

## Stage C — DockShell tab 外壳（收编 Files/Review/File）

- [x] C1 `utils/dockDocuments.ts`：`DockDocument` 类型 + `ccg-chat-dock-documents` 持久化（仿 `rightDockState`）。载入时丢弃 sideChat 文档（恢复语义在 E1）。
- [x] C2 `components/chat/dock/DockShell.tsx` + `DockTabBar.tsx`：文档 tab 条 + `+` 菜单（文件浏览 / 审查[仅 git]；新侧聊在 D1 接入）+ 切换/关闭；沿用 `rightDockState` 收起/展开；宽度策略（有文档宽态 min(46vw,820px)，空态 360px + DockMenu 启动页）。
- [x] C3 文档路由：`files`→FilesBrowser（拆现 FilesPanel 树）、`file`→FilePreview（拆现预览）、`review`→现 ReviewPanel。点开文件 push `file` 文档。
- [x] C4 `ChatPage` 用 `<DockShell>` 替换现 `<RightDock>`（feature 开关 `ccg-chat-dock-shell`=0/false/off 回退旧 RightDock）。
- [x] C5 验证门 C：`tsc` ✓；`vitest` 694/694 ✓（dockDocuments 纯函数测试 17 个）；手测文件浏览→开文件 tab、审查 tab 仅 git（与 B4 手测合并做）。

## Stage D — 侧聊文档 + 并发 `[review-gate]`

- [x] D1 `+` 新建侧聊 → `openSideChat()` push `sideChat` 文档（含 `chatTabKey`）并激活。标题「侧边聊天/侧边聊天 N」；关文档同时 `closeSideChat`（退役未完成发送；若已被中心聚焦则走 closeTab 焦点回退，含 store 测试）。
- [x] D2 `sideChat` 文档渲染 `SideChatPane` → `<ChatPane tabKey variant="side"/>`（自建 controller 实例；sdk/mcp 按 tab provider 独立计算；SDK 弹窗留 ChatPage，侧聊缺 SDK 仅提示）。
- [x] D3 并发：store 层事件按 requestId 路由到目标 tab（A5 `sendInTab` 并发测试覆盖）；侧聊 tab 切走后台保活（openTabs 池 + 事件照常写入），切回转录保留。
- [ ] D4 验证门 D：`tsc` ✓；`vitest` 695/695 ✓（含 closeSideChat 提升为活跃 tab 的焦点回退测试）。**待用户手测** AC2（dock 新建侧聊可独立对话）/AC3（主+侧同时发送互不串扰）/AC4（切走切回保留）。`[review-gate]`。

## Stage E — 持久化 / i18n / 打磨 / spec

- [x] E1 dock 文档结构 + 活跃文档持久化恢复（AC7，C1 已落地；sideChat 文档载入丢弃=MVP 语义，侧聊会话不跨重启）；侧聊 tab 单个关闭（D1）+ 批量关闭（`+` 菜单「关闭全部标签页」，逐个 closeSideChat 退役）。
- [x] E2 i18n：chat.dock 新增 addTab/closeTab/previewFailed/sideChat/newSideChat/closeAllTabs（zh/en）+ tf 可读 fallback。
- [x] E3 `.trellis/spec/frontend` 更新：component-guidelines（DockShell 文档模型/路由/回滚开关 + ChatPane/useChatPaneController 契约，RightDock 标注 legacy）；state-management（tab 作用域 store API + requestId 并发路由 + closeSideChat 焦点回退 + canAbort 约束）。
- [x] E4 验证门 E：tsc ✓ / vitest 695 ✓ / cargo test chat:: 41 ✓（后端未改）。人工验收 AC1–AC8 待用户 GUI 确认。

## 验证命令

```bash
npx tsc --noEmit
npx vitest run                      # 全量,重点 stores/ 与 ChatPane/ChatComposer/ChatPage 回归
npx vitest run src/stores src/components/chat
cargo test chat:: --manifest-path src-tauri/Cargo.toml   # 后端未改,保门
```

## 风险文件 / 回滚点

- **最高风险**：`ChatComposer` 重构（B2）+ `ChatPage` 中心区切 ChatPane（B3）——主聊天核心。回滚点：Stage B 独立成段，feature 开关 `ccg-chat-dock-shell` 后保留旧路径；B 验证门 + review-gate 把关。
- `useChatStore` tab API（A）附加式，可单独保留/回滚。
- `DockShell` 替换 `RightDock`（C4）：feature 开关后保留旧 RightDock。
- 每 Stage 各自验证门 + B/D `[review-gate]`；每段编辑后 `trellis-check`。

## task.py start 前置

- prd/design/implement 齐备（complex task）。
- 用户评审本规划并批准后再 `task.py start`（实现）。
