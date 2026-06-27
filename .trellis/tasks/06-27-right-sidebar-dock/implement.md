# Implement — 右侧边栏工具坞重构

按"后端命令 → 骨架 → 文件面板 → 审查面板 → 状态条 → 接入 → 验证"推进。每阶段后跑验证门。

## 阶段 A — 后端命令(附加式,先可独立验证)

- [x] A1 `chat_list_directory(path, cwd?)`:单层目录列举 → `Vec<{name,isDir}>`;路径在 cwd 下校验、跳重型目录、目录在前排序;`spawn_blocking`。
- [x] A2 `chat_read_text_file(path, maxBytes?)`:读文本 → `{content, truncated, tooLarge}`;非 UTF-8/超限给标记。
- [x] A3 `chat_git_changed_files(cwd)`:`{isGit, files:[{path,status,additions,deletions}]}`;复用 `find_git_entry`;`git status --porcelain -z` + `git diff --numstat`(含已暂存)。
- [x] A4 `chat_git_file_contents(cwd, path)`:`{oldContent,newContent}`;`git show HEAD:<path>` + 读工作区;新增/删除分别空侧。
- [x] A5 注册到 `lib.rs` `generate_handler!`;Rust 单测覆盖路径校验、porcelain 解析、numstat 解析。
- [x] A6 验证门 A:`cargo test chat::` 全绿。

## 阶段 B — 骨架与收起/展开

- [x] B1 `utils/rightDockState.ts`:`{collapsed, activePanel:'menu'|'files'|'review'}` 持久化(仿 `chatSessionSidebarState`)。
- [x] B2 `components/chat/dock/RightDock.tsx`:状态机 + 右上角收起/展开按钮(展开态在 header、收起态悬浮于对话区右上)+ body 路由 + 返回菜单。收起 → 渲染 null/宽度0。
- [x] B3 `components/chat/dock/DockMenu.tsx`:卡片(文件 / 审查);审查卡按 `isGit` 条件渲染。
- [x] B4 i18n:卡片标题/收起展开/返回等 zh/en。
- [x] B5 验证门 B:`tsc` 干净;骨架渲染/收起测试(SSR 或组件测试)。

## 阶段 C — 文件面板

- [x] C1 `FilesPanel.tsx` + `fileTreeUtils.ts`:以 `currentCwd` 为根,`chat_list_directory` 懒加载子节点;展开/折叠;点文件 `chat_read_text_file` 只读预览(等宽、截断提示)。
- [x] C2 改动标记:取 `chat_git_changed_files` 的 path 集合,树节点命中打 badge;点 badge → 切审查并定位。
- [x] C3 验证门 C:`tsc`/`vitest`;fileTreeUtils 纯函数测试(路径/排序/懒加载状态)。

## 阶段 D — 审查面板

- [x] D1 `ReviewPanel.tsx`:`chat_git_changed_files` 列表 + 并入 `statusSummary.allEdits`;选中 → `chat_git_file_contents` → 复用 `toolPresentation` diff 行计算 → `EditDiffPreview`(unified/split,复用 `diffViewMode`)。
- [x] D2 无 git:不渲染审查卡/面板(`isGit:false`)。
- [x] D3 验证门 D:`tsc`/`vitest`;diff 行计算复用测试。

## 阶段 E — 状态条 + 接入 ChatPage

- [ ] E1 `StatusStrip.tsx`:daemon 状态 + 上下文用量%;可展开抽屉放 SDK/MCP/锚点(从现 `StatusPanel.tsx` 抽可复用子块)。
- [ ] E2 `ChatPage.tsx`:用 `<RightDock>` 替换原 `statusPane` + 条件 diff 区;对话区 `flex:1`;收起时无残留空白。原 `selectedEdit`/`diffViewMode` 状态迁移给 ReviewPanel。
- [ ] E3 清理/保留:`StatusPanel.tsx` 仅保留被复用的子块;去掉重复入口。
- [ ] E4 验证门 E:`tsc`/`vitest`/`cargo test chat::` 全绿;无 git 与有 git 两种工作目录手测。

## 阶段 F — 收尾

- [ ] F1 三层验证全绿;人工验收 AC1–AC7(我跑不了 GUI,需用户)。
- [ ] F2 `.trellis/spec` 按需更新(右侧 dock 布局契约、新命令跨层契约)。

## 验证命令
```bash
npx tsc --noEmit
npx vitest run src/components/chat src/utils
cargo test chat::            # MSVC 环境经 vcvars64.bat
```

## 风险文件 / 回滚点
- `ChatPage.tsx` 布局接入(E2)风险最高:保留旧 StatusPanel 渲染于 feature 开关后,可快速切回。
- 后端命令(A)附加式,可单独 revert。
- 阶段 A–E 各自验证门 + `[review-gate]`;每段编辑后 `trellis-check`。
