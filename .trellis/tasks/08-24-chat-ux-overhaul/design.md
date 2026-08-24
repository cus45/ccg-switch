# 技术设计 — 对话模块体验深度重构

## 边界

- **纯前端**：不动 `src-tauri/`，不动 ai-bridge daemon 协议
- **不换 Markdown 栈**：继续 `marked@18` + `DOMPurify@3`
- **不动 store 数据模型**：不新增 tab 字段（避免四处投影链改动，见 memory `dcg-chat-benchmark` 教训 1）
- 触及文件集中在 `src/components/chat/**`、`src/utils/**`、`src/App.css`，
  外加 `src/stores/useChatStore.ts` 的**单点**流式合批改动

---

## 决策记录

### D1 保留 marked，在其之上做块级切分（不移植 react-markdown）

对方 `IncrementalMarkdown` 建立在 `react-markdown` 之上，每个块是一棵独立的 React 树。
我们的 `MarkdownBlock` 是 `marked.parse` → HTML 字符串 → `dangerouslySetInnerHTML`。

**选择**：只移植 `splitMarkdownBlocks` 这个**纯字符串算法**（对方文件本身也不依赖 react-markdown），
把 `MarkdownBlock` 改成「切块 → 每块一个 memo 子组件，各自 parse 各自的 innerHTML」。

**理由**：
- 切分算法是纯函数、有明确的冻结安全性论证，可原样移植并单测
- 换 react-markdown 要重写全部 `.markdown-block *` 样式钩子（App.css 里 100+ 行）、
  mermaid/katex 集成、代码块头栏、以及全部 `MarkdownBlock.test.tsx` 断言 —— 高风险、收益重叠
- 冻结块各自持有自己的 DOM 子树 → 追加文本不再动它们 → AC2（选区不丢）自动成立

**代价**：流式结束时从 N 个 fragment 切回单一全量 fragment，会有一次 DOM 重建闪烁。
与对方一致（"settle 后全量渲染自愈"），可接受。

### D2 双 `Marked` 实例隔离高亮成本

`hljs.highlightAuto` 是热路径杀手（无语言代码块遍历全部注册语言）。
但历史消息里它确实提供了有用的着色，不能一刀切删。

**选择**：`marked@18` 导出 `Marked` 类，建两个实例：

| 实例 | 用途 | highlight 策略 |
|------|------|----------------|
| `streamingMarked` | 流式期间的 fragment | 有已知语言 → `hljs.highlight`；否则**不高亮** |
| `fullMarked` | 流式结束 / 历史消息 | 现有行为（含 `highlightAuto`）+ katex 扩展 |

katex 扩展只 `use()` 到 `fullMarked` 上，流式期间公式按字面显示，settle 后成型 —— 与对方一致。

### D3 store 层帧合批，靠「非 delta 事件先 flush」保序

`useChatStore.ts:1428-1442` 的 `[CONTENT_DELTA]` 分支改为写入模块级缓冲：

```
pendingDeltas: Map<requestId, string>
flushHandle: number | null   // rAF
```

- delta 到达 → 追加缓冲 + 若无 pending 则 `requestAnimationFrame(flushAll)`
- `flushAll` 把每个 requestId 的缓冲一次性 `appendToStreamingAssistantMessages`
- **保序**：`[BLOCK_RESET]` / `[USAGE]` / `[SESSION_ID]` / `chat://done` / `chat://message` /
  `abort` 分支入口先调 `flushDeltas(requestId)` 同步排空，再走原逻辑

这是本轮唯一的 store 改动，无新字段、无投影链影响。
`noteRequestActivity(requestId)` 仍在 delta 到达时立即调用（卡死检测不能被合批延迟）。

**回滚**：`CHAT_STREAM_COALESCE = false` 常量直通旧路径。

### D4 跟随式滚动控制器

现状问题：effect 依赖 `[messages]` + `behavior:'smooth'`（`useChatPaneController.ts:194-201`）。

新模型，三个 ref：

| ref | 含义 | 变更时机 |
|-----|------|----------|
| `followRef` | 是否跟随底部 | 用户上滚手势 → false；滚回底部阈值内 → true |
| `pendingScrollRef` | 已排期的 rAF | 合批，一帧最多滚一次 |
| `unreadRef` | 脱离跟随后新增的可渲染消息数 | 恢复跟随时清零 |

- **用户意图判定**用 `wheel` / `touchmove` / `keydown(PageUp|ArrowUp|Home)` 监听，
  而不是 `scroll` 事件——`scroll` 无法区分程序滚动与用户滚动
- **滚动行为**：流式期间 `behavior:'instant'`（避免动画互相打断）；
  用户点「回到底部」用 `'smooth'`
- **`onScroll` 节流**：rAF 合并 + 值不变不 `setState`（AC4）
- `ScrollControl` 增加未读角标，`visible` 条件不变

### D5 等待反馈零 store 改动，全部从流式消息派生

| 指标 | 数据来源（已存在） |
|------|--------------------|
| 已用时 | 流式 assistant 消息的 `message.createdAt` |
| 实时 token | `message.usage.output_tokens`（`addUsageToStreamingAssistantMessages` 已在写） |
| 当前工具 | 消息 blocks 里最后一个无匹配 `tool_result` 的 `tool_use`，取 `block.name` |
| 完成耗时 | `message.durationMs`（`MessageMeta` 已在用） |

新组件 `WorkingIndicator.tsx` 替换 `MessageItem.tsx:384-389` 的绿点行 +
`StreamingPlaceholder`；回合完成分隔条 `TurnCompleteDivider.tsx`。
`StreamStallHint` 阈值改为分级常量（20s 弱提示 / 90s 停止按钮）。

### D6 虚拟化用 CSS occlusion，不写测量式虚拟列表

对方 `messagesTimelineVirtualization.ts` 是测量 + 投影的完整虚拟化。
我们的消息高度极不规则（工具卡片、diff、mermaid、图片），测量式虚拟化
在滚动位置补偿上极易出 bug，而现有 `VISIBLE_MESSAGE_WINDOW` 已挡住了大部分成本。

**选择**：`.chat-message-row { content-visibility: auto; contain-intrinsic-size: auto 200px; }`
浏览器跳过视口外子树的样式/布局/绘制，`auto` 关键字让其记住上次实测高度（无滚动条跳动）。

- 零 JS、零状态、可随时删掉一行 CSS 回滚
- 已确认不冲突：我们的转录搜索是自实现过滤（非浏览器 Ctrl+F）；
  锚点跳转用 `scrollIntoView`，浏览器会强制布局被跳过的子树
- 降级：旧 WKWebView 不支持时属性被忽略，行为等同现状

### D7 视觉统一走 CSS 变量，不逐个组件改 Tailwind 串

在 `App.css` 定义一组对话排版变量：

```
--chat-content-width      内容可读宽度（宽屏放宽到 clamp）
--chat-row-gap-y          行间距
--chat-row-pad-x/y        行内边距
--chat-surface-radius     统一圆角
--chat-surface-border     统一描边
```

`MessageItem` 三个角色分支共用同一套 `.chat-message-row` 基座 + 角色修饰类，
差异只保留「谁需要气泡背景」。避免在 JSX 里堆叠长 Tailwind 串（现状 `MessageItem.tsx:320-437`）。

---

## 数据流（改动后）

```
daemon stdout
  │
  ├─ [CONTENT_DELTA] ──► pendingDeltas 缓冲 ──rAF──► store.set 一次
  │                        ▲
  ├─ 其它标签行/done ──flush┘（保序）
  │
  ▼
useChatStore.messages
  │
  ▼
useChatPaneController ── followRef/rAF 合批 ──► scrollEl
  │
  ▼
MessageList ──► MessageItem
                 ├─ WorkingIndicator（streaming：耗时/token/当前工具）
                 ├─ ContentBlockRenderer ──► MarkdownBlock
                 │                            ├─ streaming: splitMarkdownBlocks
                 │                            │   └─ MarkdownFragment × N（memo，冻结块不重解析）
                 │                            └─ settled: 单一 fragment（fullMarked + katex + mermaid）
                 └─ TurnCompleteDivider（耗时/token）
```

---

## 新增 / 改动文件

### 新增
| 文件 | 职责 |
|------|------|
| `src/utils/markdownBlocks.ts` | `splitMarkdownBlocks` 纯函数（移植 + 单测） |
| `src/utils/markdownRuntime.ts` | `streamingMarked` / `fullMarked` 双实例与 katex 装载 |
| `src/components/chat/MarkdownFragment.tsx` | 单块渲染单元（memo + 自持 innerHTML + 代码块头栏 effect） |
| `src/components/chat/WorkingIndicator.tsx` | 工作中指示器 |
| `src/components/chat/TurnCompleteDivider.tsx` | 回合完成分隔条 |
| `src/utils/chatScrollFollow.ts` | 跟随判定纯函数（可单测） |
| `src/utils/turnFileChanges.ts` | 本轮文件变更聚合 |
| `src/components/chat/TurnFilesChangedCard.tsx` | 本轮文件变更卡 |

### 改动
| 文件 | 改动 |
|------|------|
| `src/stores/useChatStore.ts` | 仅 `chat://stream` 分支加合批 + flush 点 |
| `src/components/chat/MarkdownBlock.tsx` | 拆成 orchestrator，解析逻辑下沉到 fragment |
| `src/components/chat/useChatPaneController.ts` | 滚动控制器重写 |
| `src/components/chat/ChatPane.tsx` | onScroll 节流接线、未读计数透传 |
| `src/components/chat/MessageItem.tsx` | 视觉统一 + WorkingIndicator/分隔条接入 + hover 工具条 |
| `src/components/chat/ScrollControl.tsx` | 未读角标 |
| `src/components/chat/StreamStallHint.tsx` | 分级阈值 |
| `src/pages/ChatPage.tsx` | 顶部 chrome 收敛 |
| `src/App.css` | 排版变量 + content-visibility + 新组件样式 |
| `src/locales/{zh,en}.json` | 新文案 |

---

## 兼容性与回滚

| 阶段 | 回滚方式 |
|------|----------|
| S1 合批 | `CHAT_STREAM_COALESCE=false` 常量 |
| S1 增量 markdown | `MarkdownBlock` 内 `INCREMENTAL_MARKDOWN=false` 走原全量路径 |
| S2 滚动 | 独立 commit，`git revert` |
| S3 视觉 | 纯 CSS + JSX class 调整，独立 commit |
| S4 工具卡片 | 新增组件，删调用点即可 |
| S5 content-visibility | 删一条 CSS 规则 |

各阶段独立 commit，任何一阶段出问题不影响前序阶段已交付的收益。

## 已知取舍

1. 流式期间跨块的引用式链接 / 脚注按字面渲染，松散列表被切成多个 `<ul>`
   —— settle 后全量渲染自愈（与对方一致）
2. 流式结束时一次 DOM 重建闪烁（D1 代价）
3. `content-visibility` 在旧 WKWebView 无效果，macOS 老系统维持现状性能
4. 合批把 UI 更新降到每帧一次，极慢模型下逐字效果略"块状"——
   若观感变差，`useMarkdownStreamingValue` 式的渐进揭示留作后续增强，本轮不做
