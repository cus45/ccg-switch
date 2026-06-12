# 前端目录结构规范

## 概述

本项目采用 React 19 + TypeScript 5.8 + Vite 7 构建前端，使用约定式目录结构组织代码。

---

## 顶层目录结构

```
src/
├── App.tsx                   # 路由定义 (react-router-dom v7, HashRouter)
├── main.tsx                  # 应用入口
├── i18n.ts                   # 国际化配置
├── vite-env.d.ts            # Vite 类型声明
├── pages/                    # 页面组件（路由级别）
├── components/               # UI 组件（可复用）
├── stores/                   # Zustand 全局状态
├── services/                 # 前端服务层（Tauri 命令封装）
├── hooks/                    # 自定义 React Hooks
├── types/                    # TypeScript 类型定义
├── locales/                  # i18n 翻译文件
├── config/                   # 配置文件
└── utils/                    # 工具函数
```

---

## 分层职责

### 1. `pages/` — 页面组件

**职责**: 路由级别的页面容器，负责页面布局和数据编排。

**命名规范**: PascalCase + `Page` 后缀（可选）。

**示例**:
```
src/pages/
├── Dashboard.tsx           # 仪表盘页面
├── ClaudePage.tsx         # Claude Provider 管理
├── ProxyPage.tsx          # 代理配置
├── Settings.tsx           # 设置页面
└── UsagePage.tsx          # Token 用量统计
```

**实际代码示例** (`src/pages/Dashboard.tsx:155-176`):
```tsx
function Dashboard() {
    const { t } = useTranslation();
    const { stats, activity, tokenStats, hasLoaded, loading, loadData } = useDashboardStore();

    useEffect(() => {
        if (!hasLoaded) {
            void loadData();
        }
    }, [hasLoaded, loadData]);

    return (
        <div className="h-full w-full overflow-y-auto">
            <div className="p-6 space-y-6 max-w-7xl mx-auto">
                <h1 className="text-2xl font-bold">
                    {t('dashboard.welcome')}
                </h1>
            </div>
        </div>
    );
}
```

**页面容器规范**:
- 最外层容器使用 `h-full w-full overflow-y-auto`
- 内容区域使用 `p-6 space-y-* max-w-7xl mx-auto`

---

### 2. `components/` — UI 组件

**职责**: 可复用的 UI 组件，按功能领域分组。

**组织方式**: 按领域分类 + 通用组件独立。

**目录结构**:
```
src/components/
├── common/                 # 通用组件（跨领域复用）
│   ├── ModalDialog.tsx
│   ├── Toast.tsx
│   └── ThemeManager.tsx
├── layout/                 # 布局组件
│   ├── Layout.tsx
│   ├── Navbar.tsx
│   └── Sidebar.tsx
├── providers/              # Provider 管理相关
│   ├── ProviderCard.tsx
│   ├── ProviderForm.tsx
│   └── HealthStatusBadge.tsx
├── dashboard/              # 仪表盘组件
├── settings/               # 设置页面组件
│   └── about/             # 子领域进一步嵌套
│       ├── InstallCommandPanel.tsx
│       └── ToolStatusGrid.tsx
└── ...                     # 其他领域
```

**命名规范**:
- 组件文件名: PascalCase（`ProviderCard.tsx`）
- 领域文件夹: camelCase 或 kebab-case（`providers/`, `settings/`）

**实际代码示例** (`src/components/providers/ProviderCard.tsx:30-58`):
```tsx
export default function ProviderCard({
    provider,
    onSwitch,
    onEdit,
    healthStatus,
}: ProviderCardProps) {
    const { t } = useTranslation();
    const [showKey, setShowKey] = useState(false);

    return (
        <div
            className={`bg-white dark:bg-base-100 rounded-xl shadow-sm border ${
                provider.isActive
                    ? 'border-green-400 ring-1 ring-green-200'
                    : 'border-gray-100 dark:border-base-200'
            }`}
        >
            {/* 组件内容 */}
        </div>
    );
}
```

---

### 3. `stores/` — 全局状态

**职责**: Zustand 状态管理，每个领域一个 Store。

**命名规范**: `useXStore.ts`（X 为领域名）。

**示例**:
```
src/stores/
├── useConfigStore.ts       # 应用配置（主题、语言）
├── useTokenStore.ts        # API Token 管理
├── useProviderStore.ts     # Provider 管理
├── useDashboardStore.ts    # 仪表盘数据
└── ...
```

**实际代码示例** (`src/stores/useProviderStore.ts:8-30`):
```tsx
interface ProviderState {
    providers: Provider[];
    hasLoaded: boolean;
    loading: boolean;
    error: string | null;

    loadProviders: (app: AppType, force?: boolean) => Promise<void>;
    addProvider: (data: Omit<Provider, 'id' | 'createdAt'>) => Promise<void>;
    updateProvider: (id: string, data: Partial<Provider>) => Promise<void>;
}

export const useProviderStore = create<ProviderState>((set, get) => ({
    providers: [],
    hasLoaded: false,
    loading: false,
    error: null,
    // ... 方法实现
}));
```

---

### 4. `services/` — 服务层

**职责**: 封装 Tauri 命令调用，提供类型安全的 API 抽象。

**命名规范**: `*Service.ts`。

**示例**:
```
src/services/
├── configService.ts        # 配置服务
├── mcpService.ts          # MCP 服务
├── promptService.ts       # Prompt 管理
└── ...
```

---

### 5. `types/` — 类型定义

**职责**: 共享 TypeScript 类型，与后端模型保持一致。

**命名规范**: `*.ts`（不是 `.d.ts`）。

**示例**:
```
src/types/
├── provider.ts            # Provider 类型
├── token.ts              # ApiToken 类型
├── config.ts             # 配置类型
└── ...
```

---

### 6. `locales/` — 国际化

**规范**: 
- 必须同时维护 `zh.json` 和 `en.json`
- 使用嵌套 JSON 结构组织翻译键

---

## 文件导出规范

### 页面组件
- **导出方式**: `default export`
- **原因**: react-router-dom v7 路由配置需要 default export

**示例**:
```tsx
export default Dashboard;
```

### Store
- **导出方式**: `named export`
- **命名**: `export const useXStore = create<XState>(...)`

---

## 路径别名

**当前状态**: 未配置路径别名，使用相对路径导入。

**示例**:
```tsx
// ✅ 当前实践
import { useProviderStore } from '../../stores/useProviderStore';
import { Provider } from '../../types/provider';
```

---

## 常见错误

### ❌ 错误：页面组件放在 `components/` 下
```
components/
└── DashboardPage.tsx  // ❌ 应该在 pages/
```

### ✅ 正确：页面组件放在 `pages/` 下
```
pages/
└── Dashboard.tsx      // ✅
```

---

### ❌ 错误：Store 命名不规范
```typescript
// ❌ 缺少 "use" 前缀
export const providerStore = create(...);
```

### ✅ 正确：Store 命名规范
```typescript
// ✅
export const useProviderStore = create<ProviderState>(...);
```

---

## 何时创建新的子目录

- **3+ 个相关组件** → 创建独立子目录
- **嵌套超过 2 层** → 考虑拆分成独立领域
- **跨领域复用** → 移到 `components/common/`

**示例**: `settings/about/` 子目录包含 3+ 个关于面板的子组件。
