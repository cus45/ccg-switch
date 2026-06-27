# 子代理实时展示与会话隔离

## Goal

修复 Claude 子代理(Task 工具)在聊天中的展示:让子代理拥有**自包含、实时、与主对话隔离**的展示卡片。当前存在两个缺陷:

1. **会话串台**:主 agent 发给子代理的 prompt 被渲染成用户("你")的顶层消息,污染主 transcript。
2. **轨迹卡死**:子代理执行轨迹永久"正在加载…"转圈;且全新/进行中的会话根本加载不出轨迹。

目标是:主 transcript 只保留主对话 + 子代理入口卡片;子代理的运行过程(工具调用、回复)实时显示在它自己的卡片里;支持多个子代理并发;历史会话重开仍可查看。

## Background / 根因(已定位)

- 串台:daemon `services/claude/persistent-query-service.js` 主循环对每条消息发 `[MESSAGE]`,`stream-event-processor.js` 的 `shouldOutputMessage` 对所有非 assistant 消息返回 true,**未按 `parent_tool_use_id` 过滤**子代理消息 → 前端 `utils/chatMessageFlow.ts` 的 `mergeRawChatMessage` 把子代理 user-prompt 当成顶层 user 消息追加。
- 卡死:`components/toolBlocks/SubagentHistoryPanel.tsx` 加载 effect 竞态——live 回填 sessionId 触发依赖变化 → in-flight 被 cancel → `.finally` 跳过 `setLoading(false)` → `loading` 永久为 true,且重入被 `if (loading) return` 挡住。轨迹源自磁盘 session(`get_claude_subagent_session_messages`),进行中/全新会话尚未落盘。
- 路由前提:`components/chat/ContentBlockRenderer.tsx` 给 `AgentGroupBlock` 传 `toolId={block.id}`,而子代理消息的 `parent_tool_use_id` 恰等于该 Task 工具块 id → 可按此精确路由。

## Requirements

### 功能
- R1 子代理消息(带 `parent_tool_use_id`)**不得**进入主 transcript;主对话只显示主 agent 的消息与子代理入口卡片。
- R2 子代理卡片在**运行中实时**显示子代理的执行过程(其工具调用、工具结果、最终回复),不依赖磁盘落盘。
- R3 支持**多个子代理并发**,各自路由到自己的卡片,互不串台(A 的消息只进 A 卡片)。
- R4 子代理运行结束后,卡片保留完整轨迹,可折叠/展开查看。
- R5 运行中卡片显示明确的"运行中"态,**不得**出现永久 spinner。
- R6 历史会话重开时,若无实时数据,回退到磁盘加载(保留现有能力),且不再卡死。

### 约束 / 兼容
- C1 仅针对 Claude provider 的子代理;Codex 行为不回归。
- C2 不破坏主对话的流式渲染、工具块渲染、会话历史加载、并发请求归属(tab 路由)。
- C3 daemon 协议变更需向后兼容:旧前端遇到新 tag 不崩(忽略即可),新前端遇到旧无 tag 行为可降级。
- C4 不引入对子代理 token 级流式的强依赖(消息级快照即可满足 MVP)。

## Acceptance Criteria

- [ ] AC1 启动 1 个子代理:主 transcript 不出现以"你"身份显示的子代理 prompt;prompt 仅在子代理卡片内可见。
- [ ] AC2 启动 2 个并发子代理(A/B):两条 prompt 都不进主 transcript;A、B 的过程分别显示在各自卡片,无交叉。
- [ ] AC3 子代理运行中,卡片实时出现其工具调用/回复;无永久"正在加载…"。
- [ ] AC4 子代理结束后,卡片展开可见完整过程(工具调用 + 最终回复)。
- [ ] AC5 重开一个含子代理的历史会话:卡片展开能显示轨迹(磁盘回退),不卡死。
- [ ] AC6 主对话本身(主 agent 文本流、工具块、用量、多 tab)无回归;Codex 会话无回归。
- [ ] AC7 `cargo test`、`tsc --noEmit`、`vitest` 全绿,新增逻辑有单测覆盖(daemon 过滤判定、前端路由/合并、加载竞态修复)。

## Notes

- MVP 采用**消息级快照**流式(子代理每条 assistant/user 消息到达即推送),非 token 级。token 级可作后续增强。
- 详细技术设计见 `design.md`,执行计划见 `implement.md`。
