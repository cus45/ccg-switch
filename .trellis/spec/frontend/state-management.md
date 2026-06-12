# 状态管理规范

## 概述

本项目使用 **Zustand 5** 作为全局状态管理方案，配合 React 19 内置 Hooks（`useState`, `useEffect`）管理本地状态。

---

## 状态分类

### 1. 本地状态 (Local State)

**定义**: 仅在单个组件内使用的状态。

**工具**: `useState`, `useReducer`

**适用场景**:
- UI 交互状态（展开/收起、选中项、输入值）
- 临时表单数据
- 组件内部的 loading/error 状态

**实际示例** (`src/components/providers/ProviderCard.tsx:44`):
```tsx
export default function ProviderCard({ provider }: ProviderCardProps) {
    const [showKey, setShowKey] = useState(false);  // 仅组件内使用
    
    return (
        <div>
            <code>{showKey ? provider.apiKey : maskApiKey(provider.apiKey)}</code>
            <button onClick={() => setShowKey(!showKey)}>
                {showKey ? <EyeOff /> : <Eye />}
            </button>
        </div>
    );
}
```

---

### 2. 全局状态 (Global State)

**定义**: 跨组件共享的状态。

**工具**: Zustand 5

**适用场景**:
- 用户配置（主题、语言）
- 业务数据（Provider 列表、Token 列表）
- 应用级 UI 状态（Toast 通知）

**实际示例** (`src/stores/useProviderStore.ts:8-21`):
```tsx
interface ProviderState {
    providers: Provider[];
    hasLoaded: boolean;
    loading: boolean;
    error: string | null;

    loadProviders: (app: AppType, force?: boolean) => Promise<void>;
    addProvider: (data: Omit<Provider, 'id' | 'createdAt'>) => Promise<void>;
    updateProvider: (id: string, data: Partial<Provider>) => Promise<void>;
    deleteProvider: (providerId: string) => Promise<void>;
}

export const useProviderStore = create<ProviderState>((set, get) => ({
    providers: [],
    hasLoaded: false,
    loading: false,
    error: null,
    // ...
}));
```

---

### 3. 服务端状态 (Server State)

**定义**: 从后端（Tauri 命令）获取的数据。

**管理方式**: 
- 在 Zustand Store 中管理
- 配合 `hasLoaded` 标志避免重复加载
- 使用 `loading` 和 `error` 追踪异步状态

**实际示例** (`src/stores/useProviderStore.ts:31-40`):
```tsx
loadProviders: async (app, force = false) => {
    if (!force && get().hasLoaded) return;  // 避免重复加载
    set({ loading: true, error: null });
    try {
        const providers = await invoke<Provider[]>('get_providers', { app });
        set({ providers, loading: false, hasLoaded: true });
    } catch (error) {
        set({ error: String(error), loading: false });
    }
},
```

---

## Zustand Store 模式

### Store 文件结构

```tsx
// 1. 导入依赖
import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { Provider } from '../types/provider';

// 2. State 接口定义
interface ProviderState {
    // 数据
    providers: Provider[];
    
    // 状态标志
    hasLoaded: boolean;
    loading: boolean;
    error: string | null;
    
    // 方法（异步操作）
    loadProviders: (force?: boolean) => Promise<void>;
    addProvider: (data: Omit<Provider, 'id'>) => Promise<void>;
}

// 3. Store 创建
export const useProviderStore = create<ProviderState>((set, get) => ({
    // 初始状态
    providers: [],
    hasLoaded: false,
    loading: false,
    error: null,
    
    // 方法实现
    loadProviders: async (force = false) => {
        if (!force && get().hasLoaded) return;
        set({ loading: true, error: null });
        try {
            const providers = await invoke<Provider[]>('get_providers');
            set({ providers, loading: false, hasLoaded: true });
        } catch (error) {
            set({ error: String(error), loading: false });
        }
    },
    
    addProvider: async (data) => {
        set({ loading: true, error: null });
        try {
            await invoke('add_provider', { provider: data });
            await get().loadProviders(true);  // 重新加载
        } catch (error) {
            set({ error: String(error), loading: false });
            throw error;  // 让调用方处理错误
        }
    },
}));
```

---

## Store 命名约定

### 文件命名

**模式**: `use{Domain}Store.ts`

**示例**:
```
src/stores/
├── useConfigStore.ts       # 应用配置
├── useProviderStore.ts     # Provider 管理
├── useTokenStore.ts        # Token 管理
├── useDashboardStore.ts    # 仪表盘数据
├── useMcpStoreV2.ts       # MCP 服务器（v2 版本）
└── useProxyStore.ts        # 代理配置
```

---

### Store 导出

**规则**: 使用 named export，不使用 default export。

```tsx
// ✅ 正确：named export
export const useProviderStore = create<ProviderState>(...);

// ❌ 错误：default export
export default create<ProviderState>(...);
```

---

## 何时使用全局状态

### 决策树

```
数据是否需要跨组件共享？
├─ 否 → 本地状态 (useState)
└─ 是 → 是否涉及服务端数据？
    ├─ 是 → Zustand Store + Tauri 命令
    └─ 否 → 考虑是否真的需要全局
        ├─ 确实需要 → Zustand Store
        └─ 可以通过 Props 传递 → 本地状态 + Props drilling
```

---

### 示例对比

#### ❌ 过度使用全局状态
```tsx
// 不需要：仅在一个组件使用的状态
const useModalStore = create((set) => ({
    isOpen: false,
    setIsOpen: (open: boolean) => set({ isOpen: open }),
}));
```

#### ✅ 合理使用全局状态
```tsx
// 需要：跨页面共享的配置数据
const useConfigStore = create((set) => ({
    theme: 'light',
    language: 'zh',
    setTheme: (theme: string) => set({ theme }),
    setLanguage: (lang: string) => set({ language: lang }),
}));
```

---

## 异步状态管理

### 标准模式

所有 Zustand Store 的异步方法遵循以下模式：

```tsx
interface State {
    data: T[];
    hasLoaded: boolean;  // 是否已加载过
    loading: boolean;    // 是否正在加载
    error: string | null; // 错误信息
}

// 加载数据
loadData: async (force = false) => {
    // 1. 避免重复加载
    if (!force && get().hasLoaded) return;
    
    // 2. 设置 loading 状态
    set({ loading: true, error: null });
    
    try {
        // 3. 调用 Tauri 命令
        const data = await invoke<T[]>('get_data');
        
        // 4. 成功：更新数据
        set({ data, loading: false, hasLoaded: true });
    } catch (error) {
        // 5. 失败：设置错误
        set({ error: String(error), loading: false });
    }
},

// 修改数据
updateData: async (id: string, updates: Partial<T>) => {
    set({ loading: true, error: null });
    try {
        await invoke('update_data', { id, updates });
        
        // 重新加载最新数据
        await get().loadData(true);
    } catch (error) {
        set({ error: String(error), loading: false });
        throw error;  // 让 UI 层处理错误（显示 Toast）
    }
},
```

---

### 实际应用示例

**在页面中使用** (`src/pages/Dashboard.tsx:19-26`):
```tsx
function Dashboard() {
    const { stats, hasLoaded, loading, loadData } = useDashboardStore();

    useEffect(() => {
        if (!hasLoaded) {
            void loadData();
        }
    }, [hasLoaded, loadData]);

    if (loading) return <LoadingSpinner />;
    if (!stats) return null;

    return <div>{stats.num_startups}</div>;
}
```

---

## 派生状态 (Derived State)

### 规则

**不要在 Store 中存储可计算的状态，使用 `useMemo` 或直接计算。**

#### ❌ 错误：在 Store 中存储派生状态
```tsx
const useProviderStore = create((set) => ({
    providers: [],
    activeProvider: null,  // ❌ 可以从 providers 派生
    
    setProviders: (providers) => {
        const active = providers.find(p => p.isActive);
        set({ providers, activeProvider: active });
    },
}));
```

#### ✅ 正确：在组件中计算派生状态
```tsx
const useProviderStore = create((set) => ({
    providers: [],
    setProviders: (providers) => set({ providers }),
}));

// 在组件中
function ProviderList() {
    const providers = useProviderStore(state => state.providers);
    const activeProvider = useMemo(
        () => providers.find(p => p.isActive),
        [providers]
    );
    // ...
}
```

---

### 实际示例 (`src/pages/Dashboard.tsx:32-46`)

```tsx
function Dashboard() {
    const { tokenStats } = useDashboardStore();
    
    // 派生状态：通过 useMemo 计算
    const modelEntries = useMemo(
        () => tokenStats ? Object.entries(tokenStats.modelUsage) : [],
        [tokenStats]
    );
    
    const totalTokens = useMemo(
        () => modelEntries.reduce((sum, [, u]) => sum + u.inputTokens + u.outputTokens, 0),
        [modelEntries]
    );
    
    const topModels = useMemo(
        () => [...modelEntries]
            .sort(([, a], [, b]) => (b.inputTokens + b.outputTokens) - (a.inputTokens + a.outputTokens))
            .slice(0, 10),
        [modelEntries]
    );
    
    return <div>Top Model: {topModels[0]}</div>;
}
```

---

## Store 选择器 (Selectors)

### 基础用法

```tsx
// ✅ 推荐：选择需要的字段
const providers = useProviderStore(state => state.providers);
const loading = useProviderStore(state => state.loading);

// ⚠️ 可以但不推荐：解构整个 Store（会导致不必要的重渲染）
const { providers, loading, error } = useProviderStore();
```

---

### 优化渲染

```tsx
// ❌ 问题：任何字段变化都会触发重渲染
function ProviderCount() {
    const { providers, loading, error } = useProviderStore();
    return <div>{providers.length}</div>;
}

// ✅ 优化：仅订阅需要的字段
function ProviderCount() {
    const count = useProviderStore(state => state.providers.length);
    return <div>{count}</div>;
}
```

---

## 常见错误

### ❌ 错误：忘记 `hasLoaded` 标志
```tsx
loadProviders: async () => {
    set({ loading: true });
    const providers = await invoke<Provider[]>('get_providers');
    set({ providers, loading: false });
    // ❌ 每次组件重新加载都会重新请求
},
```

### ✅ 正确：使用 `hasLoaded` + `force` 参数
```tsx
loadProviders: async (force = false) => {
    if (!force && get().hasLoaded) return;  // ✅ 避免重复加载
    set({ loading: true, error: null });
    try {
        const providers = await invoke<Provider[]>('get_providers');
        set({ providers, loading: false, hasLoaded: true });
    } catch (error) {
        set({ error: String(error), loading: false });
    }
},
```

---

### ❌ 错误：直接修改状态
```tsx
const useProviderStore = create((set, get) => ({
    providers: [],
    
    addProvider: (provider: Provider) => {
        get().providers.push(provider);  // ❌ 直接修改数组
    },
}));
```

### ✅ 正确：使用 `set` 更新状态
```tsx
const useProviderStore = create((set, get) => ({
    providers: [],
    
    addProvider: (provider: Provider) => {
        set({ providers: [...get().providers, provider] });  // ✅ 创建新数组
    },
}));
```

---

### ❌ 错误：在 Store 中存储派生状态
```tsx
const useTokenStore = create((set) => ({
    tokens: [],
    activeToken: null,  // ❌ 可以从 tokens 派生
}));
```

### ✅ 正确：在组件中计算派生状态
```tsx
const useTokenStore = create((set) => ({
    tokens: [],
}));

// 在组件中
const activeToken = useMemo(
    () => tokens.find(t => t.isActive),
    [tokens]
);
```

---

## 兼容层说明

### useTokenStore (兼容层)

**背景**: `useTokenStore` 是历史遗留的 Store，逻辑与 `useProviderStore` 重复。

**当前状态** (`src/stores/useTokenStore.ts:1-2`):
```tsx
// 兼容层：保留旧 API，内部逻辑不变。后续将逐步迁移到 useProviderStore
import { create } from 'zustand';
```

**迁移策略**:
- 新功能使用 `useProviderStore`
- 旧代码保持不变（避免破坏性修改）
- 逐步重构旧页面切换到 `useProviderStore`

---

## 参考

- 状态库: Zustand 5
- 完整技术栈: 见 `CLAUDE.md` 第 4-18 行
- Store 示例: `src/stores/useProviderStore.ts`
