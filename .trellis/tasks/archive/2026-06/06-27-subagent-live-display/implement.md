# Implement — 子代理实时展示与会话隔离

执行顺序按"先前端可独立上线、再 daemon 彻底治本"分两阶段(见 design §5 回滚点)。每阶段结束跑验证门。

## 阶段 A — 前端路由与展示(可独立上线,治 bug2 + [MESSAGE] 形式的 bug1)

- [ ] A1 `types/chat.ts`:`MessageRaw` 加 `parent_tool_use_id?: string | null`;新增 `SubagentMessageEvent { requestId; parentToolUseId; json }`。
- [ ] A2 `stores/useChatStore.ts`:
  - [ ] `ChatSessionTab` + 顶层 state 加 `subagentRuns: Record<string, ChatMessage[]>`;初值 `{}`;`createTabFromState`/`createEmptyTabFromState`/`projectTabToState` 同步带上。
  - [ ] `init()` 新增 `listen('chat://subagent-message')` → 解析 → `updateRequestTabState(state, requestId, tab => ({...tab, subagentRuns: mergeIntoRun(tab.subagentRuns, parentToolUseId, raw)}))`;`mergeIntoRun` 内部用 `mergeRawChatMessage`。
  - [ ] `chat://message` handler 防御:`if (raw.parent_tool_use_id)` → 同样进 `subagentRuns`,return(不进主 messages)。
  - [ ] `unlisteners` 注册新监听;`clear()`/切 tab 时 `subagentRuns` 随 tab 投影自然处理(确认无泄漏)。
- [ ] A3 `components/toolBlocks/AgentGroupBlock.tsx`:把 `toolId` 透传给 `SubagentHistoryPanel`(新增 prop)。
- [ ] A4 `components/toolBlocks/SubagentHistoryPanel.tsx`:
  - [ ] 新增 `toolId` prop;读 `liveMessages = useChatStore(选择当前 tab.subagentRuns[toolId])`。
  - [ ] 有 `liveMessages?.length` → 用其构建 `buildSubagentProcessModel` 并渲染,跳过磁盘加载。
  - [ ] 修加载竞态:用 `requestKey` + ref 取代 `loading` 作重入守卫;cleanup 不留 `loading=true` 死态。
  - [ ] 运行中态:无 result 且无 live 数据 → "运行中"占位,非永久 spinner。
- [ ] A5 i18n:如新增"运行中"文案,zh/en 同步。
- [ ] A6 验证门 A:`npx tsc --noEmit` 干净;`npx vitest run src/stores src/components/toolBlocks src/components/chat` 全绿;补/改单测(路由、合并、竞态、运行中态)。

## 阶段 B — Daemon 与 Rust 协议(彻底治 bug1 + live 轨迹源)

- [ ] B1 `src-tauri/resources/ai-bridge/services/claude/persistent-query-service.js` `executeTurn` 主循环:取 `msg` 后插入 `parent_tool_use_id` 分流——stream_event→continue;assistant/user→`emitSubagentMessage(parentToolUseId, msg)` then continue;其它→continue。
- [ ] B2 新增 `emitSubagentMessage`(同文件或 `message-output-filter.js`):`process.stdout.write('[SUBAGENT_MESSAGE] ' + JSON.stringify({parentToolUseId, message: msg}) + '\n')`;子代理 assistant 整条发(不套 shouldOutputMessage 抑制)。
- [ ] B3 `src-tauri/src/chat/manager.rs` `send()` reader:新增 `[SUBAGENT_MESSAGE]` 前缀分支 → 解析 `parentToolUseId`+`message` → `app.emit("chat://subagent-message", SubagentMessageEvent{...})`。
- [ ] B4 `src-tauri/src/models/chat.rs`(或就近):定义 `SubagentMessageEvent` serde 结构(camelCase)。
- [ ] B5 daemon 单测:扩展 `stream-event-processor` / 新增小测,断言带 `parent_tool_use_id` 的消息不走主 [MESSAGE]、走 [SUBAGENT_MESSAGE](可用纯函数化判定 + 注入 writer 捕获)。
- [ ] B6 验证门 B:`cargo test chat::` 全绿;`node --test`(若 ai-bridge 有测试运行器)或既有 `*.test.js` 跑通。

## 阶段 C — 端到端验证与收尾

- [ ] C1 三层验证:`cargo test chat::` / `npx tsc --noEmit` / `npx vitest run` 全绿。
- [ ] C2 人工验收(用户在 Mac/Win 实跑,我无法跑 GUI):AC1–AC6 逐条;尤其 AC2 双子代理并发、AC3 实时、AC5 历史回退。
- [ ] C3 `.trellis/spec` 按需更新(子代理消息隔离的跨层契约);`get_context.py` spec 索引。
- [ ] C4 调试日志:复用上一轮的 debug 模式面板观察 `chat://daemon` / 协议行,辅助验收。

## 验证命令

```bash
# 前端
npx tsc --noEmit
npx vitest run src/stores src/components/toolBlocks src/components/chat
# Rust(MSVC 环境,经 vcvars64.bat)
cargo test chat::
```

## 回滚

- 阶段 A 全前端、附加式:出问题 revert 前端 commit,子代理回到"磁盘加载(已修竞态)"。
- 阶段 B daemon/Rust:出问题 revert B,前端无 live 数据自动降级磁盘回退;主对话不受影响。

## 评审门

- 阶段 A、B 各自 `[review-gate]`:验证门通过 + 自查 AC 对应项,再继续下一阶段。
- 实施由 `trellis-implement` 子代理按本清单逐项推进;每段编辑后 `trellis-check`。
