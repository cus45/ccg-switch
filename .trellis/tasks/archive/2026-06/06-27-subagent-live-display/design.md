# Design — 子代理实时展示与会话隔离

## 数据流总览

```
Claude Agent SDK (query async-gen)
  │  yields 主 + 子代理消息(子代理消息带 parent_tool_use_id)
  ▼
daemon: persistent-query-service.js executeTurn 主循环
  │  ── 主消息 → [MESSAGE]/[CONTENT_DELTA]/[TOOL_RESULT]/[USAGE]（不变）
  │  ── 子代理消息(parent_tool_use_id 非空) → [SUBAGENT_MESSAGE]（新），不进主流
  ▼
Rust manager.rs send() reader 循环
  │  ── "[MESSAGE]"  → emit chat://message（不变）
  │  ── "[SUBAGENT_MESSAGE]" → emit chat://subagent-message（新）
  │  ── 其余 → chat://stream（不变）
  ▼
前端 useChatStore
  │  ── chat://message：主消息 merge 进当前 tab（新增 parent_tool_use_id 防御:有则改路由）
  │  ── chat://subagent-message：merge 进 subagentRuns[parentToolUseId]（新）
  ▼
AgentGroupBlock(toolId=Task工具块id) → SubagentHistoryPanel
     有 subagentRuns[toolId] → 渲染 live;否则磁盘回退(historical)
```

关键不变量:**子代理消息的 `parent_tool_use_id` === 渲染该子代理卡片的 Task 工具块 `block.id`(= AgentGroupBlock.toolId)**。所有路由以此为键。

## 1. Daemon 改动(`services/claude/`)

### 1.1 主循环过滤(`persistent-query-service.js executeTurn`)
在取到 `const msg = next.value;` 后、进入现有 stream_event / shouldOutputMessage 分支**之前**插入子代理分流:

- `const parentToolUseId = msg?.parent_tool_use_id;`
- 若 `parentToolUseId`(非空):
  - `stream_event` 类型:**直接 `continue`**(MVP 不做子代理 token 级流式,避免无 parent 标记的 delta 泄漏进主 `[CONTENT_DELTA]`)。
  - `assistant` / `user` 类型:`emitSubagentMessage(parentToolUseId, msg)` 然后 `continue`(不走主 `[MESSAGE]`、`processMessageContent`、`emitUsageTag`、`processToolResultMessages`、`[SESSION_ID]`)。
  - 其它(`system`/`result` 等):`continue`(丢弃,卡片不需要)。

`emitSubagentMessage` 用 `writeRawLine` 等价的 stdout 写:
```
[SUBAGENT_MESSAGE] {"parentToolUseId": "<id>", "message": <完整 msg JSON>}
```
注:子代理 assistant 消息**无条件**整条发出(不套用 `shouldOutputMessage` 的 text-only 抑制),保证卡片能拿到最终回复与 tool_use。

### 1.2 兼容
- 旧前端收到未知 `[SUBAGENT_MESSAGE]` 文本行 → chat://stream handler 命中"未知 tag 忽略"分支,不渲染、不崩(降级为"卡片空")。
- 不改 `shouldOutputMessage` 主逻辑,主 agent 行为零变化。

## 2. Rust 协议层(`commands/chat_commands.rs` + `chat/manager.rs`)

### 2.1 事件
新增前端事件 `chat://subagent-message`,载荷:
```rust
struct SubagentMessageEvent { request_id: String, parent_tool_use_id: String, json: String }
```
`manager.rs send()` 的 reader 在现有 `[MESSAGE]` 分支旁新增:`if let Some(rest) = text.strip_prefix("[SUBAGENT_MESSAGE]")` → 解析出 `parentToolUseId` 与 `message`,`app.emit("chat://subagent-message", ...)`。沿用现有 `chat://stream` 原样转发(无害)。

## 3. 前端 store(`stores/useChatStore.ts` + `types/chat.ts`)

### 3.1 类型
- `MessageRaw` 增加可选 `parent_tool_use_id?: string | null`(用于防御路由)。
- 新增 `SubagentMessageEvent { requestId; parentToolUseId; json }`。

### 3.2 状态
- 顶层 + tab 级:`subagentRuns: Record<string /*parentToolUseId*/, ChatMessage[]>`。
  - 选型:挂在 **tab** 上(随会话 tab 投影/切换),与现有 `ChatSessionTab` 一致,避免跨 tab 串台。退一步 MVP 可先放顶层全局 map(toolId 全局唯一),但需在 `clear()`/切 tab 时清理。**采用 tab 级**以符合现有架构(projectTabToState 等)。
- action:无需用户操作;由事件驱动写入。

### 3.3 路由
- 新监听 `chat://subagent-message`:`raw = JSON.parse(json)` → `updateRequestTabState`/按 requestId 定位目标 tab → `subagentRuns[parentToolUseId] = mergeRawChatMessage(existing ?? [], raw, {createId,now})`。复用 `mergeRawChatMessage`(已能合并 assistant 快照、tool_result、user)。
- `chat://message` 防御:解析后若 `raw.parent_tool_use_id` 非空 → 路由进 `subagentRuns`,**不**进主 `messages`(双保险,兼容旧 daemon)。
- `chat://stream` [CONTENT_DELTA] 等:保持现状(daemon 已不再为子代理发 delta)。

## 4. 前端组件(`toolBlocks/AgentGroupBlock.tsx` + `SubagentHistoryPanel.tsx`)

### 4.1 路由接入
- `AgentGroupBlock` 已有 `toolId`;传给 `SubagentHistoryPanel`。
- `SubagentHistoryPanel` 新增读取 `liveMessages = useChatStore(s => s.<currentTab>.subagentRuns[toolId])`。
- 若 `liveMessages?.length`:用它构建 `buildSubagentProcessModel` + 渲染消息(复用现有 render),**跳过磁盘加载**。
- 否则走现有磁盘加载(historical),但修竞态。

### 4.2 加载竞态修复(治 bug2 表象)
- 移除把 `loading` 当重入守卫的反模式:用 `requestKey`(deps 派生字符串)+ ref 记录"已加载/在加载的 key";cleanup 不再留下 `loading=true` 死态。
- 增加"运行中"态:Task 无 result 且无 live 数据 → 显示运行中占位(非永久 spinner);有 result 或 live 数据再渲染轨迹。

## 5. 边界 / 兼容 / 回滚

- **并发**:键为 `parent_tool_use_id`,A/B 天然隔离(AC2)。
- **历史**:无 live 数据时磁盘回退,行为同今(已修竞态)(AC5/R6)。
- **Codex**:仅在 Claude provider 分支处理;Codex 不变(C1)。
- **主对话**:不改主 agent 的 [MESSAGE]/[CONTENT_DELTA]/usage/tab 路由(C2)。
- **向后兼容**:新 tag 旧前端忽略;新前端无 live 数据时降级磁盘(C3)。
- **回滚点**:
  1. 仅前端(store 路由 + 组件 + 竞态修复)可独立先上 → 立刻治 bug2 + 对"以 [MESSAGE] 带 parent_tool_use_id 形式泄漏"的 bug1 生效。
  2. daemon 过滤 + [SUBAGENT_MESSAGE] 为第二步 → 彻底治 bug1(含 delta 泄漏)+ 提供 live 轨迹。
  任一步可单独 revert,互不破坏(前端无 live 数据则磁盘回退)。

## 6. 取舍

- **消息级 vs token 级**:MVP 取消息级快照(子代理每条消息到达即显示),实现简单且足够;token 级流式(`[SUBAGENT_DELTA]`)留作后续增强。
- **store map 归属 tab vs 全局**:取 tab 级,贴合现有 tab 投影架构,避免切 tab 串台与清理遗漏。
