# Design — 右侧边栏工具坞重构

## 架构总览

```
ChatPage 右侧:  [对话区] → <RightDock />   (替换原 diff区 + StatusPanel(320))

RightDock 状态机:
  collapsed ──(右上角按钮)──> expanded
  expanded:
    ├─ StatusStrip(常驻细条:daemon 状态 + 上下文用量%,可展开看 SDK/MCP/锚点)
    └─ body:
        ├─ 'menu'  → DockMenu(卡片:文件 / 审查[仅 git])
        ├─ 'files' → FilesPanel(树 + 只读预览)         ←返回菜单
        └─ 'review'→ ReviewPanel(改动列表 + EditDiffPreview)←返回菜单
  collapsed → 整条 dock 不渲染(宽度 0);仅右上角悬浮一个展开按钮。
```

单面板:`activePanel ∈ {menu, files, review}`。收起按钮始终在右上角(展开态在 dock header 右上;收起态为对话区右上角的悬浮按钮)。

## 布局接入(ChatPage.tsx)

- 现状:`flex` 三栏 — 对话(`conversationPaneWidth`)/ 条件 diff(`diffPaneWidth`)/ 固定 StatusPanel(`statusPaneWidth=320`)。
- 改为:对话区 + `<RightDock>`。`RightDock` 自管宽度(展开 ~320–420px,收起 0)。
- 原"条件 diff 区(`selectedEdit`→`EditDiffPreview`)"**并入 ReviewPanel**:选中改动文件即在 dock 内看 diff,不再单列一栏。
- 收起=`RightDock` 返回 `null`(或宽度 0 容器),对话区 `flex:1` 占满 → 无残留空白(满足 AC1)。
- dock 展开/收起态 + activePanel **持久化**(复用 `chatSessionSidebarState` 同款 localStorage 方案,新增 `rightDock` 段)。

## 新增后端命令(`commands/chat_commands.rs`)

均做路径校验(在 `currentCwd` 下、拒控制字符、限大小),`spawn_blocking` 跑文件/git IO。

1. `chat_list_directory(path) -> Vec<DirEntry{name, isDir}>`:列**单层**(供树按需展开),跳过重型目录(node_modules/.git/target…),排序目录在前。
2. `chat_read_text_file(path, maxBytes?) -> {content, truncated, tooLarge}`:读文本预览;二进制/超限给标记不读全。
3. `chat_git_changed_files(cwd) -> {isGit, files: [{path, status, additions, deletions}]}`:`git status --porcelain` + `--numstat`;非 git 返回 `isGit:false`(前端据此隐藏审查卡)。
4. `chat_git_file_contents(cwd, path) -> {oldContent, newContent}`:`git show HEAD:<path>`(旧)+ 读工作区(新);新增文件 old=空、删除文件 new=空。

> 复用现成 `find_git_entry`/`resolve_git_dir`(已在 chat_commands.rs)定位仓库;git 子命令走 `std::process::Command`(Windows 加 `creation_flags` 防闪窗,参照现有 `list_chat_git_branches_for_path`)。

## 前端组件与数据流

- `src/components/chat/dock/RightDock.tsx`:状态机 + 持久化 + 收起/展开按钮 + StatusStrip + body 路由。
- `DockMenu.tsx`:卡片(文件 / 审查)。审查卡仅当 `chat_git_changed_files.isGit` 为真时渲染。
- `FilesPanel.tsx`:以 `currentCwd` 为根,`chat_list_directory` 懒加载树;点文件 `chat_read_text_file` 只读预览(代码用等宽,大文件截断提示);树节点若在 git 改动集合内打 badge,点 badge → `setActivePanel('review')` 并定位该文件。
- `ReviewPanel.tsx`:`chat_git_changed_files` 列表 + **并入** `useChatStore` 现有 `statusSummary.allEdits`(聊天编辑文件);选中文件 → `chat_git_file_contents` 取 old/new → 复用 `toolPresentation` 的 diff 行计算得 `DiffPreviewLine[]` → `EditDiffPreview`(unified/split 切换,复用现有 `diffViewMode`)。
- `StatusStrip.tsx`:从 `useChatStore` 取 daemon 状态 + 上下文用量%;一个可展开抽屉放 SDK/MCP/锚点(从现 StatusPanel 抽取这些子块复用)。

## 契约/类型

- 新增 TS 类型对齐 Rust:`DirEntry`、`GitChangedFile`、`GitFileContents`。serde camelCase。
- diff 渲染统一经 `DiffPreviewLine[]`(已有),git 与 chat 编辑共用渲染,避免重复。

## 兼容 / 回滚

- StatusPanel 的内容不丢:诊断 → StatusStrip(+抽屉);已编辑文件 diff → ReviewPanel。原 `StatusPanel.tsx` 保留其可复用子块(MCP/锚点/diff 控制)被新组件引用,逐步收敛。
- 不动 daemon/聊天协议、useChatStore 核心、左侧会话栏。
- 回滚点:RightDock 是对 ChatPage 右侧的**替换**;保留旧 StatusPanel 渲染分支于一个 feature 开关后,出问题可切回(或直接 revert 前端 + 新命令)。
- 后端新命令是**附加式**,不改既有命令;单独可回滚。

## 取舍

- 审查范围 MVP = 工作区(已暂存+未暂存)vs HEAD;不做 staged/branch 对比(后续)。
- 预览只读,不在 dock 内编辑(编辑仍走聊天/外部编辑器)。
- 浏览器/侧边聊天推迟:骨架的 `activePanel` 与卡片留好扩展位。
