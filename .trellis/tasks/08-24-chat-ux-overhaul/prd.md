# 对话模块体验深度重构（对标 desktop-cc-gui 第六轮）

## Goal

把 ccg-switch 对话模块从「功能都有、用起来难受」拉到「流畅、可读、心里有数」。
前五轮已把 desktop-cc-gui 的**功能**基本补齐（见 memory `dcg-chat-benchmark`），
本轮不再补功能清单，而是修**体感**：流式卡顿、滚动抖动、等待期黑箱、
视觉语言不统一、信息密度失控。

用户原话：「用户体验太差了，还不够好」「交互方面很多细节需要处理，
模型回复消息的内容，整个页面的布局等等方面都需要深入的优化」。

## 现状体检（已在代码中验证）

### P0 流式渲染是 O(n²)，这是所有卡顿的根源

| # | 位置 | 问题 |
|---|------|------|
| 1 | `src/stores/useChatStore.ts:1436` | 每条 `[CONTENT_DELTA]` 直接 `set()`，无节流。快速模型每秒几十次全局 store 更新 |
| 2 | `src/components/chat/MarkdownBlock.tsx:268-288` | 每次 content 变化对**整条消息**重跑 `marked.parse` + `DOMPurify.sanitize`。消息越长越慢 |
| 3 | `src/components/chat/MarkdownBlock.tsx:69` | 无语言代码块走 `hljs.highlightAuto`，遍历全部已注册语言，单次可达数十 ms，且每帧重跑 |
| 4 | `src/components/chat/MarkdownBlock.tsx:393-397` | `dangerouslySetInnerHTML` 每帧整块替换 DOM → 文本选中被清除、图片/滚动位置闪烁 |
| 5 | `src/components/chat/MarkdownBlock.tsx:327-389` | 代码块头栏 effect 依赖 `html`，每帧对**所有**代码块重做 DOM 手术 + 重绑事件 |

### P0 自动滚动策略错误

| # | 位置 | 问题 |
|---|------|------|
| 6 | `src/components/chat/useChatPaneController.ts:194-201` | 自动滚底 effect 依赖 `[messages]`，流式期间每个 token 触发一次 `scrollTo({behavior:'smooth'})`。平滑动画被不断打断重启 → 视觉抖动、始终追不上底部 |
| 7 | `src/components/chat/ChatPane.tsx:123` | `onScroll={updateBottomState}` 未节流，每个滚动事件一次 `setState` → 整个 pane 重渲染 |
| 8 | `useChatPaneController.ts:184-192` | 只有「是否接近底部」一个状态，没有「用户主动上滚 → 暂停跟随」的意图判定 |

### P1 等待期是黑箱

| # | 位置 | 问题 |
|---|------|------|
| 9 | `MessageItem.tsx:384-389` | 流式期间只有一个绿点 + 「Connected, generating response...」。没有计时、没有 token 数、不知道正在跑哪个工具 |
| 10 | — | 回合结束无收尾反馈。对方有 `Done in 12.3s` 分隔条（`WorkingIndicator.tsx:284-292`） |
| 11 | `StreamStallHint` | 90s 才提示，中间 89s 用户完全不知道系统是否活着 |

### P1 视觉语言不统一 / 布局浪费

| # | 位置 | 问题 |
|---|------|------|
| 12 | `MessageItem.tsx:320-437` | 三套割裂视觉：user=橙色气泡右对齐、assistant=无容器裸文本、system=白色卡片带左强调条 |
| 13 | `ChatPage.tsx:386-425` | 顶部 bar 占一整行，只放 daemon 状态 + SDK + 清空；daemon 状态在右侧 `StatusStrip` 已有一份，信息重复 |
| 14 | `MessageItem.tsx` 各处 | 固定 `max-w-4xl`，宽屏大量留白；行距/块间距在 `space-y-1`/`py-2`/`py-3` 间不一致 |
| 15 | `MessageItem.tsx:250-268` | assistant 复制按钮 `absolute right-1 top-1`，长消息里够不着；无「引用/重发/跳锚点」等操作 |

### P2 工具卡片与转录信息密度

| # | 问题 |
|---|------|
| 16 | 一轮里几十个工具调用平铺，中间步骤无法整体折叠（对方有 `MiddleStepsCollapsedChip`） |
| 17 | 无「本轮改了哪些文件」汇总卡（对方 `TurnFilesChangedCard` + `turnFileChanges.ts`） |
| 18 | `MessageList` 无虚拟化，靠 `VISIBLE_MESSAGE_WINDOW` 硬截断；长会话滚动到中段依然重（对方 `messagesTimelineVirtualization.ts`） |

## Requirements

### R1 流式渲染必须与消息长度脱钩（P0）
- store 层对 `[CONTENT_DELTA]` 做帧合并，UI 更新频率上限固定
- Markdown 按 CommonMark 块边界切分，已冻结块不再重新解析/重排
- 移除 `highlightAuto` 热路径；流式期间代码块降级为纯文本
- 冻结块的 DOM 在追加文本时保持不变（文本选中不丢、无闪烁）

### R2 滚动必须稳（P0）
- 流式跟随用 `instant` + rAF 合并，不用 smooth
- 用户主动上滚立即暂停跟随，回到底部区域自动恢复
- `onScroll` 节流，滚动不触发无谓重渲染
- 「回到底部」按钮显示未读新消息条数

### R3 等待期必须有实时反馈（P1）
- 统一 `WorkingIndicator`：spinner + 已用时 + 实时 token + 当前工具活动
- 回合完成显示 `完成 · 12.3s · 1.2K tokens` 分隔条
- 卡死提示阈值下调并分级（静默 20s 给弱提示，90s 给停止按钮）

### R4 视觉语言统一、布局让位给内容（P1）
- 三种角色统一到一套间距/圆角/描边 token
- 顶部 chrome 收进一行紧凑条或并入现有 StatusStrip，去掉重复的 daemon 状态
- 内容宽度自适应（可读上限 + 宽屏放宽），块间距统一
- assistant 消息 hover 工具条常驻在消息顶部，含复制/引用/回到此处

### R5 转录信息密度可控（P2）
- 一轮内的中间工具步骤可整体折叠为一枚 chip
- 每轮结束追加「本轮文件变更」汇总卡，点击跳转对应 diff
- `MessageList` 引入窗口虚拟化，滚动成本与历史长度脱钩

### R6 不回退已有能力
前五轮成果（排队、Todo 可视化、rewind、Mermaid/KaTeX、compact 分隔与折叠、
补全菜单、侧聊多标签、锚点导航、转录搜索）全部保持可用，测试不得变红。

## Constraints

- 不引入 `react-markdown` 全家桶：继续用 `marked` + `DOMPurify`，块级切分在其之上做
  （理由见 `design.md` 决策 D1）
- 不改 Rust / daemon 协议；本轮纯前端
- 保持 zh/en 双语同步（新增文案两个 locale 都要加）
- 保持 Tauri 窗口拖拽区与 DaisyUI 主题变量约定
- 每个阶段独立可回滚，不做一次性大爆炸提交

## Acceptance Criteria

- [ ] **AC1** 一条 8000 字的流式回复，追加最后一个 token 时不再重新解析全文；
      冻结块 DOM 节点在流式期间保持同一实例（测试断言块文本不变时子组件不重渲染）
- [ ] **AC2** 流式期间在已输出文本上选中一段，后续 token 到达不清除选区
- [ ] **AC3** 流式期间滚动跟随不抖动；用户上滚后不被强行拽回底部
- [ ] **AC4** 滚动事件不再每帧触发 pane 级 setState（节流后 ≤ 每 100ms 一次）
- [ ] **AC5** 等待期能同时看到：已用时、实时 token、当前正在执行的工具名
- [ ] **AC6** 回合结束有明确收尾反馈（耗时 + token）
- [ ] **AC7** 三种角色消息视觉统一，宽屏下内容宽度自适应
- [ ] **AC8** 一轮中间步骤可一键折叠；每轮结束能看到本轮文件变更清单
- [ ] **AC9** `npm test` 全绿，`npm run build`（tsc + vite）通过
- [ ] **AC10** 已有能力回归：排队/Todo/rewind/Mermaid/KaTeX/compact/补全/侧聊/锚点/搜索逐项手验通过

## Notes

- 对标源：`C:\guodevelop\demo\desktop-cc-gui`（已建 CodeGraph 索引）
- 关键参考实现：
  - `src/markdown/incremental/splitMarkdownBlocks.ts` — 块级切分算法
  - `src/markdown/incremental/IncrementalMarkdown.tsx` — memo 冻结块渲染
  - `src/markdown/hooks/useMarkdownStreamingValue.ts` — 节流 + 渐进揭示
  - `src/features/messages/rows/components/WorkingIndicator.tsx` — 工作中指示器
  - `src/features/messages/timeline/virtualization/messagesTimelineVirtualization.ts` — 虚拟化
  - `src/features/messages/utils/turnFileChanges.ts` — 本轮文件变更
- 并发风险：本仓库常有另一会话同时改动（memory `concurrent-sessions`），
  每阶段提交前必查 `git status` 的 `A ` 暂存条目
