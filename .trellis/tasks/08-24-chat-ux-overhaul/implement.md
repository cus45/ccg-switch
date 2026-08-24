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

- [ ] 4.1 新建 `src/utils/turnFileChanges.ts` + 单测：
      从一轮的 `tool_use`/`tool_result` 聚合 Edit/Write 涉及的文件与增删行数
      （参考 `desktop-cc-gui/src/features/messages/utils/turnFileChanges.ts`）
- [ ] 4.2 新建 `TurnFilesChangedCard.tsx`：文件清单 + 点击跳转对应工具锚点
      （复用 `controller.handleSelectStatusTool` 路径）
- [ ] 4.3 `MessageItem.tsx`：非流式 assistant 消息且本轮有文件变更时渲染该卡
- [ ] 4.4 中间步骤折叠：`ContentBlockRenderer.tsx` 在工具块数 > 阈值时，
      把首尾之外的部分折叠为一枚 chip（参考对方 `MiddleStepsCollapsedChip`）
- [ ] 4.5 zh/en locale 补文案

**验证门 G4**
```bash
npm test -- turnFileChanges TurnFilesChangedCard ContentBlockRenderer
npm run build
```
手验：跑一轮含多次 Edit 的任务 → 结束后能看到文件变更清单并可跳转（AC8）

---

## S5 — 长会话滚动成本（P2）

- [ ] 5.1 `App.css`：`.chat-message-row { content-visibility: auto; contain-intrinsic-size: auto 200px; }`
- [ ] 5.2 验证锚点跳转 / 转录搜索 / MessageAnchorRail 在 occlusion 下行为不变
- [ ] 5.3 若观察到滚动条跳动，调整 `contain-intrinsic-size` 基线或按角色分档

**验证门 G5**
```bash
npm test
npm run build
```
手验：加载 500+ 条历史的会话，滚动流畅度对比改动前

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
