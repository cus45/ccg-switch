# Design — Tab 化 dock + 侧边聊天分屏

## 架构总览

```
ChatPage
├─ 中心主聊天：<ChatPane tabKey={activeTabKey}/>        ← 现 ChatSessionTabs + 转录 + composer 收敛进 ChatPane
└─ 右侧 DockShell（替换现 RightDock 卡片菜单）
   ├─ DockTabBar：[文件浏览] [dev.bat] … [侧边聊天] [侧边聊天2] [+]
   └─ DockDocument（按活跃 dock tab 路由）
        ├─ 'files'   → FilesBrowser(树)         （复用现 FilesPanel 树部分）
        ├─ 'file'    → FilePreview(单文件)       （复用现 FilesPanel 预览部分）
        ├─ 'review'  → ReviewPanel               （现成，仅 git）
        └─ 'sideChat'→ <ChatPane tabKey={doc.chatTabKey}/>   ← 第二个完整聊天
   StatusStrip 仍常驻 dock 顶（daemon+上下文%+诊断抽屉）
```

核心洞察：**侧边聊天 = `openTabs` 里一个「可见的非活跃 tab」**。store 现有事件按 `requestTargetTabKey(requestId)` 路由到对应 tab 快照（背景 tab 也更新），所以 `<ChatPane>` 只要按 `tabKey` 取该 tab 切片即可独立响应流式——无需新并发机制。

## Store 契约改动（`useChatStore`，附加式，不破坏现有投影）

现状：顶层字段 = `activeTabKey` 的 `projectTabToState` 投影；全局 action（`send/abort/setProvider/setModel/setDraft/...`）作用于活跃 tab。

新增（tab 作用域，现有全局 action 改为「作用于 activeTabKey」的薄封装以保后兼容）：

- **读**：`useChatTab(tabKey)` selector hook → 返回该 tab 切片（messages/provider/model/permissionMode/reasoningEffort/draft/longContextEnabled/contextTokens/contextMaxTokens/activeRequestId/sessionId/currentCwd/activeSession/pendingSessionKey/lastSessionLoadMetrics/subagentRuns/error）+ 派生 `isStreaming`。背景 tab 直接读 `openTabs[key]`；活跃 tab 读顶层投影（二者等价）。
- **写/动作**：`sendInTab(tabKey, text, opts)`、`abortTab(tabKey)`、`updateTabConfig(tabKey, {provider?/model?/permissionMode?/reasoningEffort?/longContextEnabled?})`、`setTabDraft(tabKey, draft)`、`startNewSessionInTab(tabKey, cwd?)`。
  - 这些是现有逻辑的 tab 参数化提取：`send` 现已捕获快照 key 并 `requestTabKeys.set(reqId, tabKey)`；`sendInTab` 用传入 key 走同一路径（发送态写入该 tab 快照；若该 key==activeTabKey 同时刷新顶层投影）。
  - 活跃 turn 守卫（provider/model/mode 在流式中为 no-op）、单入幂等（权限响应）、token 退役（retire）等规则**按 tab** 复用。
- **dock 侧聊管理**：新增 `dockChatTabKey: string | null`（dock 当前可见的侧聊 tab）；`openSideChat(opts?)` → 新建一个 `ChatSessionTab`（默认 provider/model 取全局默认或继承活跃 tab，`currentCwd` 默认继承 activeTab.currentCwd）、`upsertTab`、置 `dockChatTabKey`；`closeSideChat(key)` → `removeTab` + 若关的是可见侧聊则清/切 `dockChatTabKey`，并 `retirePendingSendsForTab(key)`。
- 事件处理器无需改并发逻辑：已按 `requestTargetTab` 写目标 tab；仅需确保**非活跃但可见**的侧聊 tab 的快照更新能被 `useChatTab` 读到（已满足，因为它读 `openTabs[key]`）。

## `<ChatPane tabKey>` 契约（新组件，主+侧共用）

- props：`tabKey: string`、`variant?: 'main' | 'side'`（控制密度/是否显示中心会话 tab 条等次要差异）。
- 内部：`const tab = useChatTab(tabKey)`，渲染 转录（`MessageList`，已 props 驱动，喂 `tab.messages`/导航窗口）+ `ChatComposer`（重构为吃 `tabKey` 或 scoped 切片 + tab actions）+ `StatusStrip`（已 props 化）+ 该 tab 的权限弹窗（`pendingXxx` 仍全局队列，但按 sessionId/tab 归属渲染——MVP 侧聊权限可先走全局队列，见取舍）。
- `ChatComposer` 重构：把对 `useChatStore()` 的 provider/model/draft/send/abort/setProvider… 直接读改为「由 `ChatPane` 注入的 tab 切片 + tab actions」（或 `useChatTab(tabKey)` + `sendInTab` 等）。保持现有所有交互/守卫/键盘契约不变，只是数据源从全局换成 tab。

## DockShell（替换 RightDock 卡片菜单）

- `DockShell` 持有 `dockDocuments: DockDocument[]` + `activeDocId`，持久化（仿 `rightDockState`，新 key `ccg-chat-dock-documents`）。`DockDocument = { id, kind: 'files'|'file'|'review'|'sideChat', title, filePath? (kind=file), chatTabKey? (kind=sideChat) }`。
- `DockTabBar`：列出文档 tab + `+` 菜单（新侧边聊天 / 文件浏览 / 审查[仅 git]）；切换/关闭；收起/展开沿用 `rightDockState`。dock 宽度：含聊天/文件/审查文档时用宽态 `min(46vw,820px)`，纯空/菜单可窄。
- 文件浏览点开文件 → push 一个 `kind:'file'` 文档并激活（复用现 `chat_read_text_file` 预览）。审查文档复用现 `ReviewPanel`。

## 数据流（并发双聊天）

1. 主聊天发送 → `sendInTab(activeTabKey, …)` → reqId_A，`requestTabKeys[reqId_A]=activeTabKey`。
2. 侧聊发送 → `sendInTab(dockChatTabKey, …)` → reqId_B，`requestTabKeys[reqId_B]=dockChatTabKey`。
3. `chat://stream|message|done` 到达 → `requestTargetTab` 按 reqId 命中各自 tab 快照更新 → `useChatTab(activeTabKey)` 与 `useChatTab(dockChatTabKey)` 各自响应式重渲染。两路互不串扰（AC3）。
4. 侧聊 tab 在 dock 切到「文件」→ `dockChatTabKey` 不变、该 tab 仍在 `openTabs` 背景接收事件 → 切回仍在（AC4）。

## 兼容 / 迁移 / 回滚

- **分阶上线**降低主聊天回归风险：
  1. Stage A：store tab 作用域 API（纯附加，行为不变）+ 单测。
  2. Stage B：建 `<ChatPane>`，中心主聊天切到 `<ChatPane tabKey={activeTabKey}>`，逐一核对主聊天行为不变（tsc/vitest/手测）。
  3. Stage C：DockShell tab 外壳（DockTabBar + 文档路由，收编 Files/Review/File）。
  4. Stage D：侧聊文档（`openSideChat` + `<ChatPane variant="side">`）+ 并发。
  5. Stage E：持久化 + i18n + 打磨 + spec。
- **回滚**：保留旧 `RightDock` 渲染于 feature 开关后（如 `ccg-chat-dock-shell` 标志），出问题切回；store 新 API 附加式可单独保留。
- 中心 `ChatSessionTabs`（会话多 tab）与 dock 文档 tab 是**两套**：前者切换中心会话，后者管 dock 文档；侧聊文档引用的是同一 `openTabs` 池里的 tab（统一池，避免双份）。

## 取舍

- 权限弹窗（tool/plan/ask）MVP 仍走 store 全局 pending 队列 + 单弹窗；侧聊触发的权限请求按 sessionId 写回正确，但视觉上仍在中心弹出。N 分屏/按面板就地弹窗留后续。
- 主聊天统一进 `ChatPane`（而非仅侧聊走新路径）：更干净、避免双份，但 Stage B 有主聊天回归面——用现有 670 测试 + 新增 ChatPane/并发测试 + feature 开关兜底。
- 侧聊 MVP 只新建空白会话；历史会话入侧边、N 分屏、浏览器 tab 均显式 out of scope。
