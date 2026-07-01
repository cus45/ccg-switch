# Tab 化 dock + 侧边聊天分屏

## Goal

把聊天页右侧工具坞从「卡片菜单 → 单面板」升级为**顶部带 tab 的多文档外壳**，并新增**侧边聊天**——让两个独立聊天界面并排分屏，各自有对话流 + 独立 composer + 独立 provider/model/会话/流式。承接 06-27-right-sidebar-dock PRD 明确推迟的「侧边聊天(分屏)」后续阶段。

用户参考截图：dock 顶部 tab 条形如 `dev.bat` / `打开文件` / `侧边聊天` / `侧边聊天2` / `+`；侧边聊天 tab 打开后右侧呈现一个完整、独立配置（如「完全访问 / 5.5 超高」）的聊天面板。

## Confirmed facts（来自代码勘察）

- `useChatStore` 已是多 tab 模型：`ChatSessionTab[] openTabs` + `activeTabKey`，每个 tab 独立持有 `messages/provider/model/permissionMode/reasoningEffort/sessionId/activeRequestId/currentCwd/activeSession/status/updatedAt` 等（`useChatStore.ts:305`）。
- `projectTabToState(tab)`（:517）把「活跃 tab」投影到顶层字段；ChatPage 及子组件经 `useChatStore()` 读这些**顶层投影**字段——一次只渲染一个会话。
- 事件按请求路由到 tab：`requestTabKeys.set(requestId, tabKey)`（:1762），`chat://stream|message|done` 按 requestId 命中目标 tab；`hasActiveTabTurn`（:762）表明**非活跃 tab 也能并发流式**。
- `ChatComposer` 直接读全局 `useChatStore()`（provider/model/draft/send/abort 等），与全局投影强耦合；`MessageList` 已是 props 驱动（吃 `messages`）；`StatusStrip` 已展示型（吃 props）。
- 右侧 dock 现状（06-27 已交付）：`RightDock` 卡片菜单 → `FilesPanel`(左右分栏树+预览) / `ReviewPanel`(左右分栏列表+diff) / `StatusStrip`；menu 360px，files/review 加宽 `min(46vw,820px)`；收起/展开 + activePanel 持久化于 `ccg-chat-right-dock-state`。

**结论**：并发双聊天的难点不在 store 事件并发（已具备），而在**视图层**——需同时渲染两个 tab 投影，并让聊天子树绑定到「指定 tab」而非全局活跃投影。

## Decisions（问答确认）

- **D1 根架构**：右侧 dock 升级为**tab 化多文档外壳**，顶部 tab 条取代卡片菜单；tab = 文档（文件浏览 / 文件查看 / 审查 / 侧边聊天 / 将来浏览器），`+` 新建。主聊天居中，dock 激活「侧边聊天」tab 时即第二个独立聊天。复用 dock 容器 + store 按 requestId 分 tab 的并发能力，不另造分屏系统。
- **D2 侧边聊天 MVP 边界**：`+` 新建**独立空白**侧边聊天，独立 provider/model/权限/推理，默认继承当前 workspace cwd（可改）；主聊天居中 + dock 同时**只显示 1 个**侧边聊天（可存在多个侧边聊天 tab，dock 一次显示一个，切走的后台**保活流式**）；**不**支持把历史会话直接开进侧边、**不**做 N(>2) 分屏（均后续）。
- **D3 第二面板实现**：重构成按-tab 取数的 `<ChatPane tabKey>`——store 增加 tab 作用域 selector/action（如 `sendInTab(tabKey,...)`、`abortTab(tabKey)`、`useChatTab(tabKey)`）；主聊天与侧边共用同一 `ChatPane`。最干净可复用、无双份逻辑；代价是改 `ChatComposer` 等核心件、对主聊天有回归风险（靠现有 670 测试 + 新测试 + 分阶/开关兜底）。

## Requirements

- **R1 dock tab 外壳**：dock 顶部 tab 条（替代卡片菜单），可并列多文档 tab；`+` 弹出新建菜单（新侧边聊天 / 文件浏览 / 审查[仅 git]）；tab 可切换/关闭；收起/展开保留。
- **R2 文件 tab 化**：保留文件浏览（树）；从树点开文件 → 以**独立文件 tab** 呈现只读预览（可同时多个文件 tab）。审查作为一个 tab（仅 git）。
- **R3 侧边聊天**：`+` 新建独立空白侧边聊天 tab；激活时 dock 渲染一个完整 `ChatPane`，含独立对话流 + 独立 composer + 独立 provider/model/权限/推理/会话/流式，默认继承当前 cwd 可改。
- **R4 并发不串扰**：主聊天与侧边聊天可**同时流式**互不影响（事件按 requestId 路由到各自 tab）；侧边 tab 切走后**后台保活**，切回仍在。
- **R5 主聊天不回归**：经 `ChatPane` 重构后，主聊天的发送/流式/工具块/中心会话 tab(`ChatSessionTabs`)/审查/文件树/状态条/权限弹窗全部行为不变。
- **R6 持久化与 i18n**：dock 打开的 tab 结构 + 活跃 tab 持久化（仿 `rightDockState`）；新文案中英双语 + 可读 fallback。

## Acceptance Criteria

- [ ] AC1 dock 顶部出现 tab 条；`+` 可新建「侧边聊天」tab；tab 可切换、关闭。
- [ ] AC2 新建侧边聊天后，dock 渲染完整聊天面板，可独立选 provider/model/权限/推理并发送、流式回显。
- [ ] AC3 主聊天与侧边聊天**同时各自发送**时，两边流式输出互不串扰（各自 requestId 路由正确）。
- [ ] AC4 侧边聊天 tab 切到「文件/审查」再切回，原侧边会话与流式状态保留（后台保活）。
- [ ] AC5 文件浏览点开文件 → 独立文件 tab 只读预览；审查 tab 仅在 git 仓库出现。
- [ ] AC6 主聊天全链路无回归：发送/流式/工具块/中心会话 tab/审查/文件树/状态条/权限弹窗均如旧。
- [ ] AC7 dock tab 结构持久化（重启后恢复）；新文案中英齐全。
- [ ] AC8 `tsc` / `vitest`（含主聊天与 ChatPane 的回归 + 并发路由测试） / `cargo test chat::` 全绿。

## Out of scope（本版）

- 内嵌浏览器 tab；把现有历史会话直接「在侧边打开」；N(>2) 聊天面板多分屏；侧边聊天与主聊天的上下文/消息互传。

## Residual design-time choices（不阻塞，design.md 内定，评审可调）

- `+` 新建菜单的项与默认 tab（是否默认常驻「文件浏览」tab）。
- 主聊天是否也切到 `ChatPane(activeTabKey)`（统一）还是先保留全局投影、仅侧边走 ChatPane（降风险分阶）。
- 是否加 feature 开关让旧卡片菜单 dock 作回滚兜底。
