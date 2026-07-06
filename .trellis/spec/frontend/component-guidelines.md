# Component Guidelines

> How components are built in this project.

---

## Overview

Components are **function components** with TypeScript. There are no class
components. Props are typed with a local `interface` named `<Component>Props`.
Components are kept presentational where practical: page components own state
and pass data + callbacks down to feature components.

---

## Chat Conversation Column: `ChatPane` + `useChatPaneController`

The full conversation column (session tab strip / transcript search / transcript /
scroll control / composer status tabs / composer) is one reusable component:
`components/chat/ChatPane.tsx`, fed by `components/chat/useChatPaneController.ts`.

- `useChatPaneController({tabKey, bindSearchShortcut})` scopes all
  transcript-derived state (search + full-history search, scroll follow,
  anchor navigation, `statusSummary`, selected edit) to one chat tab via
  `useChatTab(tabKey)`. When `tabKey` is `null` or misses, it falls back to the
  global active projection — identical to the pre-refactor `ChatPage` behavior.
  `bindSearchShortcut` (Ctrl/Cmd+F) must be enabled **only for the main pane**
  so multiple panes don't fight over the shortcut.
- `ChatPage` creates ONE controller for the main pane and shares that instance
  with the right dock (`StatusStrip` message/anchor/status data,
  `ReviewPanel`'s `allEdits`) — do not compute the summary twice.
- `ChatPane variant="main"` renders `ChatSessionTabs` (center session tabs) and
  passes `tabKey={undefined}` to `ChatComposer` so the composer stays on the
  global path (real abort). `variant="side"` skips the session tab strip, adds
  `h-full`, and passes the tab key so the composer uses tab-scoped actions
  (`useComposerChatBinding`): `sendInTab`/`updateTabConfig`/`setTabDraft`, with
  `canAbort=false` because backend `chat_abort` cannot target a requestId.
- Side chats mount `dock/SideChatPane`, which builds its **own** controller
  instance (independent search/scroll/anchor state) and computes sdk/mcp status
  from that tab's provider. The SDK management modal lives in `ChatPage` only.
- Permission dialogs (ask-user/plan/tool) keep the single global pending queue
  in the store, but rendering is routed: when the request's `sessionId` matches
  the session of the dock's visible side chat (`dockChatTabKey`), `ChatPane`
  renders the dialog **inline** (`container="inline"`, absolutely positioned
  over the side pane, which is `position: relative`); everything else — main
  chat, background side chats, requests without a sessionId — falls back to the
  center modal in `ChatPage` so a request always has somewhere to be answered
  (`shouldRoutePermissionToSideChat` in `utils/chatUiBehavior.ts`). Inline
  dialogs must NOT register global keyboard shortcuts (Esc/Enter) — the center
  modal owns them; a same-time center modal + side inline pair would otherwise
  double-fire.

## Chat Right Tool Dock: `DockShell` (tabbed documents; supersedes the card menu)

The dock is now a **tabbed multi-document shell** (`components/chat/dock/DockShell`):
a top `DockTabBar` (document tabs + a `+` menu) routing the body by the active
document. Document model + persistence live in `utils/dockDocuments.ts`
(`ccg-chat-dock-documents`): `DockDocument {id, kind, title, filePath?, chatTabKey?}`
with pure ops `openDockDocument` (dedupe by id + focus), `closeDockDocument`
(neighbor fallback for the active tab), `activateDockDocument`. `files`/`review`
are singletons; `file` docs key by path; `sideChat` docs key by chat tab key and
are **dropped on restore** (the chat tab pool does not survive restarts).

- Document routing: `files` → `FilesBrowser` (tree only; opening a file pushes an
  independent `file` doc), `file` → `FilePreview` (self-loading read-only view),
  `review` → `ReviewPanel` (unchanged), `sideChat` → `SideChatPane`.
- The `+` menu offers: New side chat, Files, Review (git repos only), and
  Close-all when documents exist. Closing a `sideChat` doc must call the store's
  `closeSideChat(chatTabKey)` (retires pending sends; falls back to center
  `closeTab` semantics if the user promoted that tab to the active center tab).
- Empty state reuses `DockMenu` as the launcher; width is ~360px empty and
  `min(46vw, 820px)` with documents; collapse/expand reuses `rightDockState`
  (only the `collapsed` field — `activePanel` is kept for the rollback path).
- Rollback: `ChatPage` picks `DockShell` vs legacy `RightDock` via
  `isDockShellEnabled()` (`localStorage ccg-chat-dock-shell` = `0|false|off`
  disables). Both docks share an identical prop shape — keep it that way.

## Legacy card dock (`RightDock`, rollback path only)

The Chat page's right side is a single collapsible **card tool dock**
(`components/chat/dock/RightDock`), not a fixed `StatusPanel` pane plus a
separate central diff pane. This replaces the earlier three-pane
(conversation / central diff / status) resizable layout: the conversation pane
is now `flex:1` and the dock is a fixed-width (~360px) desktop-only (`xl`) flex
child that fully collapses to a floating expand button with **no residual
width** (`.chat-review-layout` stays `position: relative` so the collapsed
button anchors to the conversation area). Dock collapsed state + active panel
persist in `localStorage` (`utils/rightDockState.ts`,
`ccg-chat-right-dock-state`), mirroring the `chatSidebarLayout` pattern.

- `RightDock` owns `{collapsed, activePanel: 'menu' | 'files' | 'review'}` and
  routes its body to `DockMenu` (cards: Files, plus Review only when the
  workspace `isGit`), `FilesPanel`, or `ReviewPanel`, with a back-to-menu
  control. It receives `currentCwd`, `gitRoot`, `allEdits`,
  `diffViewMode`/`onDiffViewModeChange`, `diffWrapLines`/`onDiffWrapLinesChange`,
  and a `statusStrip` node from `ChatPage`. The dock is ~360px wide for the menu
  and widens to `min(46vw, 820px)` for `files`/`review`, which lay out
  **left-right** (not stacked): the main preview / diff area beside a narrow
  (~240px) file-tree / changed-file-list column.
- `FilesPanel` renders a lazily-loaded tree rooted at `currentCwd`
  (`chat_list_directory` per directory level via `utils/fileTreeUtils`), a
  read-only text preview (`chat_read_text_file`, binary/truncation flagged), and
  a change badge on files in the git working-tree set that jumps to Review.
- `ReviewPanel` lists git working-tree changes (`chat_git_changed_files`) merged
  with chat-edited files (`statusSummary.allEdits`); selecting a git file builds
  `DiffPreviewLine[]` via `buildDiffPreviewLines(old, new)` from
  `chat_git_file_contents` and renders through the **reused** `ChatDiffReviewPane`
  (unified/split via the shared `diffViewMode`). No git repo ⇒ no Review card.
- `StatusStrip` is the dock's always-visible thin bar: daemon status + context
  usage % (`TokenIndicator`), with an expandable drawer that reuses
  `StatusPanel showEdits={false}` for diagnostics (provider/message/anchor/daemon,
  MCP, session-load metrics, runtime context, activity). It is presentational —
  `ChatPage` passes all values down; it must not read stores.
- `StatusPanel` gained `showEdits?: boolean` (default `true`). The recent-edits
  tree + diff-mode toggle render only when `showEdits` is true; the dock passes
  `false` because `ReviewPanel` now owns edit/diff review. Standalone
  `StatusPanel` callers/tests keep the edit tree via the default.

Superseded by this layout (do not reintroduce for the desktop dock): the
resizable conversation/diff/status pane handles (`startPaneResize`,
`.chat-pane-resizer`, `getPaneWidthsAfterResize`), the central diff review pane
as a separate column with its own collapse/restore/focus-handoff controls, the
right status-sidebar collapse rail, and the floating diff-pane reopen control.
The composer status strip (`ChatInputStatusTabs`) remains the small-screen
(`< xl`) fallback for edits/tasks and still uses `selectedEditKey` /
`onSelectedEditChange` / `onSelectTool`.

### New backend commands (cross-layer)

Four additive read-only Tauri commands back the dock (`commands/chat_commands.rs`,
serde `camelCase`), wrapped by `services/chatDockService.ts` with payload
normalization:

| Command | Returns |
|---------|---------|
| `chat_list_directory(path)` | `Array<{name, isDir}>` (dirs first, heavy/hidden dirs skipped) |
| `chat_read_text_file(path, maxBytes?)` | `{content, truncated, binary}` |
| `chat_git_changed_files(cwd)` | `{isGit, files: [{path, status, additions, deletions}]}` |
| `chat_git_file_contents(cwd, path)` | `{oldContent, newContent}` |

---

## Component Structure

Standard order within a component file:

1. Imports — lucide icons first is common, then React hooks, then Tauri APIs,
   then local types/components.
2. Exported `type`/`interface` the component needs to share (e.g. `ModalType`).
3. The `<Component>Props` interface.
4. Small module-scope pure helpers if needed (e.g. `maskApiKey`).
5. The component function with destructured props.
6. `export default` (most components) — required for any component used with
   `React.lazy` in `App.tsx`.

```tsx
interface ProviderCardProps {
    provider: Provider;
    isDragging?: boolean;
    onSwitch: (id: string) => void;
    onEdit: (provider: Provider) => void;
    onDelete: (id: string, name: string) => void;
    healthStatus?: HealthStatus;
}

export default function ProviderCard({
    provider,
    isDragging,
    onSwitch,
    onEdit,
    onDelete,
    healthStatus,
}: ProviderCardProps) {
    const { t } = useTranslation();
    const [showKey, setShowKey] = useState(false);
    return ( /* ... */ );
}
```

See `src/components/providers/ProviderCard.tsx` and
`src/components/common/ModalDialog.tsx` for the canonical shape.

---

## Props Conventions

- Define props with a local `interface` named `<Component>Props`. Do not inline
  the type in the function signature for non-trivial components.
- Optional props use `?` and are given defaults via destructuring
  (`type = 'confirm'`, `isDestructive = false`).
- Event callbacks are named `onXxx` and typed explicitly
  (`onSwitch: (id: string) => void`).
- Children/content slots use `children?: React.ReactNode`.
- Pass primitives and callbacks down; let the parent (usually a page) own the
  data fetching and mutation. Pages call the store, components receive results.

---

## Styling Patterns

- **TailwindCSS 3 + DaisyUI 4.** Styles are utility classes in `className`.
  There are no CSS modules or styled-components; only `App.css`/`index` global
  styles exist.
- DaisyUI component classes are used heavily: `btn`, `btn-ghost`, `btn-sm`,
  `badge`, `modal`, `input input-bordered`, `select`, `table`, `loading`.
- **Dark mode** is expressed inline with `dark:` variants and DaisyUI semantic
  tokens (`base-100`, `base-200`, `base-content`). Always pair light styles with
  a dark counterpart, e.g.
  `bg-white dark:bg-base-100 border border-gray-100 dark:border-base-200`.
- Recurring visual patterns (keep consistent with existing code):
  - Card: `bg-white dark:bg-base-100 rounded-xl shadow-sm border border-gray-100 dark:border-base-200`
  - Primary action button: gradient, e.g.
    `bg-gradient-to-r from-blue-500 to-purple-500 ... text-white border-none btn-sm`
  - Active/selected state: green ring/border accents.
- Master/detail sidebars must keep the detail region visible. Use separate
  `min-h-0` flex children with independent `overflow-y-auto` panes instead of
  putting both the master list and detail list in one long scroll container.
  Example: project list `basis-2/5 overflow-y-auto`, session list
  `flex-1 overflow-y-auto`.
- Chat session sidebars must use normalized Windows-safe cache keys for project
  paths. Cache `list_sessions(projectPath)` results by both the selected project
  path and each returned session's `projectDir` alias so later `currentCwd`
  updates do not re-scan the same history list just because slash, casing, or
  trailing separator forms changed. Do not cache or display sessions whose
  explicit `projectDir` normalizes to a different project path; stale provider
  scan results must not poison another project's cache key and make the sidebar
  appear unchanged after a project switch. The rendered session list must track
  the project path that produced it, so old-project rows are hidden immediately
  if the user switches projects while another scan or cache update is still
  settling. Cache hits count as a new ownership decision: increment or otherwise
  invalidate the previous session-list request before rendering cached rows, and
  accept async `list_sessions(projectPath)` responses only when both the request
  sequence and the currently selected normalized project key still match.
  Repeated clicks on the pending session should short-circuit before resetting
  transcript navigation. Repeated clicks on the active session should
  short-circuit only when no different session load is pending; if another
  session is pending, reselecting the active session is a valid user intent to
  cancel/override the pending selection. Keep this decision in a shared helper
  used by both the sidebar and `ChatPage`, otherwise the sidebar can allow the
  click while the page silently drops it.
  If a `list_sessions(projectPath)` request is already in flight for the
  normalized project path, do not start another scan unless the user explicitly
  forces a refresh. Forced refreshes should keep the existing session list
  visible and show a lightweight refresh status row instead of replacing the
  detail pane with a full spinner; otherwise users cannot tell whether they are
  seeing stale results or an in-progress reload.
  Session sidebar chrome follows the same readable i18n fallback rule as other
  Chat controls: the panel title, refresh/new-chat buttons, project/session
  search placeholders, section headings, empty states, project session counts,
  refreshing-session status, and pending-session loading labels must fall back
  to readable text such as `Session Management`, `Refresh`, `New chat`,
  `Search projects...`, `Projects`, `No projects`, `Sessions`, `No sessions`,
  `Refreshing sessions...`, and `Loading...` instead of raw
  `chat.sessionPanel.*` or `common.*` keys.
  Session rows should also reuse the shared Chat provider brand icons for
  supported providers instead of rendering a second text-only provider badge.
  In the session list, `claude` and `codex` rows should use the same
  `ProviderBrandIcon` glyphs as the composer/model selector so provider
  identity stays visually consistent across the Chat UI. Keep readable
  `title` / `aria-label` text for those icon badges, and preserve a text
  fallback for unknown providers rather than forcing an unsupported icon.
  The `Project sessions` session list may be narrowed by provider through
  `codex` / `claude` icon toggles placed next to the session search box. Model
  the filter as a single `'all' | 'claude' | 'codex'` state via
  `toggleSessionProviderFilter` (mutually exclusive, and clicking the active
  provider clears it back to `all`) and apply it through
  `filterSessionsByProvider` before the text-search filter so both compose.
  The toggles must reuse `ProviderBrandIcon`, expose `aria-pressed`, and carry
  readable `title` / `aria-label`. This provider filter is transient view state,
  not a persisted preference.
  Recent chat management belongs in the existing session sidebar, not a second
  independent navigation surface. Build recent groups from the dashboard
  project list plus cached/prefetched `list_sessions(projectPath)` results,
  group by project directory, filter unsupported providers, sort each group by
  `lastActiveAt` descending, and cap each group so the sidebar remains
  scannable. Recent rows must reuse `shouldIgnoreSessionClick`,
  `getSessionSelectionKey`, `sessionTitle`, `formatShortDate`, and the shared
  provider badge so clicking a recent row has the same pending/active behavior
  as clicking the normal session list. Recent chats must be exposed through a
  compact sidebar mode switch instead of being stacked above the normal project
  and session panes. The `Project sessions` mode owns project search, project
  selection, and the selected project's session list; the `Recent chats` mode
  owns only grouped recent sessions. Recent chats should include only sessions
  active within the last seven days; older sessions stay available through the
  normal project/session browser but must be omitted from the recent view.
  Recent project group headers must be real buttons with `aria-expanded`, and
  collapsing a group must hide its sessions without affecting cached session
  data or normal session selection behavior.
  Recent project group headers must expose hierarchy, not only the final folder
  name. Render the project name as the primary line, the parent path as a muted
  secondary line, and the recent session count as a compact right-side badge.
  Expanded recent groups should render their sessions in an indented child list
  with a subtle guide line so users can distinguish project folders from
  conversation rows when many projects share similar names.
  The user's selected session sidebar view (`Project sessions` or
  `Recent chats`) and collapsed recent-chat project groups are local UI
  preferences and must survive page refreshes. Store these preferences in
  `localStorage` separately from the session-list data cache, using normalized
  project keys for collapsed recent groups.
  Chat's left session sidebar and right status sidebar may be collapsed from the
  page shell. Treat these as local layout preferences: persist
  `sessionSidebarCollapsed` and `statusSidebarCollapsed` in `localStorage`, keep
  a narrow restore rail visible on desktop breakpoints, and give each icon-only
  collapse/expand button readable `title` and `aria-label` text with fallback
  behavior. When the status sidebar is collapsed, do not render resize handles
  that target the absent status pane.
  Session-level terminal actions belong in this same `ChatSessionSidebar`
  context menu, not in a separate Workspaces page. Use each session's scanned
  `resumeCommand` when invoking `chat_resume_session_in_terminal`; do not
  reconstruct provider-specific CLI syntax from `providerId` and `sessionId` in
  the component. Removing the independent `/workspaces` route must not remove
  Chat's active workspace controls, because `currentCwd`, file completion, Git
  branch status, and session filtering still depend on that workspace context.
  Open conversation tabs are snapshots, not a full history list. Render them as
  a compact browser-like strip at the top of the conversation pane below the
  global header and above transcript search. Tabs should show provider icon,
  title, project folder when space allows, active state, running/loading/error
  state, and an icon-only close button with readable `title` / `aria-label`.
  Closing the current tab should focus the most recently updated remaining tab;
  if no tab remains, the chat view returns to an empty draft. Do not add a
  background-tab Stop button until the backend supports targeted request abort.
  The tab strip must stay one fixed-height row even when many conversations are
  open: give each tab a comfortable default width with a maximum width, let it
  shrink only after the strip runs out of space, hide overflow instead of
  showing horizontal scroll chrome, keep status as small busy/error dots rather
  than width-consuming text, and move project/status detail into tooltips when
  width is constrained. Do not preserve the startup empty draft as a tab merely
  because a workspace cwd is known; save a draft tab only when it contains user
  text, messages, a native session, or an active request. Tab context menus may
  close other tabs or all tabs, but bulk close actions only close the UI
  snapshots; they must not abort background requests until targeted backend
  abort exists.
  The composer context bar owns the active workspace and Git branch affordances
  directly above the rich input. It must render a workspace switcher even when
  `currentCwd` is null, using readable fallback text such as `No folder` and
  `Open folder...`, so first-run users with no history can still choose a
  workspace. Selecting a dashboard project or typed folder path updates
  `useChatStore.currentCwd`; it must not create a fake history session by
  itself. Git branch controls should be shown only for a Git workspace status,
  list branches on demand, and run create-and-checkout through the typed
  workspace status service. Keep the chip labels compact with full paths in
  `title` / `aria-label`, and route all visible text through i18n keys with
  readable fallback behavior.
  SDK dependency recovery UI follows this same rule. The SDK modal title,
  close action, panel heading, hint, refresh action, installed/not-installed
  state, install/uninstall action, and installing log placeholder must use a
  shared fallback helper so users see readable text such as `SDK Dependencies`,
  `Close`, `Refresh`, `Installed`, `Not installed`, `Install`, `Uninstall`, and
  `Installing...` instead of `chat.sdk.*` / `common.close` keys while i18n is
  still loading or incomplete.
  The same modal owns Node.js runtime recovery for Chat SDK installation. When
  `chat_node_runtime_status` reports `installed: false`, render a compact
  runtime card before the SDK cards, disable SDK install/version controls, and
  offer `chat_install_node_runtime` as a user-clicked one-key install path.
  The copy must state that this installs a CCG Switch private runtime in the
  user data directory and does not modify system `PATH`, shell profiles,
  Homebrew, or global Node. Runtime download/install logs may reuse the SDK log
  panel styling, but keep runtime installing state separate from SDK installing
  state in the store.
  The SDK dependency panel also owns version-management presentation. It should
  render target-version selects, current/latest/default version metadata,
  update availability, and install/update/current/switch action labels through
  the same helper-owned fallback boundary. Use one compact card per SDK: header
  icon + SDK name + current-version chip + latest-version chip + lightweight
  update pill, a short SDK-specific description, one full-width target-version
  select row, an action row for install/update/current/switch plus uninstall,
  and a quiet current/latest metadata footer. Do not split the select/actions
  into a separate right-hand column in this modal; it makes the narrow desktop
  dialog look misaligned. Never let the frontend accept arbitrary npm specs;
  choices must come from the backend `availableVersions` list. This panel must
  be theme-paired: light mode should use opaque white/slate/blue/red surfaces
  with readable borders, while dark mode uses `dark:` variants to keep the
  screenshot-style DaisyUI semantic tokens. Do not rely only on translucent
  semantic classes such as `bg-base-200/40`, `bg-base-300/80`, `bg-info/15`, or
  `bg-error/10` for card, chip, select, update, install, or uninstall surfaces;
  those can become too low-contrast in light themes. SDK install logs should
  use the same lightweight theme-paired treatment: render an opaque bordered
  panel instead of DaisyUI `mockup-code` / broad `bg-base-300` terminal blocks,
  keep the log expanded while an install is running, and collapse completed
  logs by default so diagnostic output does not visually outweigh the SDK cards.
  Tool permission dialogs follow the same recovery-path rule: the title, tool
  description, parameters heading, raw-input disclosure, working-directory
  label, deny action, and allow-once action must use a helper-owned fallback so
  a blocked daemon request never asks the user to decide from raw
  `chat.permission.*` keys.
  Because tool permission dialogs block daemon execution on a safety decision,
  their modal container must expose explicit dialog semantics
  (`role="dialog"` and `aria-modal="true"`) and connect
  `aria-labelledby` / `aria-describedby` to the visible permission title and
  description banner.
  Since Enter and Escape are global shortcuts for allowing once and denying a
  tool permission request, render compact visible `Enter` / `Esc` hints in the
  footer using readable fallback labels such as `Allow once` and `Deny`. Do not
  make users discover blocking safety-decision shortcuts by trial and error.
  Tool permission dialogs should also expose cc-gui-style numeric shortcuts for
  the decisions this app actually supports: `1` maps to `Allow once` and `2`
  maps to `Deny`. Do not add a visible `Always allow` / `3` option unless the
  frontend store, backend response file, and bridge contract all support a
  remembered permission response instead of the current boolean `allow` payload.
  Footer action buttons should include the same shortcut context in their
  `title` / `aria-label` values, for example `Allow once (1 / Enter)` and
  `Deny (2 / Esc)`. The visible hint row is not enough for focused controls or
  assistive-technology users.
  If `inputs.cwd` is the same as the request-level working directory, omit it
  from the parameter preview because the dialog already renders a dedicated
  working-directory row. Keep differing `inputs.cwd` values visible and leave
  the raw input disclosure unchanged so users can still inspect the full
  provider payload.
  Primary tool input fields (`command`, then `content`, then `text`) should be
  promoted into a dedicated compact preview box and omitted from the ordinary
  parameter preview. Safety decisions depend most on this primary action, while
  the raw input disclosure remains the place to inspect the full payload.
  That primary preview box should expose an icon-only copy affordance with
  readable fallback labels (for example `Copy primary input` / `Copied primary
  input`) so users can reuse the exact command or text payload without opening
  raw JSON. Copying must not change permission response state or remove the raw
  input disclosure.
  Ask-user-question dialogs follow the same rule for modal chrome: request
  headers/questions/options remain daemon-provided content, but the fallback
  title, close title/aria-label, cancel action, submit action, and submitting
  state must use i18n keys with helper-owned readable fallbacks such as
  `Permission request`, `Close`, `Cancel`, `Submit`, and `Submitting...`.
  Because ask-user-question dialogs block daemon execution until the user
  answers, their modal container must expose explicit dialog semantics
  (`role="dialog"` and `aria-modal="true"`) and connect
  `aria-labelledby` / `aria-describedby` to the visible title and first
  question prompt. Keep daemon-provided question and option text intact; this
  rule only names the existing visible content for assistive technology.
  Since Escape is the global cancel shortcut for this dialog, render a compact
  visible `Esc` hint in the footer using a readable fallback label such as
  `Cancel`; users should not have to guess the keyboard path out of a blocking
  question prompt. The footer cancel button's `title` / `aria-label` must carry
  the same shortcut context, for example `Cancel (Esc)`, so focused controls and
  assistive technology expose the same contract as the visible hint.
  Do not allow an ask-user-question dialog to submit an empty answer set. The
  submit button disabled state and the `handleSubmit` guard must reuse the same
  helper so mouse clicks, keyboard activation, and future callback paths cannot
  write `{}` back to the daemon when every visible question is still unanswered.
  Ask-user-question dialogs should also provide a custom answer textarea with a
  bounded input length for cases where the provided options are incomplete or a
  question has no options. Keep the backend response contract as
  `Record<string, string>`: single-select custom text replaces the selected
  option, multi-select custom text is appended to the comma-separated selected
  values, and the submit guard must accept custom text through the same shared
  payload helper used by `handleSubmit`. When options are present, label this
  textarea as `Other` because it supplements the available choices; when a
  question has no options, label it as `Answer` because it is the primary input,
  not an alternative choice.
  If an ask-user-question request contains no questions, render a readable
  invalid-format state with only the cancel path instead of showing a disabled
  Submit button or an `Answer 0 required questions` hint. The daemon cannot
  proceed from an empty answer payload, so the UI should make cancellation the
  explicit recovery action.
  If a question payload includes a non-empty `header`, render it as a compact
  per-question tag next to that question instead of only using the first header
  as the dialog title. The header is daemon-provided context that helps users
  scan multi-question prompts; skip empty headers and do not include the tag in
  the answer payload.
  For multiple ask-user-question prompts, show a lightweight answered-count
  summary and per-question progress labels such as `0 / 2 answered` and
  `Question 1 of 2`. This is a presentation aid only: do not switch to
  cc-gui-style step navigation, change `Record<string, string>` payloads, or
  create a second answer-completion algorithm separate from the submit guard.
  Each visible question should also expose a compact `Required` / `Answered`
  state badge when multiple questions are shown so users can locate the
  unanswered prompt that keeps Submit disabled. The badge must reuse the same
  answer payload helper as the submit guard; do not infer status from DOM state
  or option count alone. When Submit is disabled because required questions are
  still unanswered, the footer must also expose a visible reason that includes
  the remaining required-question count, and the Submit button's `title` /
  `aria-label` must include that same reason. Do not leave users to infer the
  disabled state only from scattered per-question badges.
  Plan-approval dialogs follow the same rule: plan text and allowed prompt
  bodies remain daemon-provided content, but the modal title, subtitle, close
  title/aria, plan line summary, allowed action count, working-directory label,
  deny action, approve action, approve-and-auto action, and approve-and-auto
  title must use i18n keys with helper-owned readable fallbacks such as `Plan
  approval required`, `Review the plan before approving execution.`,
  `Plan (3 lines)`, `Allowed actions (2)`, `Working directory:`, `Deny`,
  `Approve`, and `Approve & Auto`.
  If the dialog supports global keyboard shortcuts, render compact visible
  hints for the active keys (currently `Enter` approve and `Esc` deny/reject)
  using the same readable-fallback label boundary; do not make users discover
  blocking approval shortcuts by trial and error. Footer approval/rejection
  action buttons must include the same shortcut context in their `title` /
  `aria-label` values, for example `Approve (Enter)` and `Deny (Esc)`.
  Any auto-approval action must carry the risk in both places users encounter
  it: a visible footer hint and the focused button's `title` / `aria-label`.
  For the current `Approve & Auto` action, use a readable fallback such as
  `Auto mode will allow future operations automatically after this approval.`
  and keep the response payload as `approved=true,targetMode=auto`; do not
  introduce a new response mode from UI copy alone.
  Because plan approval blocks execution, the modal container must expose
  explicit dialog semantics (`role="dialog"` and `aria-modal="true"`) and
  connect `aria-labelledby` / `aria-describedby` to the visible title and
  subtitle so assistive technology users hear the approval context before the
  action buttons.
  Plan body rendering in that dialog must reuse the chat `MarkdownBlock`
  instead of a plain `<pre>` blob, because approval plans commonly contain
  headings, lists, links, file paths, and fenced code blocks that users need to
  scan before approving execution. Keep the plan content itself
  daemon-provided; this rule is only about rendering the already-provided text.
- Tool block list renderers must group by the visible items users need to scan,
  not only by raw `tool_use` count. Edit tools must expand `MultiEdit` /
  `edit_file` `input.edits[]` and `apply_patch` patch hunks into file rows; if
  the resulting edit item count is 2+, render `EditToolGroupBlock` so the file
  list stays visible in live and historical sessions.
- Tool blocks should render as compact operation rows, not large text cards.
  Headers should expose the operation type, the primary target, and status in a
  single scan line. Command tools use `summarizeCommand()` chips such as
  `Build`, `Test`, `Git`, `Search`, `Read`, `Patch`, and `Run`; search tools use
  `SearchToolGroupBlock` even for a single search so the query and first matched
  file remain visible. Search result text that includes `path:line[:column]`
  rows should be normalized through shared presentation helpers and rendered as
  compact clickable file rows with path, line, and a truncated match snippet
  when the result line provides one. Search result buttons should pass
  `currentCwd` to `openFile(...)` just like Read/Edit tools and expose an
  action label such as `Open search result: src/App.tsx · L12 · const value`.
  Read/Edit/Generic file targets must pass
  `currentCwd` to `openFile(path, start, end, currentCwd)` and stop click
  propagation for file links and action buttons so opening/copying does not also
  collapse the block. Prefer lucide icons for structural tool icons and
  expansion chevrons; do not introduce emoji icons in new tool-block UI. On
  narrow screens, keep a truncated primary summary visible and hide only
  secondary badges/statistics.
  `openFile()` path normalization should decode valid percent-encoded hrefs
  while preserving legal literal percent signs in normal filesystem paths
  (for example `100% coverage.md`). A malformed encoded path should not block a
  plain literal percent filename from reaching the Tauri editor command, but
  control characters must still be rejected before invoking the backend.
- Status-panel edit history should not be a flat pile of rows when the file
  count grows. Render touched files as a tree with folder-level collapse /
  expand controls, keep the tree body inside its own scrollable pane, and show
  the summary counts in the same scan line as the file row. Large edit trees
  should default to collapsed folder rows while small edit sets can stay
  expanded for immediate inspection; once the user manually expands/collapses
  folders, preserve that choice during subsequent transcript updates. Diff
  hover previews used from this panel should be solid, high-contrast surfaces
  that can sit outside the scroll pane without being clipped; the preview shell,
  header, body, and added/removed/context diff rows should also use opaque
  theme-adaptive DaisyUI surfaces using the same fallback style as DaisyUI
  generated CSS (`var(--fallback-b1, oklch(var(--b1) / 1))`,
  `var(--fallback-b2, oklch(var(--b2) / 1))`,
  `var(--fallback-b3, oklch(var(--b3) / 1))`,
  `var(--fallback-bc, oklch(var(--bc) / 1))`, plus success/error tokens for
  diff accents) so the code remains readable over busy chat/status surfaces
  without hardcoding a permanent dark preview or depending on a single advanced
  color function for opacity-critical backgrounds.
  Status-panel hover previews also need a wider readable-width variant than
  compact tooltip chrome, because users are scanning actual code lines and
  paths, not only labels or counts. Since these hover previews are temporary
  non-interactive surfaces, long code lines should wrap instead of ellipsizing;
  users cannot reliably scroll a pointer-events-disabled tooltip to recover the
  hidden text. After wrapping is enabled, use a viewport-aware readable-height
  variant for the status preview body so useful diff context is not clipped at
  a small fixed tooltip height while still avoiding full-screen obstruction.
  Folder rows in this edit tree must expose an action label that names both the
  expand/collapse action and the target folder path; `aria-expanded` plus a bare
  path title is not enough for keyboard or assistive-technology users.
  The floating top calculation must account for the full preview shell
  (header, borders, and viewport padding), not only the body max-height, so
  rows near the bottom edge do not open a preview that is clipped off-screen. If
  the preview still caps lines, surface the hidden-line count in the header
  stats area as well as the body/footer, because the body can be clipped before
  the footer clue is visible. For status-panel hover previews specifically,
  prefer the header hidden-line clue and do not duplicate a footer-only clue
  inside the clipped preview body. Ordinary transcript hover previews should
  render the complete diff by default inside a viewport-capped scrollable body
  instead of reusing a compact 16-line tooltip limit. Because those transcript
  previews are interactive scroll targets, their hit area must stay continuous
  from the trigger row into the preview shell; do not leave a pointer gap that
  drops `:hover` before the user can enter and scroll the preview. Only
  explicit `lineLimit` callers should show the compact footer hidden-line
  clue. Keep the status preview's default line budget matched to its taller
  body because status rows are quick-scan chrome, not the full transcript
  inspection surface. When a
  status-panel file row renders a hover diff tooltip, give the tooltip a stable
  id and connect the row
  with `aria-describedby`; rows without tooltip content must not emit dangling
  references. File rows that select the
  central diff review pane must expose an accessible action label that says
  they inspect the full diff for that file; do not leave the row announced only
  as a file path. File-row status pills inside this tree should also include
  the target file path in their `title` / `aria-label`, for example
  `src/App.tsx: Success` or `src/App.tsx: Failed`, because repeated compact
  status pills are otherwise announced as isolated state tokens. The same target
  label rule applies to status edit tree stats: folder and file `+N` / `-M`
  groups may stay visually compact, but their `title` / `aria-label` should
  carry the target path and change scale, for example
  `Edit stats: src/components · +5 / -1` or
  `Edit stats: src/App.tsx · +2 / -1`.
  On desktop, selecting one of those rows should move
  programmatic focus to the central diff review pane after the pane opens or
  updates, so keyboard users land on the newly selected review surface and can
  immediately reach wrap/copy/open/collapse controls. Do not focus the central
  pane below the desktop breakpoint, because the status panel is hidden and
  composer fallback selections must not send focus to an invisible region. Keep
  the central diff pane root as a named programmatic focus target
  (`tabIndex={-1}` with a stable data selector) rather than adding it to the
  normal tab order. Programmatic focus targets still need visible focus
  feedback; the central diff review pane should expose a `:focus-visible`
  outline/shadow so users can see where the status edit tree handed them off.
  When a file is selected, the pane's accessible name should include that file
  path, not only the generic diff-panel label, so assistive technology users
  know which full diff received focus. The central diff review pane follows the
  same readable i18n fallback rule as the status edit tree: if translations are
  not initialized, the pane name, visible heading, diff-line summary, diff view
  mode controls, wrap/no-wrap toggle, Open File, Copy Path, copied feedback, and
  collapse action must still expose labels such as `File diff: <file>`,
  `File diff`, `40 diff lines`, `Diff view mode`, `Unified diff view`,
  `Split diff view`, `Do not wrap diff lines; use horizontal scrolling`,
  `Open file: <file>`, `Copy path: <file>`, `Copied path: <file>`, and
  `Collapse file diff panel` instead of raw `chat.layout.*` / `tools.*` keys.
  The selected file row in the status edit tree should also use a distinct
  accessible label that names it as the current full diff, not only rely on
  `aria-current`, because screen reader output differs on whether and when
  `aria-current` is announced for custom `role="button"` rows.
  Composer/input status fallback edit rows should use the same file-specific
  full-diff action labels as the status panel, including the current-selected
  variant, so small-screen and fallback entry points do not lose context.
  Composer/input status fallback task and subagent jump rows should likewise
  keep the target task summary in their accessible labels, including an English
  fallback when the i18n boundary returns the key itself. The fallback tab
  buttons above the composer need the same treatment at the category level:
  when i18n returns the key itself, keep a human-readable category and real
  count/stat in the tab `aria-label`/`title` (for example `Tasks 2/2`,
  `Subagents 0/1`, `Edits +5 / -2`) instead of announcing two translation
  keys before the user opens the popover. Non-tab chips in the same status
  strip follow the same rule; the Git branch chip should fall back to `Git:
  <branch>` / `Git <branch>` instead of exposing `inputStatusGitBranch`.
  When a
  split/unified diff view toggle is added, keep it compact and icon-driven so it
  reads like a control, not a second card. The Chat page layout should keep all
  visible desktop panes resizable: when the central diff pane is open, expose
  conversation-diff and diff-status resize handles; when the diff pane is
  collapsed or absent, expose a conversation-status handle so the fixed right
  sidebar can give space back to the transcript. Width clamping belongs in
  shared UI behavior helpers and must be unit-tested rather than hand-coded only
  inside `ChatPage`. Resize handle `title` / `aria-label` text follows the same
  helper-owned fallback rule: if translations return keys, show labels such as
  `Resize conversation and diff panes`, `Resize diff and right panes`, and
  `Resize conversation and right panes` instead of raw `chat.layout.resize*`
  keys. Collapsing the diff pane must also leave an explicit reopen
  affordance on the right side of the status-panel edit header whenever the
  loaded transcript window has any edit record; do not rely on a selected edit
  key or clicking a file row as the hidden way to restore the central diff pane.
  Because the status panel is hidden below the desktop `xl` breakpoint and can
  be visually missed even on wide screens, `ChatPage` must also expose a
  page-level right-edge restore control whenever the diff pane is collapsed and
  there is a selected edit to reopen. This global control should float over the
  review layout instead of reserving a diff column, preserving the "collapsed
  means no central space used" contract. Diff pane restore controls should use
  a file-specific accessible label when the target edit is known, so users do
  not have to reopen the pane before discovering which file diff will return.
  Those restore labels must also keep readable i18n fallbacks; if translations
  return keys, show labels like `Open file diff: <file>` or `Open file diff
  panel` instead of `chat.layout.expandDiffPanelForFile` /
  `chat.layout.expandDiffPanel`.
  Restoring the pane from those controls should reuse the same desktop
  programmatic focus handoff as selecting a file from the edit tree; otherwise
  keyboard focus can remain on a button that disappears after the pane opens.
  The full central diff
  pane should default to wrapped code lines so narrow three-pane layouts remain
  readable without constant horizontal scrolling, while still exposing a compact
  no-wrap toggle for exact long-line review. The wrap/no-wrap preference belongs
  to `ChatPage` state, not local pane state, so collapsing and remounting the
  central diff pane preserves the user's review mode. The central diff pane
  should expose the same low-friction file operations users expect from
  Read/Edit tool rows: at minimum Open File and Copy Path. Keep these controls
  icon-sized and reuse existing bridge helpers/i18n keys instead of adding a
  second command style. When the selected edit is known, those file-action
  buttons must include the target file path in their accessible labels and
  titles (for example, "Open file: <path>" / "Copy path: <path>"); copied-state
  feedback should keep the same target path instead of falling back to a generic
  "Copied" label. Status edit tree row-level file action buttons follow the
  same rule: if the target file is known, use the file-specific label rather
  than a generic "Open file" title.
- Chat daemon lifecycle status must be rendered as a recoverable state, not only
  a raw diagnostic string. Use shared helpers such as
  `getChatDaemonStatusKind()` and `canReconnectChatDaemon()` so the header and
  `StatusPanel` agree on `ready` / `starting` / `offline` / `error`. When the
  daemon is offline or failed, expose a compact reconnect action in both the
  top header and the right status panel if the panel is visible; keep it
  icon-first, low-noise, and disabled/spinning while `daemonReconnecting` is
  true. Surface a compact sanitized diagnostic from the store `error` or the
  meaningful daemon status text next to the recovery action, and reuse the same
  diagnostic as the top-header tooltip. If the store uses a known i18n key for a
  frontend-generated daemon diagnostic, translate it at the rendering boundary
  with a readable fallback, such as `Daemon did not become ready in time` for
  `chat.daemon.readyTimeoutError`; backend/raw errors remain literal diagnostic
  strings. Do not label `shutdown` as `Starting...`, because that hides the
  recovery path after daemon stdout closes. The top-header daemon visible status
  text must also keep readable
  i18n fallbacks; if translations return keys, show labels such as `Ready`,
  `Starting`, `Offline`, and `Daemon error` instead of `chat.ready`,
  `chat.starting`, or `chat.daemon.*` keys, while preserving meaningful unknown
  daemon status strings verbatim. The top-header daemon reconnect action follows
  the same boundary rule for `title`, `aria-label`, and visible short label:
  fall back to `Reconnect daemon`, `Reconnecting daemon`, `Reconnect`, and
  `Reconnecting` rather than exposing `chat.daemon.reconnect*` keys.
  The right `StatusPanel` daemon status value should also carry a target label
  such as `Daemon: Success`, `Daemon: Daemon offline`, or `Daemon: Daemon error`
  through `aria-label`, because the visible value is a short status token inside
  a dense key/value row.
  The adjacent top chrome actions and SDK recovery banner follow the same
  readable fallback contract: SDK management, clear chat, SDK missing copy, and
  SDK install actions should fall back to labels such as `Manage SDKs`,
  `Clear chat`, `<SDK name> is not installed yet. Install it to start chatting.`,
  and `Install SDK` instead of exposing `chat.sdk.*` or `chat.clear` keys.
  Conversation navigation controls follow the same rule: search placeholder /
  label, clear-search, anchor rail label, current-anchor marker,
  jump-to-message buttons, and scroll-to-top/bottom buttons must use shared
  helper-owned fallbacks such as `Search this conversation`, `Clear search`,
  `Message timeline`, `Current message`, `Jump to message <n>`,
  `Scroll to top`, and `Scroll to bottom` instead of raw `chat.layout.*` keys.
- Chat status panels should expose basic runtime readiness before the user sends
  a prompt. Provider, selected model, permission mode, reasoning effort,
  workspace path, SDK installation state, daemon state, and MCP
  configuration availability belong in the same compact status surface. Runtime
  context rows are display-only: they should consume existing `useChatStore` /
  `useSdkStore` state passed through `ChatPage`, not trigger model refreshes,
  SDK installs, or backend checks while rendering the panel. Render runtime
  context as a compact tile grid in the right `StatusPanel` rather than a tall
  vertical key/value list; keep full values in `title` attributes so truncated
  model ids and Windows workspace paths remain inspectable. Runtime context
  tile values should also carry target labels in `title` / `aria-label`, such as
  `Model: claude-sonnet-4-6`, `Permission mode: Auto Mode`, `Workspace:
  C:/repo`, and `SDK: Claude Code SDK · Installed`, so truncated compact values
  remain meaningful outside their visual tile label. When the SDK tile tooltip
  uses an installation path, keep the source context too, for example
  `SDK: C:/deps/claude-sdk`, instead of exposing a bare path. The top status
  chrome and runtime context tile labels must use readable fallback text when
  i18n returns keys: users should still see labels such as `Session status`,
  `AI provider`, `Messages`, `Message anchors`, `Daemon`, `Reconnect daemon`,
  `Runtime context`, `Model`, `Permission mode`, `Reasoning effort`,
  `Workspace`, `SDK`, and SDK install state instead of raw translation keys.
  The provider, message count, and anchor count values in the top status chrome
  may stay visually compact, but their `title` and `aria-label` must include
  the left-side label, for example `AI provider: claude`, `Messages: 4`, and
  `Message anchors: 3`.
  The daemon status value follows the same rule: its `title` and `aria-label`
  should include the daemon label, for example `Daemon: Success` or
  `Daemon: Daemon offline`; if a diagnostic detail is present, append it to the
  title after the status, for example `Daemon: Daemon error · <detail>`.
  Permission and reasoning values should also fall back to user-facing labels
  such as `Auto Mode` and `High` rather than exposing `chat.modes.*` or
  `chat.reasoning.*` keys. Pending and failed
  tool counts belong in the `currentActivity` card header as compact pills when
  non-zero; do not duplicate those counts as standalone rows in the top status
  grid. The `currentActivity` card itself is trigger-based: render it only when
  an active tool exists, a reply is streaming, pending/failed tool counts are
  non-zero, or the loaded status summary has recent non-agent tool history to
  inspect. On desktop, this card is the primary task-list surface because the
  composer tasks tab is only a small-screen fallback; show a compact recent task
  list from `statusSummary.toolTimeline` excluding `agent` tools, keep the active
  tool as the primary row, and show a hidden-count row when older tasks are
  clipped. Subagent / Task activity should be shown as a separate compact list
  from `statusSummary.agentTools` inside the same card, not mixed into the normal
  task list and not hidden solely behind the composer subagents tab. Keep the
  active tool as the primary row so a currently running subagent is not repeated
  immediately below itself. When these activity lists are present, keep them in
  an internal scroll region with a local height cap so dense task history does
  not push recent edits, MCP, or runtime diagnostics out of the right pane. The
  scroll region itself must be keyboard-focusable and exposed as a named
  `region`, so users can focus the activity history and scroll the task /
  subagent list without first tabbing through every row.
  Recent task and subagent rows must also be real
  desktop navigation targets:
  clicking or keyboard-activating a row should jump to the corresponding
  transcript tool block instead of duplicating full tool details inside the
  right pane. These jump rows must use accurate accessible labels: subagent
  activity should not be announced as a generic tool task. The row button's
  `title` and `aria-label` must both describe the jump action, for example
  `Jump to tool task: npm test` or `Jump to subagent activity: review risks`;
  keep summary/detail as visible row content instead of using it as the
  control tooltip. They must also keep readable fallback labels and status pills when i18n returns keys, matching
  composer fallback rows: `Jump to tool task: <summary>`, `Jump to subagent
  activity: <summary>`, `Pending`, `Failed`, and `Success` should remain
  visible/announced instead of raw translation keys. The primary active tool
  status pill and the status pill inside each activity-history row should
  additionally expose the tool type and target summary in `title` /
  `aria-label`, for example `Bash: npm run build · Pending` or
  `Task: write regression coverage · Pending`, so compact states remain
  meaningful when read or hovered outside the adjacent summary line. The activity card chrome
  follows the same rule: the card title, pending/error count titles, scroll
  region label, task/subagent section headers, and clipped-history footers must
  fall back to readable text such as `Current activity`, `Pending tools`,
  `Failed tools`, `Activity history`, `Tasks`, `Subagents`, and
  `<count> earlier tool task hidden from activity history` /
  `<count> earlier subagent hidden from activity history` instead of raw
  translation keys. Because the composer quick-detail overflow uses its own
  `inputStatusMore*` semantics, desktop activity-history clipped footers should
  use activity-specific keys such as `activityHistoryMoreTools` and
  `activityHistoryMoreSubagents` rather than reusing generic input-status
  overflow strings.
  Clipped-history footers should also mirror that readable footer text into
  both `title` and `aria-label`, because the footer sits in a narrow scroll
  region and otherwise reads as a detached, potentially truncated sentence.
  The task/subagent section ratio values in that scroll region may stay visually
  compact as `5 / 6`, but their `title` and `aria-label` should include the
  section heading, for example `Tasks: 5 / 6` or `Subagents: 2 / 3`.
  The transient rows inside the same card follow the same boundary rule:
  streaming and idle states must fall back to readable text such as
  `Streaming reply` and `Idle` instead of `chat.layout.streamingReply` or
  `chat.layout.idle`. The active-anchor summary below the activity/edit cards
  must also fall back to a readable heading such as `Current message`.
  Message-flow tool
  renderers must expose stable
  `data-chat-tool-id` anchors for single tools and `data-chat-tool-ids` anchors
  for grouped tools so status surfaces can locate the existing transcript block.
  After a status-panel jump, apply only a short-lived highlight to the target
  transcript anchor so users can confirm where they landed; do not turn the
  transcript row into a persistent selected state or duplicate the tool details
  in the status panel.
  Do not keep a full idle card in steady state just to say the chat is
  idle. The recent-edits card is also trigger-based: render it only when there
  are touched files, edit summaries, or a collapsed diff pane can be reopened.
  Do not keep a full card just to say there are no edits. MCP availability
  shown in Chat is a configuration summary for the active provider, derived from
  `useMcpStoreV2` and `buildChatMcpAvailabilitySummary()`: total configured
  servers, servers enabled for the current provider, loading state, and loading
  errors. The summary row must be expandable so users can inspect each
  configured server's name, transport/config type, and enabled/disabled state
  for the active provider without leaving Chat. Implement this expansion as an
  explicit controlled button with `aria-expanded` and conditional detail
  rendering, not as a native `<details>` disclosure, so the click target and
  rendered detail state stay testable and reliable inside the fixed status
  panel. Do not present this as a live
  connectivity check unless the UI is
  explicitly wired to `check_mcp_status`; live checks may spawn stdio MCP
  commands and should be user-triggered or otherwise carefully bounded. When a
  manual live check is exposed, keep it inside the MCP details surface, check
  only servers enabled for the active provider, and render the returned
  `online` / `offline` / `timeout` / `error` / `unknown` plus latency as a
  secondary signal next to the configuration enabled/disabled pill.
  The expanded MCP details header count for configured servers may stay
  visually compact as a bare number, but its `title` and `aria-label` must carry
  the group label, for example `Configured servers: 2`, so the count remains
  meaningful when hovered or read independently from the left label.
- Chat model selectors should follow cc-gui's compact icon + label pattern.
  The selector trigger and each option should render the same provider/vendor
  brand glyph set used by the provider selector via `ModelIcon`, not decorative
  capability icons such as Sparkles/Gem/Feather or a generic Terminal icon.
  Claude/Anthropic models use the Claude LobeHub glyph; Codex/OpenAI/GPT models
  use the shared Codex/OpenAI glyph. Keep `data-chat-model-icon` as the stable
  model-family semantic kind (for example `claude-sonnet` or `codex-codex`) and
  expose the actual rendered glyph through `data-chat-model-icon-glyph` so tests
  can guard both the model family and the vendor glyph. `ButtonArea` must receive
  a `models` prop from its parent and use the
  hardcoded built-in arrays only as a local fallback; do not make toolbar
  components fetch provider data or read provider stores directly. Keep the
  selected model visible even when it came from a loaded session or custom
  config that is not in the current dynamic list. `ModelIcon` and
  `SelectorDropdown` must wrap trigger, option, and checkmark icons in fixed
  icon boxes instead of tuning one-off SVG margins; the shared wrapper class is
  `selector-dropdown-icon-box` with trigger/option/check variants. Model-family
  glyphs have different intrinsic bounds and otherwise drift out of alignment in
  the compact toolbar.
  The Claude 1M context control follows this compact selector-row pattern:
  render a small switch next to the model selector, not a large explanatory
  panel. Its label and `title` / `aria-label` must use the shared readable
  fallback boundary (`1M context`, `Use 1M context window`, `Use standard 200K
  context window`, `1M context is not available for this model`) so users never
  see raw `chat.longContext.*` keys. The switch defaults to checked for
  supported Claude models, renders disabled and unchecked for Haiku, and is not
  shown for Codex. Store only the base model id in model selection state; append
  `[1m]` only when sending a Claude request with the toggle enabled.
- Chat provider selectors should follow cc-gui's compact provider icon pattern.
  The provider switch trigger should be icon-only with a tooltip, while dropdown
  options keep the provider label plus the same provider-specific icon. Claude
  Code and Codex must render distinct provider icons; do not use one generic
  `Terminal` icon for every provider. The Claude icon should match the
  `@lobehub/icons` Claude glyph used by cc-gui, not a generic starburst or
  other placeholder path. This is a presentational contract only: provider
  switching state remains owned by `useChatStore` and `ButtonArea` should
  receive it through props.
- `ContentBlockRenderer.compact` must be propagated to every tool surface,
  including single tool blocks, grouped Bash/Read/Edit/Search blocks, and
  Agent/Task blocks. Compact mode should be a component contract, not only a
  CSS side effect of `.assistant-message-flow`; otherwise subagent history and
  nested historical transcripts drift back into large card-style groups. A
  compact tool block still renders a one-line operation header and stays
  collapsed by default; do not render full parameters/results immediately in
  compact mode, or historical sessions become a stack of expanded output panes.
  Grouped compact tool blocks must also collapse the group body by default:
  render only the group header/summary row first, then reveal child rows and
  bulk expand/collapse actions only after the group header is explicitly
  expanded. The renderer root should expose stable spacing classes such as
  `chat-content-blocks` and `chat-content-blocks-compact`; compact mode may be
  dense, but it must still leave enough gap between adjacent text, thinking,
  image, and tool rows so historical assistant output does not collapse into an
  unreadable clump.
- Collapsible tool-block headers must not be click-only `div`s. When a tool row
  toggles details, expose `role="button"`, `tabIndex={0}`, `aria-expanded`, and
  Enter/Space keyboard handling while preserving the existing mouse click
  behavior. This applies first to high-frequency single tool blocks such as
  Bash, Read, and Edit, and must also apply to Generic when it has expandable
  input or result detail. Task and Agent tool headers also follow this contract,
  because expanding them can reveal prompt metadata and subagent history; keep
  keyboard activation on the same `expanded` state path as mouse clicks so
  history loading semantics do not diverge. Group blocks have the same
  requirement for both the group-level header and any expandable item rows
  inside the group, such as individual Bash commands, Read files, Search result
  entries, or Edit changed-file entries. Tool rows without expandable detail
  should not expose button semantics; avoid creating a focusable control that
  cannot reveal anything.
- Tool-block detail action buttons must carry a stable accessible name and
  tooltip, even when their visible label changes after feedback. For example,
  Bash `Copy Command` / `Copy Output` plus Read/Edit `Copy Path` buttons should
  keep `title` and `aria-label` on the underlying action while the visible text
  may briefly switch to `Copied`. This prevents screen-reader and mouse-tooltip
  users from losing the button's purpose during transient success states. When
  the copied value is a file path, include both the copy action and target path
  in `title` / `aria-label` (for example, `Copy path: src/App.tsx`). Bash command
  and output copy actions should do the same with a representative command target
  when known (for example, `Copy command: npm test` or
  `Copy output from command: npm test`). Generic tool input/output copy actions
  should also include the representative tool target used by the header when
  known (for example, `Copy input for tool: chat ui parity`) while keeping the
  visible button text compact if needed. When one tool block renders multiple
  copy buttons, copied feedback must be keyed by the copied target rather than
  a shared boolean. For example, Bash command/output actions should use
  `command` / `output` copied targets and Generic input/output actions should
  use `input` / `output` copied targets, so clicking one button does not make
  its sibling show `Copied`.
  Bash tool header command/result summary spans follow the same compact-summary
  rule: keep the visible command/result short, but mirror the full command and
  result summary into both `title` and `aria-label`.
  Bash group compact summaries follow the same rule. The command-count chip
  should expose a count label such as `4 commands` through both `title` and
  `aria-label`; header primary/status summaries should mirror their full text;
  row command/result summaries should mirror the full command or result
  summary; and each row status pill should include the command context, for
  example `Bash: npm test · Success`, instead of announcing a repeated bare
  `Success` / `Failed` / `Pending` token.
  Read tool header line-range summary spans follow the same rule: keep the
  visible value compact as `L11-L30`, but mirror that exact line range into both
  `title` and `aria-label`. Read file targets that open a file remain semantic
  open-file buttons with action labels; directory or other non-file target
  summaries may remain plain spans, but their `title` and `aria-label` should
  mirror the full target path.
  Edit tool header stat summaries follow the same target-label rule used by
  status surfaces: keep the visible `+N` / `-M` pills compact, expose a wrapper
  label such as `Edit stats: src/App.tsx · +1 / -1` through both `title` and
  `aria-label`, and mark the inner numeric pills `aria-hidden` to avoid
  duplicate unqualified numbers.
  Edit group total and item stat summaries follow the same contract. The group
  total target should make the aggregate scope explicit, for example
  `Edit stats: src/App.tsx · 3 files · +3 / -3`, while each item badge should
  use that row's file target, for example `Edit stats: src/App.tsx · +1 / -1`.
  Keep the visible `+N` / `-M` pills compact and mark them `aria-hidden` because
  the wrapper label carries the contextual announcement.
  Generic tool header summary spans that are not real controls follow the same
  compact-summary rule as Agent/Task headers: keep the visible text dense, but
  mirror the full summary into both `title` and `aria-label`. This applies to
  non-clickable path/directory summaries, command summaries, generic action
  summaries, and result summaries. File targets that open a file should remain
  semantic buttons with action labels such as `Open file: src/App.tsx`; do not
  turn those interactive targets back into plain spans just to share summary
  markup.
- Grouped tool-block bulk action buttons must also keep stable `title` and
  `aria-label` values that combine the visible `Expand All` / `Collapse All`
  action with the group target. These controls may later be compacted or
  iconized, and repeated groups can otherwise expose several identical
  `Expand all` buttons to assistive technology. Bash, Read, Edit, and Search
  group blocks should use labels such as `Expand all in group: npm test` while
  keeping the visible button text compact.
- Grouped tool-block bulk actions must be disabled when the target state is
  already satisfied: disable `Collapse All` when no rows are expanded, and
  disable `Expand All` when every valid row is expanded. Keep the action +
  target `title` / `aria-label` on disabled buttons so users still understand
  why the control exists in the group. Reuse the shared bulk-action state helper
  instead of duplicating index filtering in each grouped tool component; Edit
  groups must pass the visible edit-row count, not raw tool-use count.
  Grouped tool components should also reuse the shared expanded-index helpers
  when expanding all rows or toggling one row, so the state transition and the
  disabled-state calculation use the same valid-index contract. Edit groups
  must pass the visible edit-row count to both helpers.
  Tool-block headers and grouped tool item rows that render custom
  `role="button"` toggles must also reuse the shared keyboard-activation helper
  for Enter/Space handling, instead of duplicating key comparisons in each
  component. This includes Bash, Read, Edit, Generic with expandable content,
  Task, Agent, group headers, and expandable group item rows.
- Search-result file buttons that call `openFile()` must include both the
  action and target in `title` and `aria-label`, for example `Open file:
  src/App.tsx`. The visible label may stay as the compact path, but focused
  controls should not read as a bare path with no action context.
- Any tool-block header target that calls `openFile()` must be a semantic
  control, not a click-only `span`. Prefer a native
  `<button type="button">` with the existing path-link classes reset to match
  inline text styling, call `event.stopPropagation()` before opening the file,
  and expose the same action + target label in `title` and `aria-label`.
  Non-file targets such as directories may remain plain summary text unless
  they have a real action.
- Generic tool result display must normalize MCP text-block wrappers before
  rendering. Decode arrays or wrapper objects such as `{ content: [{ type:
  "text", text: "..." }] }`, and restore literal escaped newlines in codegraph
  output before handing the text to a `<pre>`. Do this in shared presentation
  helpers, not inside individual tool components.
- Generic `AskUserQuestion` tool blocks are user-interaction records, not failed
  execution records. If the SDK reports the matching `tool_result` with
  `is_error: true`, `GenericToolBlock` should still render the status as
  completed unless the tool was explicitly denied by the user. Ordinary generic
  tools must continue to render `is_error: true` as an error state.
- Agent-like tool blocks (`AgentGroupBlock`, `TaskExecutionBlock`) must share
  their transcript-summary shaping through `extractAgentToolMeta()`,
  `summarizeAgentToolMeta()`, `summarizeAgentToolHeader()`, and
  `getAgentToolExtraParams()` in `src/utils/toolPresentation.ts`. Do not
  hand-roll separate header-summary or input-filter logic per component, or the
  assistant flow will drift back into inconsistent chips/badges between
  `agent`, `task`, and `spawn_agent`. Compact header summaries in these blocks
  are often truncated, so visible primary, secondary, and runtime summary spans
  should mirror their displayed text into both `title` and `aria-label`; the
  parent header keeps the action label such as `Toggle task details: <target>`.
- Subagent execution summaries should keep display text and interaction targets
  separate. If a process card shows compact file paths such as `…/src/foo.ts`,
  the backing model must still preserve the real `openPath` used by
  `openFile(path, start, end, currentCwd)`; do not try to reconstruct the path
  later from the truncated label. Pure summary presentation (for example
  `SubagentProcessSummary`) should stay decoupled from the async history-loading
  wrapper so the interaction layer can be regression-tested without depending on
  `useEffect` timing.
- Subagent execution summaries should keep the "other tools" section as a compact
  operation log rather than a generic badge pile. Reuse shared tool-summary
  helpers such as `summarizeCommand()` and the existing search/read/list/web
  semantics to classify the row, but keep the transcript-level interaction
  targets and the visual label separate. The summary row should remain
  scan-friendly and low contrast inside assistant flow, with file/open
  affordances still pointing at the preserved `openPath`.
- Chat transcript layout follows cc-gui's document-flow model: user messages may
  use a right-aligned compact bubble, but assistant messages must not be wrapped
  in a full card/bubble per response. Assistant text, thinking blocks and
  tool-use events should share one transparent flow container, with copy/meta
  affordances kept subtle. When rendering Markdown inside user bubbles, cap
  heading sizes so pasted prompts such as `# AGENTS.md` remain prompt text
  instead of becoming hero-scale typography. In assistant flow, tool blocks
  should use low-contrast operation-row styling (for example a subtle rail and
  one-line summary) rather than visually competing with the answer body.
- Large historical transcripts must not force the first Chat render to derive
  anchors, status summaries, search text, or tool-result lookups from the full
  `messages` array. In normal browsing mode, use the shared recent-window helper
  from `chatNavigation` to render only the visible tail plus any explicitly
  revealed earlier page, preserving each item's `originalIndex` for stable
  anchor behavior. Search is the explicit full-history mode and may scan all
  renderable messages, but only after `ChatPage` has triggered
  `useChatStore.loadActiveSessionFullHistory()` for a `windowed` session and
  received a complete search source. Normal-browsing status summaries should be
  built from the raw message slice that starts at the visible window's first
  original index so hidden `tool_result` records for visible tools remain
  available without summarizing unrelated older turns. Search-mode status
  summaries must not receive the complete search source again after filtering;
  derive them from a bounded context around matched renderable messages so
  matching tool results stay available without a second full-history scan. Tool
  result lookup should be pre-indexed for the
  visible/tail window at the list level instead of scanning the full transcript
  once per rendered tool block. Store-level history caches may keep complete
  mapped transcripts, but repeated session loads must still pass only the
  recent display window into `messages`; do not treat a cache hit as permission
  to hydrate React with the full transcript. Component code must continue
  treating `messages` as immutable data so cached message references cannot be
  invalidated by accidental in-place changes. First-paint history windowing is
  a store/backend contract: components should render the loaded `messages`
  window they receive and should not issue their own full-history command to
  compensate for a partial first paint. Partial large histories are a completed
  normal-browsing state: `useChatStore` reports them as `windowed` and must not
  automatically issue `get_unified_session_messages()` for cache/diagnostics.
  Full-history reads must be tied to an explicit search/reveal intent with its
  own paging or indexing boundary; the current search path uses the complete
  history as a temporary `MessageList` search source without replacing the
  normal visible `messages` window. While a `windowed` session search is
  loading its complete history, the transcript search summary must say that
  complete history is still being searched instead of presenting current-window
  matches as final. If that explicit full-history search fails, keep the loaded
  window searchable and expose a compact retry affordance owned by `ChatPage`;
  `MessageList` should receive this as display props and must not invoke the
  store directly. MessageList reveal pagination must keep total and remaining
  counts separate: helpers that advance reveal state take the stable total
  revealable earlier-message count, while the collapsed notice displays the
  current remaining hidden count and next page size. Do not pass a shrinking
  remaining count as the total bound, or histories such as 46 hidden messages
  can reveal 30 and then get stuck before the final 16.
  Loading earlier messages may happen through either the explicit collapsed
  notice button or a guarded top-scroll auto reveal. The auto reveal must only
  fire while normal browsing has remaining collapsed earlier messages, no
  reveal is already pending, and the scroll position is within the top
  threshold. Once the collapsed count reaches zero, top scrolling must settle at
  the true transcript top without triggering another reveal attempt.
  MessageList search/reveal chrome must use readable i18n
  fallbacks at the rendering boundary: search result summaries, no-result
  states, full-history loading/error text, retry button `aria-label`/text, and
  collapsed-earlier message notices should fall back to labels such as
  `Found 2 matching messages`, `No matching messages found`, `Searching
  complete history for older matches...`, `Complete history search failed.
  Current results only cover the loaded window.`, `Retry`, and `2 earlier
  messages are collapsed. Click to load 2 more` instead of raw
  `chat.layout.search*` or `chat.message.showEarlier` keys. Message transcript
  chrome follows the same fallback rule: role labels, copy/copied actions, empty
  user placeholders, waiting indicators, and streaming-connected chips must
  fall back to readable labels such as `You`, `AI Assistant`, `System`, `Copy`,
  `Copied`, `Empty message`, `Waiting for response...`, and `Connected,
  generating response...` instead of raw `chat.message.*` keys when i18n returns
  a key. The right
  `StatusPanel` may show
  the latest session-load performance snapshot from `useChatStore`, including
  cache hits, first-paint window counts, windowed status, map times, and total
  elapsed time. This is diagnostic display only: rendering the panel must not
  trigger another history read, remote check, or cache mutation. Keep completed
  or windowed session-load metrics collapsed behind an explicit diagnostic
  toggle so normal status scanning stays compact; automatically expand the
  metrics only while a load is still running or when an error must remain
  visible. The session-load diagnostic card must also use readable fallback
  labels when i18n returns keys: users should still see compact text such as
  `History load`, `Loading`, `Load failed`, `Window first paint`, `Cache hit`,
  `Source`, `Window`, `Cache`, `Full`, `Elapsed`, and `Map 7ms` instead of raw
  `chat.layout.sessionLoad*` keys. Its diagnostic toggle must also carry an
  action-specific `title` / `aria-label`, such as `Expand history load details`
  or `Collapse history load details`, instead of relying only on `aria-expanded`
  and the visible summary text. The session-load status pill should also carry
  a target label such as `History load: Loading` or `History load: Complete`,
  because the visible pill text is intentionally short inside a dense
  diagnostic row. The session-load diagnostic card container should expose a
  composite target label such as `History load: Window first paint · 120 / 5000
  · 161ms · Source · <path>` through both `title` and `aria-label`; a bare JSONL
  path is hard to interpret when read outside the visible diagnostic card, while
  the compact summary is the value users scan first. The collapsed session-load summary value should
  expose its compact text as `History load: <summary>` through both `title` and
  `aria-label`, because it may truncate independently from the source-path
  container and otherwise reads as bare counts/timing. Expanded session-load
  detail value rows should follow the same field + value target-label rule:
  keep visible values compact, but expose labels such as `History load: Window ·
  120 / 5000 · 40ms · Map 7ms`, `History load: Full · 5000 · 50ms · Map 11ms`,
  and `History load: Cache · 5000 · 2ms` through both `title` and `aria-label`.
  If session-load details include an error message,
  keep the visible error text raw but give the row a contextual `title` /
  `aria-label` such as `History load: Load failed · Cache read failed`; the
  error line is truncated in the compact panel and otherwise loses the
  diagnostic source.
- Chat composer completion menus own Enter/Tab while open, including the loading
  state before items arrive. A user typing `/`, `@path`, or `#agent` should not
  accidentally send the half-completed token just because the async completion
  query has not returned yet. Keep the keyboard-consumption decision in a shared
  helper so `/`, `@`, `#`, and `!` triggers follow the same behavior. If
  `useChatStore.send()` reports failure before a backend request id exists,
  `ChatComposer` should restore the local attachments it cleared for optimistic
  sending, merging them with any attachments the user added while the send was
  pending and avoiding duplicates. Restore draft text only when the current
  store draft is still empty so a user-typed replacement is not overwritten.
  `ChatComposer` must also hold a local pre-request submit guard before
  `activeRequestId` is available. `useChatStore.send()` sets `activeRequestId`
  only after `chat_send` returns a backend request id, so double-clicking the
  send button or pressing Enter twice in that gap can otherwise send the same
  draft twice. Represent this state separately from streaming: while waiting
  for the request id, disable send/enhance/selectors and show a disabled sending
  affordance, not the Stop button, because `chat_abort` cannot target a request
  id that does not exist yet. Prompt enhancement needs the same immediate
  ref-level guard in addition to rendered `enhancing` state: double-clicking the
  Sparkles button before React commits the loading state must not issue multiple
  `chat_enhance_prompt` invokes for the same prompt. On enhancement failure,
  keep the original draft intact and close the comparison dialog so users do not
  mistake an empty enhanced result for a valid rewrite. Once the enhanced prompt
  is available, the comparison dialog should support `Enter` to use the enhanced
  prompt and `Escape` to close, matching cc-gui's keyboard-speed path. Route
  these through a pure helper and do not steal `Enter` from focused buttons or
  editable controls, otherwise a focused footer button can invoke both native
  click behavior and the global shortcut.
- Plan approval dialogs should support the same keyboard-speed path as cc-gui:
  `Enter` approves the default execution mode and `Escape` denies/cancels the
  plan. Keep shortcut routing in a pure helper so it is testable without a DOM
  renderer. Do not steal `Enter` from focused buttons or editable controls;
  those elements should keep their native behavior. The store-level
  `approvePlan()` idempotence guard remains mandatory and is the final
  duplicate-response boundary. The component should still mark itself submitted
  on the first approve/deny/cancel path, disable response controls, and ignore
  repeated keyboard/backdrop/button triggers while the store writes the response.
  This mirrors cc-gui's `markSubmitted()` pattern and prevents users from seeing
  an apparently clickable blocking dialog after they have already answered it.
  Reset submitted state when the `request` object changes, not only when
  `requestId` changes; store failure recovery deliberately restores the same
  request id with a fresh object reference so the user can retry.
- Tool permission dialogs should offer the same fast path for the common
  allow/deny decision: `Enter` allows once and `Escape` denies. Keep the
  keyboard routing in a pure helper, avoid stealing `Enter` from focused buttons
  or editable controls, and rely on `answerToolPermission()` as the final
  request-id idempotence boundary. The component should also mark itself
  submitted on the first allow/deny/backdrop path, disable response controls,
  and ignore repeated keyboard/backdrop/button triggers until the store clears
  or restores the pending request. Reset submitted state when the `request`
  object changes, not only when `requestId` changes.
- AskUserQuestion dialogs should follow cc-gui's safer question flow: `Escape`
  cancels when focus is outside editable controls, but `Enter` must not be a
  global submit because question options and custom text inputs own their native
  keyboard behavior. The component should mark itself submitted on the first
  submit/cancel path, disable answer controls, and show a lightweight submitting
  state while the store-level `answerAskUserQuestion()` idempotence guard writes
  the response. Keep shared editable-target and single-submit primitives in
  `src/utils/dialogShortcuts.ts` so plan approval, tool permission, and
  AskUserQuestion dialogs do not drift into three different shortcut rules.
  Like the other blocking permission dialogs, reset submitted state when the
  `request` object changes so failure restoration of the same request id
  re-enables answer controls.
- `ChatPage` must mount only one blocking permission dialog at a time even when
  multiple pending permission events exist in the store. Use
  `getActivePermissionDialog()` to select the newest pending request by
  timestamp, with the visual fallback priority `tool-permission > plan-approval
  > ask-user-question` for ties, missing timestamps, or invalid timestamps.
  Candidate inclusion must be based on whether the pending request object
  exists, not on timestamp truthiness; an empty or malformed timestamp should
  still surface the blocking dialog and only lose ordering priority. Hidden
  pending requests stay in the store and surface after the active dialog
  responds. Do not render all permission portals simultaneously, because each
  dialog owns a global keyboard listener and one `Escape` / `Enter` press could
  otherwise answer multiple daemon-blocking requests.
- Chat history must treat uploaded images as structured content blocks, not as
  filename-only prompt text. `ContentBlockRenderer` owns `image` /
  `input_image` rendering: show a bounded thumbnail in the transcript, open a
  portal lightbox on click, and keep local-path/base64 source parsing in shared
  image-block helpers. Local `file:///C:/...` style image URLs from historical
  Codex/Claude payloads must be normalized to filesystem paths before calling
  Tauri asset conversion; do not feed the `file://` wrapper into the WebView as
  the final image source. The full-size lightbox must retain visible source
  context by rendering the image label/file name as a caption in addition to
  `alt`/`aria-label`, so users can inspect multiple screenshots or historical
  attachments without losing which file they opened.
  User-message image thumbnails must stay compact even when several uploads are
  adjacent. In `imageDisplay="user-thumbnail"` mode, group consecutive `image`
  / `input_image` blocks into a right-aligned thumbnail strip with fixed-size
  thumbnail frames, wrapping only when needed. Do not let user-uploaded images
  render as independent full-width blocks inside the message bubble; the
  full-size image belongs in the click-to-preview lightbox.
  System-role history messages are protocol context and
  must be filtered out before transcript rendering or anchor generation. Some
  historical providers replay runtime context as user text instead of `system`;
  hide recognizable Codex/Claude system prompts, Tools/Skills/Plugins/Heartbeats
  blocks, sandbox/environment XML blocks, and model handoff summaries such as
  `Another language model started...` / `## Handoff Summary` from transcript
  rendering and provider-switch handoff context. Codex can also replay control
  markers as user
  text, including `<turn_aborted>`, `<user_action>`,
  `<subagent_notification>`, `<agents-instructions>`, and `<skill>`; route these
  through the same shared protocol-context predicate so they disappear from
  transcript rendering, search, anchor generation, and provider handoff. Do not
  hide all arbitrary XML-looking user text, because image placeholders and task
  prompts can carry real user-visible content. The narrow exception is Codex
  image wrapper text: when the same raw message contains a real `image` /
  `input_image` block, pure placeholder text such as `<image name=...>` and
  `</image>` should be filtered from rendering, merged visible content, search,
  and anchor labels while preserving the image block and the user's real prompt.
- Chat history text blocks are Markdown document fragments, not independent
  cards. After filtering non-user-visible image residue or protocol context,
  adjacent `text` blocks must be merged before `ContentBlockRenderer` calls
  `MarkdownBlock`; otherwise headings, blank lines, and list items from the same
  assistant answer can render as several cramped Markdown islands. Do not merge
  across `image`, `thinking`, `tool_use`, or other non-text blocks, because those
  boundaries represent real transcript structure.
  Markdown code-block copy controls must also keep readable i18n fallbacks at
  the DOM-effect boundary: button `title` and `aria-label` should fall back to
  `Copy code` and `Copied code` instead of raw `chat.markdown.copyCode` /
  `chat.markdown.copiedCode` keys when translations are not initialized.
- Long-session anchor rails should stay readable under dense histories. Generate
  anchors from renderable user messages in the currently revealed transcript
  window, then sample dense anchor lists through a pure helper that preserves
  the first, last, and active anchor. Keep point positions based on the original
  anchor index so the rail still communicates relative conversation progress.
  Anchor projections must preserve more than a display string: include the
  preview kind (`text`, `image`, `mixed`, or `empty`), visible sequence, total
  count, and timestamp when available. The rail uses that metadata for contrast,
  hover detail, and accessible labels; do not infer image/text state later from
  the truncated label. Dense sampling should prefer anchors with real content
  previews (`text`, `image`, or `mixed`) before `empty` anchors; preserve the
  active anchor even when it is empty, but do not let empty protocol remnants
  consume the visible rail budget. Anchor candidates must use a shared
  predicate for both rail data and `MessageList` node registration: user
  messages need visible prompt/image content, while internal `[tool_result]`,
  blank, or protocol-context user rows must not become anchors.
  Before `MessageList` reports its actual collapsed-count state for a newly
  loaded history session, page-level anchor derivation should assume the default
  collapsed transcript window rather than zero collapsed messages; otherwise the
  rail briefly creates anchors for historical messages whose DOM nodes are not
  mounted and jump targets appear wrong.
- In assistant flow, runtime metadata such as model / reasoning effort /
  short agent id and placeholder subagent-history surfaces are secondary
  signals. Render them with lower contrast than the primary action summary and
  avoid introducing standalone heavy badges or boxed placeholders that break
  the transcript's continuous reading rhythm. When a message has finished
  streaming, the metadata footer should stay compact and inline-style in the
  assistant flow instead of reintroducing a verbose label block; use the compact
  variant for final assistant rows so the transcript reads like a single
  continuous operation log rather than a stack of repeated footnotes.
- Chat composer layout should stay compact by default. The textarea starts as a
  single-row control and grows only with content; toolbars should not wrap into
  multiple rows at common desktop widths. Attachment chips must represent real
  payloads sent through `ChatAttachment`; do not fake image/file context by
  prepending `@filename` to the prompt. Empty composer context should stay quiet
  instead of rendering placeholder text that increases the input area's height.
  When handling paste on the contenteditable composer, pasted image files must
  call `preventDefault()` before entering the attachment flow; otherwise the
  browser may insert an `<img>` into the editable body while the same file is
  also shown as a thumbnail. If a paste contains both image data and plain text,
  keep the image in `ChatAttachment` thumbnails and insert only the plain text
  into the editor.
  In the Chat page, place the composer inside the central conversation column
  and center its inner content with a bounded max width; it must not span across
  the session sidebar or status panel on wide screens. If the composer exposes a
  drag handle for resizing, the drag must update the textarea's visible height,
  not only a `max-height` cap, otherwise an empty draft appears non-resizable.
  Keep the default compact height near a single-row input, clamp the drag range
  through shared helpers, and keep the final height free of horizontal overflow
  in the central conversation column. The bottom composer toolbar should keep
  selectors in a flexible left group and prompt-enhance/send/stop actions in a
  fixed right group; under tight widths, selectors may wrap before primary
  actions are pushed off-screen. The toolbar wrappers should expose stable
  layout classes (`chat-composer-toolbar`,
  `chat-composer-toolbar-selectors`, `chat-composer-toolbar-actions`) so tests
  can guard the layout contract. Enhance/send/stop are icon-only action buttons:
  keep them fixed square (`h-7 w-7 shrink-0`) with `aria-label`, and do not
  reintroduce auto-width DaisyUI button classes for the primary send/stop
  affordance. Composer toolbar selector and action labels must use the shared
  fallback helper contract at the rendering boundary: if i18n returns keys,
  provider/mode/model/reasoning titles, model refresh/loading states, enhance,
  send, and stop controls should still expose readable labels such as
  `AI provider`, `Permission mode`, `Model`, `Reasoning effort`,
  `Refresh models`, `Refreshing models...`, `Loading models...`,
  `Enhance prompt`, `Send`, and `Stop` instead of raw `chat.*` keys. The
  mode/reasoning selector's visible current value and option menu text follow
  the same rule: if i18n returns keys, show labels/descriptions such as
  `Default Mode`, `Agent Mode`, `Auto Mode`, `Requires manual confirmation for
  each operation`, `High`, and `Deep reasoning for complex tasks` instead of
  `chat.modes.*` or `chat.reasoning.*` keys. Composer input-surface chrome must
  also use the same rendering-boundary fallback contract: attachment buttons,
  remove-attachment chips, status-panel toggle, resize handle, rich placeholder,
  completion empty state, drop overlay, and draft-history hint should remain
  readable as `Add attachment`, `Remove attachment`, `Collapse status panel`,
  `Expand status panel`, `Drag to resize the input`, `No matches`, or equivalent
  plain-language fallback text instead of raw `chat.attach`,
  `chat.resizeComposer`, `chat.richPlaceholder`, or `chat.completion.*` keys.
  Completion menus should expose a named `listbox` region, announce loading with
  a readable `role="status"` text such as `Loading suggestions...`, and mark
  selectable rows as `role="option"` with accurate `aria-selected` state.
  Option accessible labels should include both the item label and its
  description when present, so slash commands, files, agents, and prompt presets
  stay understandable without requiring visual tooltip inspection. For the
  contenteditable rich input, the submit and prompt-enhance enablement state
  must be derived from the editor's current plain text, not only from the
  persisted Zustand `draft`. WebKit/macOS can leave React `onInput` / IME
  composition timing out of step with the editable DOM; keep a local plain-text
  mirror updated through normal input handlers plus a `MutationObserver`
  fallback, and have the final submit path read the DOM via `getText()` again.
  Regression tests for composer submission should cover the case where the DOM
  contains text while `draft` is still empty so the send button cannot remain
  disabled and silently drop the user's click. Prompt
  enhancer modal chrome follows the same fallback rule: the modal title, close
  button title, original/enhanced column headings, loading text, and footer
  actions must stay readable as `Enhance prompt`, `Close`, `Original prompt`,
  `Enhanced prompt`, `Enhancing prompt...`, `Keep original`, and `Use enhanced`
  instead of raw `chat.enhancer.*` or `common.close` keys.
- Chat composer slash completions must not be maintained as a short frontend-only
  hardcoded list. The `/` trigger should call `chat_list_slash_commands` with
  the current `cwd` and provider, then normalize the backend registry payload
  into `CompletionItem`s. The frontend fallback list is only for backend
  failures and must stay aligned with cc-gui built-ins such as `/context`,
  `/plan`, `/resume`, `/batch`, `/claude-api`, `/debug`, `/loop`, `/simplify`,
  `/update-config`, and Codex `/diff`. Project command files from
  `.claude/commands/**/*.md` should show their source suffix (for example
  `[project]`) so users can distinguish built-in and local commands.
- Chat composer completion rows for `@` / `/` / `#` / `!` triggers must follow
  the cc-gui list-style anatomy: a leading lucide kind icon, a primary label
  that takes the remaining horizontal space (`flex-1 truncate`), and a
  right-aligned faded secondary text with a max width and `truncate`. Map
  `kind` to icons through a single helper (`file` -> `File`, `directory` ->
  `Folder`, `command` -> `Terminal`, `agent` -> `Bot`, `prompt` -> `Sparkles`,
  default `File`); keep `kind` optional on `CompletionItem` so legacy items
  fall back to the default icon without breaking. This row anatomy is the
  canonical pattern for any list-style menu surfacing a "what + where" pair
  (file + parent path, command + source tag, agent + description), so reuse it
  rather than introducing per-trigger ad hoc layouts.
- For `@` file completion items, separate display text from insertion text:
  the `label` is the basename (with a trailing `/` for directories) and the
  `description` is the parent directory path; `insertText` stays the full
  `relPath` so the inserted reference chip remains unambiguous. Keep the
  trailing `/` on directory labels because `applySelection` relies on
  `item.label.endsWith('/')` as the `isDir` signal at insertion time. The same
  display-vs-insertion split applies whenever a completion row needs a compact
  display label but must insert a longer disambiguated token.
- Chat composer model selection should not be limited to the static fallback
  arrays in `constants.ts`. The selector should merge active Provider model
  fields, locally cached dynamic models, and fallback models through
  `chatModels.ts`. Remote model discovery must stay behind an explicit
  user-triggered refresh icon next to the model selector because it calls a
  provider API with the configured key. The refresh control is icon-only with a
  tooltip/accessible label, shows a spinner while pending, and surfaces concise
  errors without rendering API keys or other secrets.
- Transcript history reveal should prefer scroll-triggered paging over repeated
  click-only affordances when the chat page owns a dedicated scroll container.
  When prepending older messages, preserve the user's viewport by capturing the
  previous `scrollHeight` and `scrollTop`, then restoring `scrollTop` with the
  delta after render. Do not snap the user back to the top after each reveal.
  Reveal state must be scoped to a transcript key such as the first renderable
  message id; when a user switches sessions, the new history should start from
  the default recent-message window instead of inheriting an "all earlier
  messages revealed" state from the previous session.
- Edit tool summaries should expose per-file additions/deletions and a hoverable
  diff preview. The preview data must come from structured `diffPreviewLines`
  emitted by shared presentation helpers so `apply_patch`, `edit_file`, and
  grouped edit payloads all render through the same hover component instead of
  building ad hoc preview strings inside the React layer. Diff hover previews
  should use solid backgrounds, high z-index, and viewport-aware placement:
  center previews in the transcript area, and expand right-sidebar previews left
  into the conversation area so code is readable and not clipped by side panels.
  Do not render a diff hover preview inside an opacity-reduced parent such as
  `.tool-title-summary { opacity: ... }`: parent opacity is composited after all
  descendants paint, so the tooltip remains translucent even if the preview sets
  `opacity: 1` and an opaque background. If summary text needs to look muted,
  use theme-token color alpha (for example `oklch(var(--bc) / 0.58)`) on the
  text rule instead of parent `opacity`, and keep clickable file links excluded
  from generic muted summary overrides.
  Transcript hover previews should show the full available diff by default and
  let the preview body scroll with `overflow-y: auto`; otherwise a change such
  as `+19 / -12` can show only the first 16 ordered lines and hide most added
  content with no recovery path. Keep pointer events enabled on the scrollable
  transcript preview and stop wheel/click propagation at the tooltip so users
  can inspect the diff without accidentally triggering the outer open-file
  button. Status-surface hover previews are the exception: they remain capped and
  expose the hidden-line count in the header.
  Diff preview header values that are exposed through `title` must also expose
  the same value through `aria-label`: file path, line-change summary, and
  status-surface hidden-line clues are key preview context, not decorative
  tooltip-only text. The default hover footer hidden-line clue
  (`edit-diff-hover-more`) follows the same rule when lines are truncated:
  keep the visible `N more lines` text, and mirror it into `title` /
  `aria-label`. The adjacent visual `+N` / `-N` stat pills must stay visible
  for scan speed but should be `aria-hidden`, because the summary already
  carries the accessible `N added, M removed` label and duplicate bare numbers
  make screen-reader output noisy. Diff preview line rows should expose a
  contextual accessible name that includes the change type, line number, and
  code text, such as `Removed line 11: oldValue` or `Added line 11: newValue`,
  while preserving the visible line number, marker, and code content. When line
  rows are hoverable or truncated, mirror that same contextual row label into
  `title` so mouse tooltips and assistive-technology names stay aligned. Do not
  hide real diff content as decorative just to reduce noise; if a line needs a
  cleaner accessible name, put that name on the line row and keep the code text
  visible. Split diff cells should add old/new column context on top of the row
  label, for example `Old side: Removed line 11: oldValue` and `New side: no
  content for Removed line 11: oldValue`, so users inspecting a two-column diff
  can tell whether a visible or empty cell belongs to the previous or resulting
  version.
  When the same file is edited multiple times in one grouped edit sequence,
  the visible file list must merge those rows into one per-file item while
  summing additions/deletions and preserving combined diff preview lines. Keep
  that merge in shared tool-presentation helpers so the transcript group and
  status panel report the same touched-file counts.
- Historical Codex file changes must enter the UI as normalized
  `tool_use{name:"apply_patch", input:{patch}}` blocks from the backend
  provider. The status panel should count those through
  `collectEditToolItems()` just like live edit tools; do not parse raw Codex
  JSONL payload variants directly in React components.
- Status-panel edit totals must be computed from the full aggregated edit set,
  even if the visible `recentEdits` list is capped for layout. Keep the sidebar
  list compact, but `touchedFileCount`, `totalAdditions`, and `totalDeletions`
  should reflect all touched files in the loaded transcript window so long
  Codex/Claude histories do not look like they only changed the four newest
  visible files. When the capped list hides additional files, show a compact
  "more files" row that can expand to the complete `allEdits` list and collapse
  back to recent edits, so the user can inspect every touched file without
  making the default sidebar dense. The desktop recent-edits card chrome and
  diff toolbar must also keep readable i18n fallbacks: card title, edit summary,
  expand/collapse tree button, diff view mode group, unified/split view buttons,
  reopen diff review button, folder/file action labels, open-file button, and
  hidden-file toggle should fall back to labels such as `Recent edits`,
  `2 files · +3 / -1`, `Collapse edit tree`, `Diff view mode`, `Unified diff
  view`, `Split diff view`, `Open diff review for <file>`, `Current full diff:
  <file>`, `Open file: <file>`, and `1 more file not shown in this list`
  instead of exposing `chat.layout.*` or `tools.openFileForPath` keys when i18n
  is not initialized. Keep the hidden-file fallback contextual; a bare
  `1 more file` loses the fact that the row is an overflow control for the
  current recent-edits list.
  The compact edit summary value should also carry the same readable summary in
  both `title` and `aria-label`, for example `2 files · +3 / -1`, because the
  row intentionally hides the underlying labels to keep the status sidebar
  dense.
- The chat input area must expose a compact status strip directly above the
  composer, but the strip is trigger-driven rather than always filled with zero
  placeholders. Show the current Git branch only when the current `cwd` resolves
  to a Git repository and a branch or detached-head label is available. Show the
  tasks, subagents, and edits entries only when their underlying data exists:
  tasks come from non-agent tools in the loaded `toolTimeline`, subagents come
  from `agentTools`, and edits come from `allEdits` / edit totals. Do not list
  agent/subagent runs in the tasks panel as well as the subagents panel; users
  read those as two different queues. The strip may also show an MCP entry when
  `ChatMcpAvailabilitySummary` has configured servers, a loading state, or an
  error; this is the small-screen fallback for the right
  `StatusPanel` MCP details. If none of those signals exist, do not render the
  strip at all. Keep the default surface compact and treat each tab as a quick
  entry chip: icon, short label, compact count pill, and a full `aria-label` /
  tooltip. On small widths the visual label may hide while the count pill stays
  visible. The Git branch chip follows the same density rule even though it is
  not expandable: hide its visual "branch" label on small widths, keep the
  branch value truncated, and put the full branch/root context in `aria-label`
  and `title`. Full diagnostic detail belongs in the expanded quick-detail
  popover and the right `StatusPanel`, not in the collapsed composer strip. The
  strip's quick-detail surface must be anchored to the strip container and
  absolutely positioned above the toolbar so opening tasks/subagents/edits/MCP
  details does not push, resize, or reflow the composer. Because this surface is
  transient, it should close when the user clicks outside the strip/panel or
  presses `Escape`, matching the popover behavior users expect from cc-gui.
  The popover's scroll container must also be keyboard-focusable and exposed as
  a named `region`, so users can focus and scroll task, subagent, edit, or MCP
  details without first tabbing through every row. That region label must also
  use an i18n fallback such as `Status details`; do not expose
  `inputStatusDetailsRegion` when translations are not initialized. Overflow
  footers in tasks, subagents, and edits panels must also use readable fallback
  text such as `+1 more tool task`, `+1 more subagent`, and `+1 more edit`;
  do not expose `inputStatusMoreTools`, `inputStatusMoreSubagents`, or
  `inputStatusMoreEdits` when translations are not initialized. Empty states
  in those same quick-detail panels should use the same fallback boundary:
  `No task or tool activity yet`, `No subagent calls yet`, and `No file edits
  yet` instead of raw `inputStatusNoTasks`, `inputStatusNoSubagents`, or
  `inputStatusNoEdits` keys.
  Task and subagent rows inside this small-screen fallback should reuse the
  page-level transcript jump handler instead of becoming static duplicates:
  render them with `data-target-tool-id`, accurate task/subagent `aria-label`
  keys, readable visible state pills (`Pending` / `Failed` / `Success` as
  fallbacks when i18n returns keys), and disabled read-only semantics only when
  no selection handler is available. The row button `title` must use the same
  jump action label as `aria-label`, such as `Jump to tool task: npm test` or
  `Jump to subagent activity: Review composer status strip`; summary/detail
  remain visible row content, not the control tooltip. The row status pill itself should match
  the desktop `StatusPanel` target-label behavior by exposing the tool type,
  target summary, and status in `title` / `aria-label`, for example
  `npm: npm test · Success` or `Agent: Review composer status strip · Pending`.
  After a successful task/subagent jump, close the transient
  quick-detail popover so the bottom-anchored panel does not obscure the
  highlighted transcript target on narrow screens. Selecting an edited file
  from this strip should reuse the page-level diff selection handler instead of
  opening a separate diff implementation. Edit rows must stay disabled and
  read-only when that handler is unavailable, and a successful edit selection
  should close the transient quick-detail popover so the selected page-level
  diff/context is not obscured. Edit-row `+N` / `-N` stats in this small-screen
  fallback should also carry the target file path in `title` / `aria-label`, for
  example `Edit stats: src/App.tsx · +5 / -2`, so repeated compact numbers do
  not lose their file context. The edit row action button should also connect
  to that stats group with `aria-describedby` so focus on the full-diff action
  exposes both the action and the change scale; do not emit dangling
  descriptions when no stats group is rendered. MCP details in the composer
  strip must list
  configuration availability only (server name,
  transport/config type, enabled/disabled) and must not run live connectivity
  checks. MCP panel and server row labels must use readable fallbacks when i18n
  returns keys: panel chrome should still show labels like `Configured servers`,
  `Loading MCP configuration...`, `No MCP servers configured`, and `+N more MCP
  servers`; server rows should still show labels like `Unknown`, `Enabled`, and
  `Disabled`. Do not expose raw MCP i18n keys such as `mcpLiveUnknown`,
  `mcpEnabled`, `mcpDisabled`, `mcpConfiguredServers`, `mcpLoading`,
  `mcpNoServers`, or `inputStatusMoreMcpServers` in the quick-detail surface.
  The visible server name in these small-screen MCP rows should carry the same
  target label as the desktop panel, for example `MCP server: Filesystem`, in
  both `title` and `aria-label`; do not put a bare server id such as
  `filesystem` on the outer row as the only tooltip.
  MCP configuration error rows in the same composer quick-detail surface should
  keep the raw error visible, but expose the source and category in `title` /
  `aria-label`, for example `MCP: Configuration error · Failed to load mcp.json`.
  Do not leave the row as a tooltip-only bare error string.
  MCP loading rows in that same composer quick-detail surface should keep the
  visible loading text but expose the source in `title` / `aria-label`, for
  example `MCP: Loading MCP configuration...`, so transient loading states are
  not detached from the MCP panel context.
  The composer MCP tab button should reuse those loading/error target labels
  for its own `title` / `aria-label` while those states are active, instead of
  exposing only a count such as `MCP 0 / 0`. In the ordinary configured-server
  state, keep the visible count pill compact (`1 / 2`), but use the configured
  summary in the tab `title` / `aria-label`, for example `MCP: 1 / 2 available`,
  so the enabled/total ratio is not detached from its meaning in hover or
  assistive-technology output.
  The MCP server row status pill in this small-screen fallback should also name
  the server in `title` / `aria-label`, for example `Filesystem: Enabled` or
  `GitHub: Disabled`, so repeated short status pills stay meaningful outside
  their visual row context. The transport/config token in that same small-screen
  row should follow the desktop transport rule too: keep the visible value
  compact as `stdio`, `http`, or `Unknown`, but expose server + transport
  context such as `MCP server transport: Filesystem · stdio` in both `title`
  and `aria-label`.
  The desktop `StatusPanel` MCP summary/details follow the same fallback
  contract for `mcpEnabledSummary`, loading/empty/configured labels, enabled /
  disabled state pills, live status/latency labels, and manual live-check
  controls; if i18n returns the key itself, users should still see readable
  text such as `1 / 2 available`, `Configured servers`, `Enabled`, `Online`,
  `24ms`, and `Checking...`. The desktop MCP summary container should keep the
  visible summary compact, but expose the MCP source in `title` / `aria-label`,
  for example `MCP: 1 / 2 available`; error summaries may continue to use the
  diagnostic form `MCP: Configuration error · <detail>`.
  The MCP summary toggle must also carry an action-specific `title` / `aria-label`, such as `Expand MCP details` or
  `Collapse MCP details`, so focused controls and assistive technology expose
  the actual expand/collapse action. The manual MCP live-check button should
  also keep `title` / `aria-label` aligned with its current state: use the
  check action while idle and the checking label while the request is in flight.
  The manual MCP live-check hint row should keep visible text compact, but
  expose the MCP source in `title` / `aria-label`, for example
  `MCP: Run a live check for enabled MCP servers.` or
  `MCP: No enabled MCP servers to check.`, so the helper sentence remains
  meaningful outside the expanded details context.
  Desktop MCP loading rows inside expanded details should mirror the small-screen
  composer MCP loading row: keep the visible loading text compact, but expose
  `MCP: Loading MCP configuration...` through both `title` and `aria-label` so
  transient loading text is not detached from the MCP details source.
  Desktop MCP empty rows should follow the same source-label rule: keep visible
  text as `No MCP servers configured`, but expose `MCP: No MCP servers
  configured` through both `title` and `aria-label` so empty configuration
  states are not read as generic standalone empty text.
  MCP server-row names are truncated in the compact desktop panel, so they
  should expose a target label such as `MCP server: filesystem` through both
  `title` and `aria-label` instead of leaving the tooltip as a bare server id.
  MCP server-row transport values are also compact protocol tokens, so expose
  server + transport context such as `MCP server transport: filesystem · stdio`
  through `title` / `aria-label` while keeping the visible value as `stdio`.
  MCP server-row status pills should include the server name in `aria-label` /
  `title` when practical, for example `filesystem: Online · 24ms` and
  `browser: Disabled`, so repeated short status pills stay meaningful outside
  their visual row context. For live-check result pills, use the same
  server + status + latency/message target label for both `title` and
  `aria-label`; do not leave the hover tooltip as a bare latency such as
  `24ms` when the accessible name already says `filesystem: Online · 24ms`.
  If the same latency is also shown as compact inline helper text in the server
  row, mark that inline copy `aria-hidden` so assistive technology reads the
  complete live-result pill once instead of repeating an unqualified `24ms`.
  MCP diagnostic error rows should keep the visible error text raw but expose
  the source and error category in `title` / `aria-label`, for example
  `MCP: Configuration error · Failed to load mcp.json` or
  `MCP: Live check failed · Request timed out`, because these truncated lines
  otherwise read as generic errors detached from the MCP details panel.
  The daemon reconnect control follows the same stateful action-label rule:
  when the button is disabled because a reconnect is already in flight, its
  `title` / `aria-label` should expose the reconnecting state rather than the
  idle reconnect action. Recent-edit overflow controls in the desktop
  `StatusPanel` should also keep visible text, `title`, and `aria-label`
  aligned with the current action: show the hidden-file count while collapsed
  and the return-to-recent action while expanded. Numeric-only current-activity
  count pills should expose the count's meaning through both `title` and
  `aria-label`, such as `Pending tools: 3` or `Failed tools: 1`, while the
  visible text may stay as a compact number.
  The current-activity active tool summary and detail rows should expose the
  tool type with the truncated value in `title` / `aria-label`, for example
  `Bash: npm run build` and `Bash: Running build verification`; the visible text
  may stay as the raw summary/detail to preserve scan density.
  The desktop `StatusPanel` daemon status value follows the same target-label
  rule: expose `Daemon: <status>` through `aria-label` while keeping the visible
  value compact and the diagnostic tooltip unchanged.
  Daemon diagnostic rows should keep the visible diagnostic/error text raw, but
  expose the daemon source and current state in `title` / `aria-label`, for
  example `Daemon: Daemon error · Error: node executable not found`; otherwise a
  truncated diagnostic reads as a generic error detached from the daemon status
  and recovery action.
  The current-message anchor card should follow the same label + value pattern:
  keep the visible anchor label raw, but expose `Current message: <anchor>` in
  `title` / `aria-label` so a long or truncated anchor remains meaningful
  outside the visual card header.
  Do not add destructive controls such as undo, discard all, or keep all to this
  composer strip without a separate design review.
  For large historical sessions, the strip should render from the visible-tail
  summary in normal browsing. If explicit full-history search restores
  task/subagent/edit triggers from earlier collapsed messages, that merge must
  remain page-owned and display-only; do not move full-history scanning into
  the first-paint render path or trigger it merely because the strip is mounted.
  Automatically loaded `windowed` histories should also skip the idle
  complete-status-summary pass; ordinary browsing should keep using the visible
  tail until the user makes an explicit full-history request. On the desktop
  `xl` breakpoint where the right `StatusPanel` is visible, the
  composer strip's expandable tasks/subagents/edits/MCP tabs should act as a
  small-screen fallback and carry `xl:hidden` so the same detail surfaces are
  not duplicated above the composer. The Git branch chip may remain visible on
  desktop because it is a lightweight send-context signal rather than another
  expandable status panel.
- Conditional classes are composed with template strings today. A `cn()` helper
  (clsx + tailwind-merge) exists at `src/utils/cn.ts` — prefer it for new
  components with conditional class logic.
- Icons come from `lucide-react`, sized with `w-*/h-*` (commonly `w-4 h-4`,
  `w-3.5 h-3.5`); spinners use `<Loader2 className="animate-spin" />`.

---

## Modals, Toasts, and Portals

- **Modals/overlays render through `createPortal(..., document.body)`.** Use the
  shared `ModalDialog` (`components/common/ModalDialog.tsx`) for confirm/alert
  dialogs rather than building new ones. It handles ESC-to-close, backdrop
  click, icon/type theming, and destructive styling.
- Modal-open state lives in the page (`useState`), often as an object carrying
  the target row: `useState<{ isOpen; id; name }>`.
- **Toasts**: call the module-level `showToast(message, type, duration?, onClick?)`
  imported from `components/common/ToastContainer`. `<ToastContainer/>` must be
  mounted once near the root. Do not build ad-hoc notification UI.
- Chat turn-stopped desktop notifications are the exception to in-app toast
  guidance: route completion / failure / abort notifications through
  `src/utils/desktopNotification.ts`. In Tauri desktop runtime it must call the
  native `chat_show_system_notification` command first so Windows notifications
  come from the OS, while WebView `Notification` remains only a browser/test
  fallback. Stores and components should not instantiate `Notification`
  directly.
- Tauri window dragging: top regions use `data-tauri-drag-region`; modals add a
  fixed drag strip so the window stays movable behind the overlay.
- **Dropdowns inside an `overflow-hidden` ancestor must portal out.** A menu
  positioned with `absolute` will be clipped by any ancestor that uses
  `overflow-hidden` (e.g. the composer `ContextBar` truncation row), so clicking
  the trigger toggles state but shows nothing. Render such menus through
  `createPortal(..., document.body)` with `position: fixed`, anchor them off the
  trigger's `getBoundingClientRect()`, and close them on outside `mousedown`
  (checking both the trigger ref and the portaled menu ref, since the menu is no
  longer a DOM descendant of the trigger) plus ESC. Component tests must query
  the portaled menu via `document.querySelector`, not the render container.

### Event-Driven Modal Pattern (Backend → Frontend)

For modals triggered by backend events (e.g., permission requests via Tauri
`app.emit()`), the pattern is:

1. **Store the request** in a Zustand store field (`pendingAskUserQuestion: Request | null`)
2. **Listen to the event** in the store's `init()` method and set the field
3. **Conditionally render the modal** in the page: `{pendingRequest && <Dialog ... />}`
4. **Clear the field** after user responds (in the store action that calls `invoke`)

Example (permission approval dialog):
```tsx
// Store (useChatStore.ts)
interface ChatState {
    pendingAskUserQuestion: AskUserQuestionRequest | null;
    answerAskUserQuestion: (requestId: string, answers: Record<string, string>) => Promise<void>;
}

init: async () => {
    const askUserUn = await listen<AskUserQuestionRequest>('permission://ask-user-question', (event) => {
        set({ pendingAskUserQuestion: event.payload });
    });
    // ...
}

answerAskUserQuestion: async (requestId, answers) => {
    await invoke('permission_respond_ask_user_question', { requestId, answers });
    set({ pendingAskUserQuestion: null });
}

// Page (ChatPage.tsx)
const { pendingAskUserQuestion, answerAskUserQuestion } = useChatStore();

return (
    <>
        {/* ... main content */}
        {pendingAskUserQuestion && (
            <AskUserQuestionDialog
                request={pendingAskUserQuestion}
                onAnswer={(answers) => answerAskUserQuestion(pendingAskUserQuestion.requestId, answers)}
            />
        )}
    </>
);

// Component (AskUserQuestionDialog.tsx)
export default function AskUserQuestionDialog({ request, onAnswer }: Props) {
    return createPortal(
        <>
            <div className="fixed top-0 left-0 right-0 h-8 z-[9998]" data-tauri-drag-region />
            <div className="fixed inset-0 bg-black/50 z-[9999] flex items-center justify-center">
                {/* modal content */}
            </div>
        </>,
        document.body
    );
}
```

This pattern keeps the modal globally accessible (can be shown from any page)
without coupling to page-local state.

For chat permission approvals, generic tool permissions are a separate modal
path from ask-user-question and plan approval. The backend emits
`permission://tool` for request files named `request-<sessionId>-<requestId>.json`;
the page must render a tool permission dialog and answer through
`permission_respond_tool`. Do not rely on a pending tool block alone for this
case: the daemon is blocked until the response file
`response-<sessionId>-<requestId>.json` is written. The dialog should show the
tool name, working directory, and a compact preview of important inputs such as
`command`, `file_path`, `path`, `url`, `pattern`, or `query`, with full JSON
available behind a details disclosure.

---

## Accessibility

Current state (document reality): a11y is partial.
- Interactive controls use real `<button>`/`<input>`/`<select>` elements.
- Icon-only buttons carry a `title` attribute (acts as a tooltip; some are
  Chinese-only literals rather than i18n keys — see Common Mistakes).
- Focus styles are kept on actionable buttons in `ModalDialog`
  (`focus:outline-none focus:ring-2`).

When adding components, at minimum: use semantic elements, give icon-only
buttons an accessible label (`title` or `aria-label`), and keep visible focus
states. Note that full WCAG compliance has not been verified for this project.

For chat tool blocks, any control that calls `openFile()` must expose both the
action and the target in `title` / `aria-label`, such as
`Open file: src/App.tsx`. This applies to header file targets and expanded
detail action buttons. Keep the visible button text short if needed, but do not
leave the accessible name as a generic `Open file` when the target path is known.
If the open-file control is nested inside an expandable tool-block header or
tool-group row, stop both click and keydown propagation on the inner control so
keyboard activation does not also toggle the parent container.
This propagation boundary also applies to open-file controls rendered inside
expanded group details, such as Search result file rows, because those controls
can still sit inside a keyboard-expandable group item subtree.
Use the same keydown boundary for compact composite tool rows, such as subagent
process file chips and tool-row targets, so future row-level keyboard handlers
cannot accidentally turn file opening into a second row action.
Status-panel recent edit tree rows use the same composite pattern: when a
keyboard-selectable file row contains an open-file button, the inner button must
stop both click and keydown propagation so opening the file does not also select
or reopen the central diff inspection row.
The recent edit diff inspection row itself must reuse the shared keyboard
activation helper rather than hand-writing `Enter` / Space checks, so its
custom `role="button"` behavior stays aligned with tool-block headers.
Expandable chat tool-block headers should also expose a stable action label in
`title` / `aria-label` when the visible title is only the tool name plus status
metadata. Prefer labels that combine the action and target summary, such as
`Toggle task details: Investigate chat rendering`, so screen-reader and tooltip
users know whether they are opening task, agent, or generic tool details without
having to infer the action from `aria-expanded` alone.
This applies to grouped tool headers as well: Bash, Read, Edit, and Search
group headers should label the group-level toggle with both the action and a
representative command, file path, edit target, or search query.
When a grouped tool header can represent a mixed execution state, do not rely
only on the colored status dot. Show a compact status-count summary in the
collapsed header, and include the same summary in the header toggle's
`title` / `aria-label` target when practical. For example, a Search group with
one completed item, one failed item, and one pending item should expose a
visible secondary summary like `Success · 1 Failed · 1 Pending` so users can
decide whether to expand the group without scanning every child row.
Grouped tool item rows should follow the same rule at row level. If a Bash,
Read, Edit, or Search group row is keyboard-expandable, its `title` /
`aria-label` should describe the row action and item target, such as
`Toggle command details: npm test` or `Toggle read details: src/App.tsx`,
rather than relying on `aria-expanded` and visible fragments alone.
  Read group compact summaries should mirror header primary/secondary summary
  text into `aria-label` when they already expose it through `title`. Row-level
  line badges such as `L11-30` must expose the file target too, for example
  `Read lines: src/App.tsx · L11-30`, and repeated status pills must use a target
  label such as `Read: src/App.tsx · Success` instead of a bare `Success`.
  Search group compact summaries follow the same rule. Header query and status
  summaries should mirror `title` into `aria-label`; row pattern chips should
  expose query context such as `Search query: useState`; row result-count
  summaries should expose the query target, for example
  `Search results for useState: 1 match · 1 file`; repeated row status pills
  should use `Search: useState · Success`; expanded result line chips such
  as `L12` should expose `Search result line: src/App.tsx · L12`; and expanded
  result rows should show a truncated match snippet when available while the row
  button exposes a combined action label such as
  `Open search result: src/App.tsx · L12 · const value`. In search result
  summaries, keep `fileCount` as the unique file count, but treat the expanded
  `files` collection as visible result rows. If one file has multiple distinct
  `path:line[:column]:snippet` matches, render those matches as separate
  open-file rows so users can jump directly to the relevant line instead of
  losing every match after the first file-level hit. When the expanded quick
  result list is capped, show a compact non-interactive footer with `title` and
  `aria-label`, such as `2 more results in raw output`, so users understand the
  visible rows are a shortcut list and can inspect the raw tool output for the
  remaining matches.
  Status-panel MCP summary containers follow the same target-label rule for
  non-action summary state. If the container exposes availability or configuration
  error details through `title`, mirror the same value into `aria-label` on that
container. Keep the inner MCP toggle button's `title` / `aria-label`
action-specific, such as `Expand MCP details` or `Collapse MCP details`, so the
state summary and the disclosure action remain distinct.

---

## Common Mistakes

- **Hardcoded Chinese strings.** Some `title`/toast text is a literal Chinese
  string instead of a `t('...')` key (e.g. `title="拖拽排序"`, `'启动终端失败'`).
  New user-facing text must go through i18n and be added to both `en.json` and
  `zh.json`.
- Forgetting `export default` on a page component, which breaks `React.lazy`.
- Putting feature-specific components in `common/` — keep `common/` for true
  primitives.
- Adding a one-off confirm dialog instead of reusing `ModalDialog`.
- Light-only styling with no `dark:` variant.
- Putting a long master list and its dependent detail list into the same
  scrolling sidebar. Users can select a master item and still not see the
  detail rows because they are pushed below the rest of the master list.
- Rendering batch edit tools as a single generic/edit card. Users lose the
  changed-file list for `MultiEdit`, filesystem `edit_file`, and `apply_patch`
  unless those payloads are expanded into per-file edit items first.
- Rendering uploaded image history as `[Image: name]` / `[图片: name]` text.
  That loses the actual visual attachment and makes anchors look blank. Preserve
  raw `image` / `input_image` blocks and render thumbnails instead.
- Letting user-uploaded thumbnails expand to full bubble width. User message
  images should render as compact, click-to-preview thumbnails in the transcript
  and only use the lightbox for the full-size image. If historical raw content
  contains base64 image payload fragments as adjacent `text` blocks, filter
  those fragments out before rendering, copying, or deriving message previews.
