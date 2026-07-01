# Implement — Tab 化 dock + 侧边聊天分屏

按 Stage A→E 推进。每个 Stage 后跑验证门；Stage B、D 前后设 `[review-gate]`（主聊天回归风险点）。每段编辑后 `trellis-check`。

## Stage A — store tab 作用域 API（纯附加，行为不变）

- [x] A1 `useChatTab(tabKey)` selector：返回该 tab 切片 + 派生 `isStreaming`（活跃 tab 走顶层投影、背景 tab 读 `openTabs[key]`，二者等价）。
- [x] A2 tab 作用域 action：`sendInTab(tabKey,text,opts)`、`abortTab(tabKey)`、`updateTabConfig(tabKey,partial)`、`setTabDraft(tabKey,draft)`、`startNewSessionInTab(tabKey,cwd?)`。由现有 `send/abort/setProvider/...` 逻辑参数化提取；现有全局 action 改为 `xxxInTab(activeTabKey,...)` 薄封装。
- [x] A3 `dockChatTabKey` 状态 + `openSideChat(opts?)` / `closeSideChat(key)`（新建/移除 `ChatSessionTab`，默认继承 activeTab.currentCwd + 全局默认 provider/model；关闭时 `retirePendingSendsForTab`）。
- [x] A4 活跃 turn 守卫 / 权限单入幂等 / requestId 退役 等规则按 tab 复用验证（不回归现有全局行为）。
- [x] A5 验证门 A：`tsc` 干净；`useChatStore.test` 扩充——`sendInTab` 路由到指定 tab、并发两 tab 各自 requestId 不串扰、全局 action 等价于 activeTab 作用域、openSideChat/closeSideChat。`vitest run src/stores` 全绿。

## Stage B — `<ChatPane tabKey>`，中心主聊天切换 `[review-gate]`

- [ ] B1 `components/chat/ChatPane.tsx`：吃 `tabKey` + `variant`；组合 转录(MessageList)+ ChatComposer + StatusStrip + 该 tab 权限弹窗。数据源 = `useChatTab(tabKey)` + tab actions。
- [ ] B2 `ChatComposer` 重构：provider/model/draft/send/abort/setProvider… 从全局 `useChatStore()` 改为注入的 tab 切片 + tab actions（保持所有键盘/守卫/补全/增强契约不变）。
- [ ] B3 `ChatPage` 中心区改用 `<ChatPane tabKey={activeTabKey} variant="main"/>`；保留 `ChatSessionTabs`（中心会话 tab）。
- [ ] B4 验证门 B：`tsc`；`vitest run`（**全量**，重点 ChatComposer/ChatPage/useChatStore 回归）；逐项手测主聊天：发送/流式/工具块/中心会话切换/审查/文件树/状态条/权限弹窗无回归（AC6）。`[review-gate]` 通过后再进 C。

## Stage C — DockShell tab 外壳（收编 Files/Review/File）

- [ ] C1 `utils/dockDocuments.ts`：`DockDocument` 类型 + `ccg-chat-dock-documents` 持久化（仿 `rightDockState`）。
- [ ] C2 `components/chat/dock/DockShell.tsx` + `DockTabBar.tsx`：文档 tab 条 + `+` 菜单（新侧聊 / 文件浏览 / 审查[仅 git]）+ 切换/关闭；沿用 `rightDockState` 收起/展开；宽度策略。
- [ ] C3 文档路由：`files`→FilesBrowser（拆现 FilesPanel 树）、`file`→FilePreview（拆现预览）、`review`→现 ReviewPanel。点开文件 push `file` 文档。
- [ ] C4 `ChatPage` 用 `<DockShell>` 替换现 `<RightDock>`（feature 开关后保留旧 RightDock 回滚）。
- [ ] C5 验证门 C：`tsc`/`vitest`；dockDocuments 纯函数测试；手测文件浏览→开文件 tab、审查 tab 仅 git。

## Stage D — 侧聊文档 + 并发 `[review-gate]`

- [ ] D1 `+` 新建侧聊 → `openSideChat()` push `sideChat` 文档（含 `chatTabKey`）并激活。
- [ ] D2 `sideChat` 文档渲染 `<ChatPane tabKey={doc.chatTabKey} variant="side"/>`。
- [ ] D3 并发：主+侧同时发送，两路流式按 requestId 路由互不串扰（AC3）；侧聊 tab 切走后台保活、切回保留（AC4）。
- [ ] D4 验证门 D：`tsc`/`vitest`（并发路由测试）；手测 AC2/AC3/AC4。`[review-gate]`。

## Stage E — 持久化 / i18n / 打磨 / spec

- [ ] E1 dock 文档结构 + 活跃文档持久化恢复（AC7）；侧聊 tab 关闭/批量关闭。
- [ ] E2 i18n：tab 标题/+菜单/新侧聊/关闭等 zh/en + 可读 fallback。
- [ ] E3 `.trellis/spec/frontend` 更新：dock tab 外壳 + `ChatPane`/tab 作用域 store 契约 + 并发路由契约。
- [ ] E4 验证门 E：三层全绿；人工验收 AC1–AC8（GUI 需用户）。

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
