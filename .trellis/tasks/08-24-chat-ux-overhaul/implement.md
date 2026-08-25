# 执行计划 — 对话模块体验深度重构

五个阶段，每阶段一个 commit、一个验证门。前一阶段不绿不进下一阶段。

**每次提交前必做**（memory `dcg-chat-benchmark` 教训 3）：
`git status` 查有无并发会话留下的 `A `（已暂存）条目，只提交本阶段自己的文件。

---

## S1 — 流式性能地基（P0，收益最大）

- [ ] 1.1 新建 `src/utils/markdownBlocks.ts`：移植 `splitMarkdownBlocks`
      （源：`C:\guodevelop\demo\desktop-cc-gui\src\markdown\incremental\splitMarkdownBlocks.ts`，
      纯字符串算法，原样移植含注释）
- [ ] 1.2 新建 `src/utils/markdownBlocks.test.ts`：覆盖 fence 开闭、冻结边界、
      空行切分、尾部 2 块不冻结、追加文本时冻结块 key/text 不变
- [ ] 1.3 新建 `src/utils/markdownRuntime.ts`：`streamingMarked` / `fullMarked` 双 `Marked` 实例；
      语言注册与别名从 `MarkdownBlock.tsx` 迁入；katex 只挂 `fullMarked`
- [ ] 1.4 新建 `src/components/chat/MarkdownFragment.tsx`：
      memo（按 `text` 比较）+ 自持 `dangerouslySetInnerHTML` + 代码块头栏 effect
      （从 `MarkdownBlock.tsx:327-389` 迁入，作用域收窄到本 fragment）
- [ ] 1.5 改写 `MarkdownBlock.tsx`：
      `isStreaming` → 切块渲染 N 个 fragment；否则单 fragment 走 `fullMarked`（保留 mermaid/katex effect）
      保持对外 props 不变；加 `INCREMENTAL_MARKDOWN` 回滚常量
- [ ] 1.6 `useChatStore.ts` 流式合批：`pendingDeltas` + rAF flush；
      在 `[BLOCK_RESET]` / `[USAGE]` / `[SESSION_ID]` / `chat://done` / `chat://message` / abort
      六个入口补 `flushDeltas(requestId)`；`noteRequestActivity` 保持即时调用；
      加 `CHAT_STREAM_COALESCE` 回滚常量

**验证门 G1**
```bash
npm test -- markdownBlocks MarkdownBlock useChatStore
npm run build
```
手验：长回复流式过程中选中已输出文本 → 后续 token 不清选区（AC2）；
DevTools Performance 录制流式 3 秒，确认无长任务堆积（AC1）

---

## S2 — 滚动与跟随（P0）

- [ ] 2.1 新建 `src/utils/chatScrollFollow.ts`：纯函数
      `shouldFollowBottom({distanceFromBottom, threshold})`、
      `isDetachIntent(event)`、`resolveScrollBehavior({isStreaming, source})`
- [ ] 2.2 新建 `src/utils/chatScrollFollow.test.ts`
- [ ] 2.3 `useChatPaneController.ts`：替换 `194-201` 自动滚底 effect
      → rAF 合批 + 流式 `instant`；新增 `followRef` / `unreadCount`；
      `wheel`/`touchmove`/`keydown` 监听判定脱离意图；`updateBottomState` rAF 节流
- [ ] 2.4 `ChatPane.tsx`：接线节流后的 onScroll，透传 `unreadCount`
- [ ] 2.5 `ScrollControl.tsx`：未读角标 + 「N 条新消息」aria-label
- [ ] 2.6 zh/en locale 补「N 条新消息」文案

**验证门 G2**
```bash
npm test -- chatScrollFollow useChatPaneController ChatPane
npm run build
```
手验：流式中滚到中段停留 → 不被拽回底部（AC3）；滚回底部 → 自动恢复跟随；
DevTools 里滚动时 setState 频率 ≤ 10/s（AC4）

---

## S3 — 等待反馈与视觉统一（P1）

- [ ] 3.1 新建 `WorkingIndicator.tsx`：spinner + 已用时（1s tick）+ 实时 token +
      当前工具名；数据全部由 props 派生（D5 表），无 store 改动
- [ ] 3.2 新建 `TurnCompleteDivider.tsx`：`完成 · 12.3s · 1.2K tokens`
- [ ] 3.3 `MessageItem.tsx`：替换 `384-389` 绿点行为 `WorkingIndicator`；
      非流式 assistant 末尾接 `TurnCompleteDivider`；
      计算「当前工具」= 最后一个无 `tool_result` 的 `tool_use`
- [ ] 3.4 `StreamStallHint.tsx`：阈值分级（20s 弱提示 / 90s 停止按钮）
- [ ] 3.5 `App.css`：新增 `--chat-*` 排版变量（D7）；
      `MessageItem.tsx` 三角色分支收敛到统一基座 + 角色修饰类
- [ ] 3.6 `MessageItem.tsx`：assistant hover 工具条移到消息顶部常驻槽位
      （复制 / 引用到输入框 / 回到此处），替换 `absolute right-1 top-1`
- [ ] 3.7 `ChatPage.tsx`：顶部 chrome 收敛——移除与 `StatusStrip` 重复的 daemon 状态，
      SDK/清空并入紧凑条
- [ ] 3.8 zh/en locale 补全新文案

**验证门 G3**
```bash
npm test -- WorkingIndicator TurnCompleteDivider MessageItem StreamStallHint ChatPage
npm run build
```
手验：等待期能同时看到耗时/token/工具名（AC5）；回合结束有收尾条（AC6）；
1280 / 1920 / 2560 三档宽度下内容宽度自适应、三角色视觉统一（AC7）

---

## S4 — 转录信息密度（P2）

- [x] 4.1 中间步骤折叠：`toolStepFolding.ts` + 单测（纯函数），
      工具类条目 > 8 时把中间部分折成一枚 chip，保留首 2 尾 3；
      文本/思考/图片永不折叠；流式期间不折叠
- [x] 4.2 `ContentBlockRenderer.tsx` 接入折叠方案 + chip 样式 + zh/en 文案
- [ ] ~~4.3 `turnFileChanges.ts` + `TurnFilesChangedCard.tsx`~~ —— **撤销，见下方决策 E2**

**验证门 G4**
```bash
npm test -- toolStepFolding ContentBlockRenderer
npm run build
```
手验：跑一轮含十几次工具调用的任务 → 中间步骤折叠为 chip，点击展开（AC8 折叠部分）

---

## S6 — 工具卡片识别度（第七轮，补上一轮漏掉的「工具卡片」诉求）

六轮只做了中间步骤折叠，没动单个工具卡片的呈现。逐个对标 cc-gui 的 toolBlocks
清单后发现三类工具在我们这里全部落到 `GenericToolBlock` + 扳手图标：

| 工具 | 现状 | 对方 |
|------|------|------|
| `mcp__<server>__<tool>` | 卡片显示原始名，扳手图标 | `McpToolBlock.tsx` |
| `WebFetch` / `WebSearch` | 同上，URL/query 埋在参数里 | — |
| `ExitPlanMode` | plan 正文当普通参数打印，不渲染 Markdown | `ExitPlanToolContent.tsx` |

- [x] 6.1 `mcpToolName.ts` + 单测：解析 `mcp__server__tool`，含多段与畸形名兜底
- [x] 6.2 `types/tools.ts` 新增 `mcp` / `web` / `plan` ToolType 与识别
      （MCP 靠前缀判定且必须早于名称集合，否则 `mcp__files__read` 会被误判成本地 Read）
- [x] 6.3 `toolPresentation.ts`：MCP 分支早于 target/command；
      **顺带修掉既有缺陷**——WebSearch 入参就是 `query`，原先先命中
      `summarizeSearchInput`，导致 `websearch` 分支是死代码、联网搜索和本地 Grep 长得一样
- [x] 6.4 `GenericToolBlock`：MCP 用插头图标 + 干净工具名（原始名进 title），Web 用地球图标
- [x] 6.5 `PlanToolBlock`：ExitPlanMode 的 plan 用 MarkdownBlock 渲染，默认展开
- [x] 6.6 `ContentBlockRenderer` 路由 + zh/en 文案

**验证门 G6** — 通过（871 例 + build）

---

## S7 — 输入区与会话标签（第七轮，补上一轮漏掉的另两块诉求）

- [x] 7.1 **上箭头草稿历史只能回退一步**：`navigateDraftHistory` 的守卫是「草稿为空
      才接管」，而 `applyDraftFromHistory` 一执行就把草稿填满了 → 第二次上箭头被拒。
      决策逻辑抽成纯函数 `resolveDraftHistoryNavigation`（ignore / consume / apply 三态），
      并补上多行草稿的光标位置守卫（放开「继续接管」后才出现的新冲突）
- [x] 7.2 **标签多到一定数量后点不到**：标签条刻意 `overflow-hidden`（既有测试有显式
      `not.toContain('overflow-x-auto')` 断言），但 `min-w-24` 下限让 8 个以上标签被挤出
      可视区。压到 `min-w-11`，像浏览器那样极限压缩到只剩图标 + 关闭按钮
- [x] 7.3 **右键菜单跑出屏幕**：`contextMenuPosition.ts` 按菜单尺寸翻转 + 钳制
- [x] 7.4 标签中键关闭

**验证门 G7** — 通过（890 例 + build）

### E4 没有把标签条改成横向滚动

第一版改成了 `overflow-x-auto`，随后发现测试里有 `not.toContain('overflow-x-auto')`
的显式断言——前一个会话是刻意从横向滚动换成压缩单行的。不清楚原因就翻回去，会把
当初促成那个决定的问题一起带回来。因此改用不与该决策冲突的修法（压低宽度下限），
并把这条约束及其理由写进测试，避免下一次再来回摆。

---

## S5 — 长会话滚动成本（P2）—— **撤回，见决策 E3**

- [x] ~~5.1 `.chat-message-row` 加 `content-visibility: auto`~~ 已 revert

---

## 执行期偏离决策

### E1 StreamStallHint 的 90s 阈值保持不变（原计划 3.4 要分级下调）

计划里写的是「静默 20s 给弱提示，90s 给停止按钮」。落地 `WorkingIndicator`
之后重新评估：这一项要解决的问题（PRD #11「90s 才提示，中间 89s 用户完全不知道
系统是否活着」）已经被持续计时 + 当前工具名直接解决了。而 20s 再叠一条横幅，
在「0:20 · 执行 Bash」已经显示的情况下纯属噪音——与本轮要降的信息密度目标相反。

90s 这个数有明确理由（长 Bash 任务本来就可能长时间无输出），它测的是
「daemon 静默多久」，和回合耗时是不同信号。没有新证据就不动它。

### E2 撤销「本轮文件变更汇总卡」（原计划 4.1–4.3）

动手前核对发现右侧 dock 的 StatusStrip/ReviewPanel 已经在展示
`pane.statusSummary.allEdits`（文件清单 + 增删行数 + 点击跳转 diff），
`buildChatStatusSummary` 就是现成的聚合实现。再在每条 assistant 消息下加一张卡：

1. 信息重复，且重复的正是本轮要削减的密度；
2. `buildChatStatusSummary` 按 `ChatMessage[]` 聚合，tool_result 落在后一条 user
   消息里，单条消息喂进去会把所有工具算成 pending——要正确复用得改它的签名或
   造合成消息，为一个重复信息付这个代价不值。

AC8 的「本轮文件变更」部分因此未交付，已在下方验收清单标注。

### E3 撤回 `content-visibility: auto`（原计划 S5 全部）

先加上了、跑通了 build，随后核对既有功能时发现两点，决定 revert：

1. `MessageAnchorRail` 靠 `node.offsetTop`（`MessageAnchorRail.tsx:139` 判定当前
   锚点、`:244` 计算跳转目标）定位。`content-visibility: auto` 下视口外消息只有
   `contain-intrinsic-size` 的占位高度，`offsetTop` 是估算值——跳转会先落到近似
   位置、渲染真实内容后再位移。这是在拿用户正在用的锚点导航精度换性能。
2. 收益本来就被覆盖掉大半：渲染条数已由 `VISIBLE_MESSAGE_WINDOW`（15 + 每页 30）
   封住，DOM 里的消息数是有界的，遮挡优化的边际收益远小于无界长列表的场景。

顺带确认过 `contain: paint` 的裁剪风险不成立：消息内部的三个全屏浮层
（MermaidViewer / RewindConfirmDialog / ImageLightbox）都走 `createPortal`
到 document.body，toolBlocks 里没有非 portal 的绝对定位浮层。
也就是说这条属性不会破坏浮层，但上面第 1 点仍然成立。

AC 中「长会话滚动成本」一项因此未交付。若后续确实需要，正确做法是改造
`MessageAnchorRail` 改用 `IntersectionObserver`（它已经在用）+ 相对偏移，
而不是继续依赖 `offsetTop`。

---

## 最终回归（AC10）

逐项手验前五轮已交付能力，任一项破了就地修复后再进 Phase 3：

- [ ] 忙时消息排队 + 点击排队项回填编辑
- [ ] TodoWrite 可视化 + 头部进度条
- [ ] 消息级 rewind（含文件恢复二选一）
- [ ] Mermaid 渲染 + 全屏查看器（缩放/平移/Esc）
- [ ] KaTeX 公式（货币 `$5` 不误伤）
- [ ] compact 分隔条 + 压缩摘要折叠卡
- [ ] 输入框补全菜单（@ / # / ! / /）、Esc 中止、增量撤销
- [ ] 侧聊多标签并发发送 + 就地权限弹窗
- [ ] 锚点导航 rail + 转录搜索（含完整历史补载）
- [ ] 三类审批弹窗（AskUserQuestion / PlanApproval / ToolPermission）

## 验证命令汇总

```bash
npm test          # vitest run
npm run build     # tsc && vite build
npm run tauri dev # 手验（Rust 未改，前端 HMR 生效）
```

## 风险与应对

| 风险 | 应对 |
|------|------|
| 合批打乱 delta 与 BLOCK_RESET/MESSAGE 的相对顺序 → 文本段错位 | 六个 flush 点逐一补齐；`useChatStore.test.ts` 加保序用例；`CHAT_STREAM_COALESCE` 可直通旧路径 |
| 冻结块假设被破坏 → 流式中内容跳变 | 移植原算法不改动，单测覆盖冻结不变性 |
| 视觉重构改动面广，回归成本高 | S3 拆成独立 commit；不动交互逻辑只动 class/CSS 变量 |
| 并发会话同时改 chat 模块 | 每阶段动手前 `git status` + `find src -newermt '3 minutes ago'` 探测 |
| `content-visibility` 引发滚动条跳动 | 单独末阶段、单行 CSS，可即时回滚 |
