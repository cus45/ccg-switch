# 自定义 Hooks 规范

## 概述

本项目使用 React 19 内置 Hooks + 自定义 Hooks 封装可复用的状态逻辑。

---

## 命名约定

### 规则

**所有 Hook 必须以 `use` 开头**（React 官方约定）。

**文件命名**: `use*.ts`（小驼峰 camelCase）

**示例**:
```
src/hooks/
├── useHealthCheck.ts       # Provider 健康检查
├── useVisibleAppOptions.ts # 可见应用选项过滤
└── ...
```

---

## 自定义 Hook 模式

### 1. 基础结构

```typescript
import { useState, useCallback } from 'react';

interface UseXxxOptions {
    // 可选配置
}

export function useXxx(options?: UseXxxOptions) {
    // 1. 内部状态
    const [data, setData] = useState<T | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    
    // 2. 方法定义
    const fetchData = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const result = await someAsyncOperation();
            setData(result);
        } catch (err) {
            setError(String(err));
        } finally {
            setLoading(false);
        }
    }, [/* dependencies */]);
    
    // 3. 返回值
    return {
        data,
        loading,
        error,
        fetchData,
    };
}
```

---

## 实际 Hook 示例

### useHealthCheck Hook

**功能**: Provider 健康检查，支持单个和批量检查。

**完整代码** (`src/hooks/useHealthCheck.ts:22-97`):
```typescript
export type HealthState = 'idle' | 'checking' | 'operational' | 'degraded' | 'failed';

export interface HealthStatus {
    state: HealthState;
    latencyMs?: number;
    error?: string;
    lastChecked?: number;
}

export function useHealthCheck() {
    const [statuses, setStatuses] = useState<Record<string, HealthStatus>>({});

    // 单个检查
    const checkSingle = useCallback(async (providerId: string) => {
        setStatuses(prev => ({
            ...prev,
            [providerId]: { state: 'checking' }
        }));

        try {
            const result = await invoke<ProviderHealthResult>('check_provider_health', { providerId });

            const state: HealthState = result.available
                ? (result.latencyMs > 5000 ? 'degraded' : 'operational')
                : 'failed';

            setStatuses(prev => ({
                ...prev,
                [providerId]: {
                    state,
                    latencyMs: result.latencyMs,
                    error: result.error || undefined,
                    lastChecked: Date.now(),
                }
            }));
        } catch (err) {
            setStatuses(prev => ({
                ...prev,
                [providerId]: {
                    state: 'failed',
                    error: String(err),
                    lastChecked: Date.now(),
                }
            }));
        }
    }, []);

    // 批量检查（并发控制）
    const checkBatch = useCallback(async (providerIds: string[], concurrency = 5) => {
        setStatuses(prev => {
            const next = { ...prev };
            for (const id of providerIds) {
                next[id] = { state: 'checking' };
            }
            return next;
        });

        const queue = [...providerIds];
        let running = 0;

        await new Promise<void>((resolve) => {
            const runNext = () => {
                if (queue.length === 0 && running === 0) {
                    resolve();
                    return;
                }
                while (running < concurrency && queue.length > 0) {
                    const id = queue.shift()!;
                    running++;
                    checkSingle(id).finally(() => {
                        running--;
                        runNext();
                    });
                }
            };
            runNext();
        });
    }, [checkSingle]);

    const isAnyChecking = Object.values(statuses).some(s => s.state === 'checking');

    const clearAll = useCallback(() => {
        setStatuses({});
    }, []);

    return { statuses, checkSingle, checkBatch, isAnyChecking, clearAll };
}
```

**使用示例**:
```tsx
function ProviderList() {
    const { statuses, checkSingle, isAnyChecking } = useHealthCheck();
    
    const handleCheck = (providerId: string) => {
        void checkSingle(providerId);
    };
    
    return (
        <div>
            {providers.map(p => (
                <ProviderCard
                    key={p.id}
                    provider={p}
                    healthStatus={statuses[p.id]}
                    onHealthCheck={handleCheck}
                />
            ))}
        </div>
    );
}
```

---

## Hook 返回值模式

### 1. 返回对象（推荐）

**优点**: 清晰、可扩展、支持解构重命名。

```typescript
export function useHealthCheck() {
    return {
        statuses,
        checkSingle,
        checkBatch,
        isAnyChecking,
        clearAll,
    };
}

// 使用
const { statuses, checkSingle } = useHealthCheck();
const { statuses: providerStatuses } = useHealthCheck();  // 重命名
```

---

### 2. 返回数组（不推荐）

**缺点**: 顺序依赖、语义不清晰。

```typescript
// ❌ 不推荐
export function useHealthCheck() {
    return [statuses, checkSingle, checkBatch];
}

// 使用时需要记住顺序
const [statuses, checkSingle, checkBatch] = useHealthCheck();
```

---

## 常见 Hook 模式

### 1. 异步操作 Hook

```typescript
export function useAsyncOperation() {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    
    const execute = useCallback(async (fn: () => Promise<void>) => {
        setLoading(true);
        setError(null);
        try {
            await fn();
        } catch (err) {
            setError(String(err));
        } finally {
            setLoading(false);
        }
    }, []);
    
    return { loading, error, execute };
}
```

---

### 2. 本地存储 Hook

```typescript
export function useLocalStorage<T>(key: string, initialValue: T) {
    const [value, setValue] = useState<T>(() => {
        try {
            const item = localStorage.getItem(key);
            return item ? JSON.parse(item) : initialValue;
        } catch {
            return initialValue;
        }
    });
    
    const setStoredValue = useCallback((newValue: T) => {
        setValue(newValue);
        localStorage.setItem(key, JSON.stringify(newValue));
    }, [key]);
    
    return [value, setStoredValue] as const;
}
```

---

### 3. 防抖 Hook

```typescript
export function useDebounce<T>(value: T, delay: number): T {
    const [debouncedValue, setDebouncedValue] = useState(value);
    
    useEffect(() => {
        const timer = setTimeout(() => {
            setDebouncedValue(value);
        }, delay);
        
        return () => clearTimeout(timer);
    }, [value, delay]);
    
    return debouncedValue;
}

// 使用
function SearchInput() {
    const [searchTerm, setSearchTerm] = useState('');
    const debouncedSearch = useDebounce(searchTerm, 500);
    
    useEffect(() => {
        if (debouncedSearch) {
            performSearch(debouncedSearch);
        }
    }, [debouncedSearch]);
}
```

---

### 4. 窗口大小 Hook

```typescript
export function useWindowSize() {
    const [size, setSize] = useState({
        width: window.innerWidth,
        height: window.innerHeight,
    });
    
    useEffect(() => {
        const handleResize = () => {
            setSize({
                width: window.innerWidth,
                height: window.innerHeight,
            });
        };
        
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);
    
    return size;
}
```

---

## 数据获取模式

### 当前实践：Zustand Store

**本项目不使用 React Query / SWR**，数据获取通过 Zustand Store 管理。

**模式**:
```typescript
// Store 负责数据获取
export const useProviderStore = create<ProviderState>((set, get) => ({
    providers: [],
    hasLoaded: false,
    loading: false,
    
    loadProviders: async (force = false) => {
        if (!force && get().hasLoaded) return;
        set({ loading: true });
        const providers = await invoke<Provider[]>('get_providers');
        set({ providers, loading: false, hasLoaded: true });
    },
}));

// 页面直接使用 Store
function ProviderPage() {
    const { providers, loading, loadProviders } = useProviderStore();
    
    useEffect(() => {
        void loadProviders();
    }, [loadProviders]);
    
    return <div>{/* ... */}</div>;
}
```

---

## 依赖数组规则

### 1. useEffect / useCallback 依赖

**规则**: 所有使用的外部变量必须包含在依赖数组中。

```typescript
// ✅ 正确：包含所有依赖
const fetchData = useCallback(async (id: string) => {
    const result = await invoke('get_data', { id, userId });
}, [userId]);  // userId 是外部变量

useEffect(() => {
    void fetchData(selectedId);
}, [fetchData, selectedId]);  // 包含 fetchData 和 selectedId

// ❌ 错误：遗漏依赖
const fetchData = useCallback(async (id: string) => {
    const result = await invoke('get_data', { id, userId });
}, []);  // ❌ 缺少 userId
```

---

### 2. 空依赖数组

**使用场景**: 仅在组件挂载时执行一次。

```typescript
// ✅ 正确：初始化逻辑
useEffect(() => {
    void loadInitialData();
}, []);  // 仅挂载时执行
```

---

## useCallback vs useMemo

### useCallback - 缓存函数

```typescript
const handleClick = useCallback(() => {
    console.log('clicked');
}, []);

// 等价于
const handleClickMemo = useMemo(() => {
    return () => console.log('clicked');
}, []);
```

---

### useMemo - 缓存计算结果

```typescript
const expensiveValue = useMemo(() => {
    return computeExpensiveValue(a, b);
}, [a, b]);
```

---

## 常见错误

### ❌ 错误：Hook 命名不规范
```typescript
// ❌ 错误：缺少 "use" 前缀
export function healthCheck() {
    const [status, setStatus] = useState('idle');
    // ...
}
```

### ✅ 正确：Hook 命名规范
```typescript
// ✅ 正确
export function useHealthCheck() {
    const [status, setStatus] = useState('idle');
    // ...
}
```

---

### ❌ 错误：在条件语句中调用 Hook
```typescript
// ❌ 错误：违反 Hook 规则
function Component({ shouldFetch }: Props) {
    if (shouldFetch) {
        const data = useFetchData();  // ❌ 条件调用
    }
}
```

### ✅ 正确：Hook 在顶层调用
```typescript
// ✅ 正确
function Component({ shouldFetch }: Props) {
    const { data, fetch } = useFetchData();
    
    useEffect(() => {
        if (shouldFetch) {
            void fetch();
        }
    }, [shouldFetch, fetch]);
}
```

---

### ❌ 错误：遗漏依赖
```typescript
// ❌ 错误
const fetchData = useCallback(async () => {
    const result = await invoke('get_data', { userId });
}, []);  // ❌ 缺少 userId
```

### ✅ 正确：包含所有依赖
```typescript
// ✅ 正确
const fetchData = useCallback(async () => {
    const result = await invoke('get_data', { userId });
}, [userId]);  // ✅ 包含 userId
```

---

### ❌ 错误：在 Hook 中直接修改状态
```typescript
// ❌ 错误
export function useCounter() {
    const [count, setCount] = useState(0);
    
    const increment = () => {
        count++;  // ❌ 直接修改
        setCount(count);
    };
}
```

### ✅ 正确：使用函数式更新
```typescript
// ✅ 正确
export function useCounter() {
    const [count, setCount] = useState(0);
    
    const increment = useCallback(() => {
        setCount(prev => prev + 1);  // ✅ 函数式更新
    }, []);
}
```

---

## 何时创建自定义 Hook

### 决策树

```
逻辑是否需要在多个组件中复用？
├─ 否 → 保持在组件内
└─ 是 → 是否包含 React 状态/副作用？
    ├─ 是 → 创建自定义 Hook
    └─ 否 → 创建普通工具函数（放在 utils/）
```

---

### 示例对比

#### 场景：API 调用封装

```typescript
// ❌ 不需要 Hook：纯函数
export function fetchProviders() {
    return invoke<Provider[]>('get_providers');
}

// ✅ 需要 Hook：包含状态管理
export function useProviders() {
    const [providers, setProviders] = useState<Provider[]>([]);
    const [loading, setLoading] = useState(false);
    
    const fetch = useCallback(async () => {
        setLoading(true);
        const data = await invoke<Provider[]>('get_providers');
        setProviders(data);
        setLoading(false);
    }, []);
    
    return { providers, loading, fetch };
}
```

---

## 性能优化

### 1. 避免不必要的重新计算

```typescript
// ✅ 使用 useMemo 缓存昂贵计算
const sortedProviders = useMemo(() => {
    return providers.sort((a, b) => a.name.localeCompare(b.name));
}, [providers]);
```

---

### 2. 避免不必要的重新创建函数

```typescript
// ✅ 使用 useCallback 缓存回调
const handleClick = useCallback(() => {
    console.log(selectedId);
}, [selectedId]);
```

---

### 3. 分离频繁更新的状态

```typescript
// ❌ 问题：input 更新会触发整个组件重渲染
function SearchForm() {
    const [searchTerm, setSearchTerm] = useState('');
    const [results, setResults] = useState([]);
    // 每次输入都重渲染
}

// ✅ 优化：拆分成子组件
function SearchForm() {
    const [results, setResults] = useState([]);
    return (
        <>
            <SearchInput onSearch={setResults} />
            <ResultList results={results} />
        </>
    );
}
```

---

## 参考

- React 版本: 19
- Hook 实现示例: `src/hooks/useHealthCheck.ts`
- React Hooks 官方文档: https://react.dev/reference/react
