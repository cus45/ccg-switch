# Directory Structure

> How frontend code is organized in this project.

---

## Overview

CC Switch is a Tauri 2 desktop app. The frontend is React 19 + TypeScript 5.8,
built with Vite 7. All frontend code lives under `src/`. The Rust backend lives
under `src-tauri/` and is reached exclusively through Tauri `invoke` calls (see
`state-management.md` and `hook-guidelines.md`).

Code is organized by **layer** at the top level (`pages`, `components`,
`stores`, `services`, `types`, `hooks`), and `components/` is further split by
**feature/domain**.

---

## Directory Layout

```
src/
├── App.tsx                 # Router definition (createHashRouter) + app-level warmup effects
├── main.tsx                # React root, mounts <App/> + <ToastContainer/>
├── i18n.ts                 # i18next init (zh/en)
├── App.css                 # Global app styles
├── pages/                  # Route-level page components (one per route)
│   ├── Dashboard.tsx
│   ├── ProvidersPage.tsx
│   └── ...
├── components/             # Reusable UI, grouped by feature
│   ├── common/             # Cross-feature primitives (ModalDialog, Toast, ThemeManager)
│   ├── layout/             # App shell (Layout, Navbar, Sidebar, Logo)
│   ├── providers/          # Provider feature components
│   ├── mcp/                # MCP feature components
│   ├── proxy/              # Proxy feature components
│   ├── dashboard/          # Dashboard cards (home shows only OverviewKpiRow)
│   ├── usage/              # Usage charts/tables (proxy logs)
│   │   └── session/        # Local-session stats (/usage?tab=session), moved from Dashboard
│   └── settings/           # Settings panels (+ settings/about/ subfolder)
├── stores/                 # Zustand state stores (useXStore.ts)
├── services/               # Thin wrappers over Tauri invoke (xService.ts)
├── hooks/                  # Custom React hooks (useXxx.ts)
├── types/                  # Shared TypeScript types (one file per domain)
├── config/                 # Static config data (e.g. mcpPresets.ts)
├── locales/                # i18n translation JSON (en.json, zh.json)
├── utils/                  # Pure helpers (cn.ts)
└── assets/                 # Bundled images/icons
```

---

## Module Organization

- **A new feature** typically touches several layers: a route page in `pages/`,
  feature components in `components/<feature>/`, a Zustand store in `stores/`,
  a service in `services/` (if it calls the backend), and types in `types/`.
- **Pages** are route-level and registered in `App.tsx`. They compose feature
  components and own page-local UI state (filters, view mode, open modals).
- **Feature components** live in `components/<feature>/`. When a feature has an
  "about"-style sub-area, a nested folder is used (e.g.
  `components/settings/about/`).
- **`common/` is for primitives reused across features only.** Do not put
  feature-specific components there.

---

## Naming Conventions

| Kind | Convention | Example |
|------|-----------|---------|
| Page component file | PascalCase, usually `XxxPage.tsx` (Dashboard/Settings are bare) | `ProvidersPage.tsx`, `Dashboard.tsx` |
| Component file | PascalCase | `ProviderCard.tsx`, `ModalDialog.tsx` |
| Store file | `useXStore.ts` | `useProviderStore.ts` |
| Service file | `xService.ts` (camelCase) | `configService.ts`, `mcpService.ts` |
| Hook file | `useXxx.ts` | `useHealthCheck.ts` |
| Type file | lowercase domain noun | `provider.ts`, `app.ts` |

- **Page components are exported as `default`** (required for `React.lazy`).
  Most components export `default`; small utilities/primitives may use named
  exports (e.g. `showToast` from `ToastContainer.tsx`).
- A `V2` suffix marks a newer parallel implementation kept alongside the legacy
  one during migration (e.g. `useMcpStoreV2.ts`, `useSkillStoreV2.ts`,
  `types/mcpV2.ts`). When both exist, prefer the V2 version for new work and
  check which one the target page imports before editing.

---

## Examples

- Well-structured feature: **Providers** —
  `pages/ProvidersPage.tsx` (route + page state) →
  `components/providers/ProviderCard.tsx` / `ProviderForm.tsx` (UI) →
  `stores/useProviderStore.ts` (state + backend calls) →
  `hooks/useHealthCheck.ts` (local async hook) →
  `types/provider.ts` (types).
- Routing entry point: `src/App.tsx` (`createHashRouter`, lazy-loaded pages).
- Cross-feature primitive: `src/components/common/ModalDialog.tsx`.
