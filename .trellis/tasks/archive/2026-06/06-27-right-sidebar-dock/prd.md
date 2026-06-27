# 右侧边栏工具坞重构

## Goal

把聊天页右侧过于拥挤的 `StatusPanel` 重构成**卡片式工具坞**(参考用户截图):右上角常驻收起/展开按钮,收起时整条侧栏完全隐藏(不留空白槽);展开时显示卡片菜单,点卡片打开对应工具面板,可返回菜单。

## 已定决策(brainstorm)

- **MVP 范围**:① 工具坞骨架(卡片菜单 / 右上角常驻收起 / 完全隐藏)② 文件面板(树形浏览)③ 审查面板(git 工作区 diff)。**侧边聊天、浏览器推迟到后续阶段。**
- **交互模型**(据截图):卡片菜单为 home;点卡片打开单个面板(含返回菜单);右上角按钮收起=整条侧栏完全隐藏、对话区占满。一次开一个面板。
- **诊断信息去处**:现 StatusPanel 的 daemon/SDK/MCP/上下文/锚点等降级为**一条常驻细状态条**(留 daemon 状态 + 上下文用量%),SDK/MCP/锚点收进可展开小入口。
- **diff 分工(职责分离)**:文件面板**纯浏览**(树 + 只读预览),对有 git 改动的文件在树上打标记、点击跳到审查;审查面板 = 改动文件列表 + diff(unified/split),并把**聊天编辑过的文件**(现 `allEdits`)并入一起看。

## Confirmed facts (来自代码)

- 当前布局 `ChatPage.tsx`(~1001–1201):`ChatSessionSidebar`(左)→ 对话区 → 条件 diff 区(`EditDiffPreview`)→ 固定 `StatusPanel`(320px)。用户所指"最右侧边栏"= StatusPanel。
- `EditDiffPreview` 吃**预计算的** `DiffPreviewLine[]`(+filePath/additions/deletions/mode),可直接复用渲染审查 diff。
- 现有可用命令:`chat_list_workspace_files`(扁平 BFS ≤50)、`chat_open_path_in_explorer`、`chat_git_list_branches`、`chat_workspace_status`(is_git/branch)、`chat_open_project_in_terminal`。
- **缺口(需新增后端命令)**:无目录单层列举(树按需展开)、无读文件内容(预览)、无 git 工作区改动列表与逐文件 HEAD/工作区内容。
- 文件树根 = 当前会话工作目录 `currentCwd`。

## Requirements

- R1 右侧栏 = 卡片工具坞;收起/展开按钮**常驻右上角**;收起时**整条侧栏完全隐藏**,对话区占满,无残留空白。
- R2 文件面板:以 `currentCwd` 为根**树形**浏览(目录按需展开),点文件**只读预览**;对有 git 改动的文件打标记,点标记跳审查。
- R3 审查面板:列出 git 工作区改动文件 + 选中看 diff(复用 `EditDiffPreview`,unified/split);并入聊天编辑过的文件;**无 git 仓库则不显示审查卡**。
- R4 细状态条:常驻显示 daemon 状态 + 上下文用量%;其余诊断(SDK/MCP/锚点)收进可展开入口,功能不丢。
- R5 不回归:现有对话流式、工具块、多 tab、会话切换、左侧会话栏不受影响。

## Acceptance Criteria

- [ ] AC1 收起后右侧无残留空白、对话区占满;展开/收起按钮始终在右上角。
- [ ] AC2 工具坞展开显示卡片菜单;点"文件"/"审查"进入对应面板,可返回菜单。
- [ ] AC3 文件面板以 currentCwd 为根树形浏览、目录可按需展开、点文件只读预览。
- [ ] AC4 有 git:审查列出工作区改动文件并能看 unified/split diff;聊天编辑过的文件也在其中。
- [ ] AC5 无 git 仓库:审查卡不出现(文件面板仍可用)。
- [ ] AC6 细状态条常驻显示 daemon + 上下文用量%;原 SDK/MCP/锚点信息仍可达。
- [ ] AC7 现有对话/工具块/多 tab/会话切换无回归;`cargo test` / `tsc` / `vitest` 通过。

## Out of scope (本版)

- 侧边聊天(分屏)、浏览器(内嵌)— 后续阶段。
- 审查的暂存/提交/分支对比等 git 操作;MVP 只读展示工作区改动 vs HEAD。

## Open questions

- 无阻塞性产品问题;剩余为技术设计(见 design.md)。
