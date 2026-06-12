# TypeScript 类型安全规范

## 概述

本项目使用 **TypeScript 5.8**，启用严格模式（`strict: true`），确保类型安全。

---

## TypeScript 配置

### tsconfig.json 关键配置

**实际配置** (`tsconfig.json:18-21`):
```json
{
  "compilerOptions": {
    "strict": true,                      // 启用所有严格检查
    "noUnusedLocals": true,             // 禁止未使用的局部变量
    "noUnusedParameters": true,         // 禁止未使用的参数
    "noFallthroughCasesInSwitch": true  // 禁止 switch 穿透
  }
}
```

**严格模式包含**:
- `noImplicitAny`: 禁止隐式 any
- `strictNullChecks`: 严格 null 检查
- `strictFunctionTypes`: 严格函数类型
- `strictBindCallApply`: 严格 bind/call/apply
- `strictPropertyInitialization`: 严格属性初始化

---

## 类型组织

### 1. 目录结构

```
src/types/
├── provider.ts         # Provider 类型
├── token.ts           # Token 类型
├── config.ts          # 配置类型
├── mcp.ts             # MCP 类型
├── app.ts             # 应用类型（AppType 枚举）
├── proxy.ts           # 代理类型
└── ...
```

---

### 2. 类型文件命名

**规则**: 
- 文件名: `*.ts`（不是 `.d.ts`）
- 一个领域一个文件
- 导出方式: `export interface` / `export type` / `export enum`

**实际示例** (`src/types/provider.ts:21-43`):
```typescript
import { AppType } from './app';

export interface ProviderProxyConfig {
    enabled: boolean;
    proxyType?: 'http' | 'https' | 'socks5';
    proxyHost?: string;
    proxyPort?: number;
    proxyUsername?: string;
    proxyPassword?: string;
}

export interface Provider {
    id: string;
    name: string;
    appType: AppType;
    apiKey: string;
    url?: string;
    defaultSonnetModel?: string;
    defaultOpusModel?: string;
    defaultHaikuModel?: string;
    customParams?: Record<string, any>;
    description?: string;
    tags?: string[];
    isActive: boolean;
    createdAt: string;
    lastUsed?: string;
    proxyConfig?: ProviderProxyConfig;
}
```

---

### 3. 共享类型 vs 本地类型

| 类型 | 位置 | 导出方式 |
|------|------|---------|
| **共享类型** | `src/types/*.ts` | `export interface` |
| **组件 Props** | 组件文件内 | 不导出（或按需导出）|
| **Store State** | Store 文件内 | 不导出（或按需导出）|

**示例**:
```typescript
// ✅ 共享类型：放在 src/types/provider.ts
export interface Provider {
    id: string;
    name: string;
    // ...
}

// ✅ 组件 Props：放在组件文件内
interface ProviderCardProps {
    provider: Provider;  // 引用共享类型
    onEdit: (provider: Provider) => void;
}
```

---

## 类型定义模式

### 1. Interface vs Type

**规则**: 优先使用 `interface`，特殊场景使用 `type`。

```typescript
// ✅ 推荐：对象类型使用 interface
export interface Provider {
    id: string;
    name: string;
}

// ✅ 适用场景：联合类型、工具类型使用 type
export type ProxyType = 'http' | 'https' | 'socks5';
export type PartialProvider = Partial<Provider>;
```

---

### 2. 可选字段

**规则**: 使用 `?` 标记可选字段。

**实际示例** (`src/types/provider.ts:26-30`):
```typescript
export interface Provider {
    id: string;              // 必填
    name: string;            // 必填
    url?: string;            // 可选
    description?: string;    // 可选
    tags?: string[];         // 可选
}
```

---

### 3. 字符串字面量联合类型

**规则**: 限定字符串取值范围。

**实际示例** (`src/types/provider.ts:10`):
```typescript
export interface ProviderProxyConfig {
    proxyType?: 'http' | 'https' | 'socks5';  // 限定 3 个值
}
```

---

### 4. Record 类型

**规则**: 动态键值对使用 `Record<K, V>`。

**实际示例** (`src/types/provider.ts:31`):
```typescript
export interface Provider {
    customParams?: Record<string, any>;  // 动态参数
    meta?: Record<string, string>;      // 元数据
}
```

---

### 5. 枚举 (Enum)

**规则**: 有限选项使用 `enum`。

**实际示例** (`src/types/app.ts`):
```typescript
export enum AppType {
    Claude = 'claude',
    Codex = 'codex',
    Gemini = 'gemini',
}
```

---

## 类型工具 (Utility Types)

### 1. Omit - 排除字段

**使用场景**: 创建数据时排除自动生成的字段（id, createdAt 等）。

**实际示例** (`src/stores/useProviderStore.ts:16`):
```typescript
interface ProviderState {
    addProvider: (
        data: Omit<Provider, 'id' | 'createdAt' | 'isActive' | 'lastUsed' | 'inFailoverQueue'>
    ) => Promise<void>;
}

// 调用时不需要传 id、createdAt 等字段
await addProvider({
    name: 'My Provider',
    appType: AppType.Claude,
    apiKey: 'sk-xxx',
    // 不需要传 id, createdAt, isActive, lastUsed
});
```

---

### 2. Partial - 所有字段可选

**使用场景**: 更新操作（部分字段更新）。

```typescript
interface ProviderState {
    updateProvider: (id: string, data: Partial<Provider>) => Promise<void>;
}

// 只更新 name 字段
await updateProvider('provider-123', { name: 'New Name' });
```

---

### 3. Pick - 选择字段

**使用场景**: 提取部分字段。

```typescript
type ProviderSummary = Pick<Provider, 'id' | 'name' | 'isActive'>;
```

---

### 4. Required - 所有字段必填

```typescript
type RequiredProvider = Required<Provider>;  // 所有可选字段变为必填
```

---

## 函数类型

### 1. 事件处理函数

**规则**: 明确定义参数和返回类型。

```typescript
interface ProviderCardProps {
    onEdit: (provider: Provider) => void;
    onDelete: (id: string, name: string) => void;
    onSwitch: (id: string) => void;
}
```

---

### 2. 异步函数

**规则**: 返回类型使用 `Promise<T>`。

```typescript
interface ProviderState {
    loadProviders: (app: AppType, force?: boolean) => Promise<void>;
    addProvider: (data: Omit<Provider, 'id'>) => Promise<void>;
}
```

---

### 3. 泛型函数

```typescript
function invoke<T>(command: string, args?: any): Promise<T> {
    // ...
}

// 使用时指定类型
const providers = await invoke<Provider[]>('get_providers');
```

---

## Tauri 命令类型

### 1. invoke 类型标注

**规则**: 总是为 `invoke` 指定返回类型。

```typescript
// ✅ 正确：指定返回类型
const providers = await invoke<Provider[]>('get_providers', { app });

// ❌ 错误：缺少类型标注
const providers = await invoke('get_providers', { app });
```

---

### 2. 命令参数类型

**规则**: 使用对象解构传参，确保字段名与 Rust 端一致。

```typescript
// Rust 端定义
#[tauri::command]
pub fn get_providers(app: String, state: State<AppState>) -> Result<Vec<Provider>, String>

// TypeScript 调用
const providers = await invoke<Provider[]>('get_providers', {
    app: 'claude'  // 参数名必须匹配
});
```

---

## React 类型

### 1. 组件 Props

```typescript
interface ProviderCardProps {
    provider: Provider;
    isDragging?: boolean;
    onEdit: (provider: Provider) => void;
}

export default function ProviderCard({
    provider,
    isDragging,
    onEdit,
}: ProviderCardProps) {
    // ...
}
```

---

### 2. 事件类型

```typescript
import { type MouseEvent, type ChangeEvent } from 'react';

const handleClick = (e: MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
};

const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    console.log(e.target.value);
};
```

---

### 3. Ref 类型

```typescript
import { useRef, type RefObject } from 'react';

function Component() {
    const inputRef = useRef<HTMLInputElement>(null);
    
    const focus = () => {
        inputRef.current?.focus();
    };
}
```

---

## 类型守卫 (Type Guards)

### 自定义类型守卫

```typescript
function isProvider(obj: any): obj is Provider {
    return obj && typeof obj.id === 'string' && typeof obj.name === 'string';
}

// 使用
if (isProvider(data)) {
    console.log(data.name);  // TypeScript 知道 data 是 Provider
}
```

---

## 禁止的模式

### ❌ 禁止：使用 `any`

```typescript
// ❌ 错误
function handleData(data: any) {
    return data.name;
}

// ✅ 正确：使用具体类型
function handleData(data: Provider) {
    return data.name;
}

// ✅ 正确：使用泛型
function handleData<T extends { name: string }>(data: T) {
    return data.name;
}
```

---

### ❌ 禁止：类型断言 (as) 滥用

```typescript
// ❌ 错误：强制断言
const provider = data as Provider;

// ✅ 正确：使用类型守卫
if (isProvider(data)) {
    const provider = data;  // 类型自动推断
}

// ✅ 正确：Tauri invoke 明确返回类型
const provider = await invoke<Provider>('get_provider', { id });
```

---

### ❌ 禁止：忽略 TypeScript 错误

```typescript
// ❌ 错误：使用 @ts-ignore 或 @ts-expect-error
// @ts-ignore
const x = data.nonExistentField;

// ✅ 正确：修复类型定义
interface Data {
    nonExistentField?: string;
}
const x = data.nonExistentField;
```

---

### ❌ 禁止：隐式 any

```typescript
// ❌ 错误：参数缺少类型
function handleClick(e) {  // e 隐式为 any
    console.log(e.target);
}

// ✅ 正确：明确类型
function handleClick(e: MouseEvent<HTMLButtonElement>) {
    console.log(e.target);
}
```

---

## 常见错误

### ❌ 错误：Record<string, any> 过度使用

```typescript
// ❌ 不推荐：丢失类型信息
interface Provider {
    customParams?: Record<string, any>;
}
```

### ✅ 正确：尽量定义具体类型

```typescript
// ✅ 推荐：定义清晰的类型
interface CustomParams {
    maxTokens?: number;
    temperature?: number;
    topP?: number;
}

interface Provider {
    customParams?: CustomParams;
}
```

---

### ❌ 错误：可选链滥用

```typescript
// ❌ 不必要的可选链
const name = provider?.name;  // provider 不可能为 null

// ✅ 正确：provider 必定存在
const name = provider.name;

// ✅ 正确：仅在真正可能为 null 时使用
const description = provider.description ?? '无描述';
```

---

## 与 Rust 后端的类型同步

### 命名约定

**Rust 端** (`src-tauri/src/models/provider.rs`):
```rust
#[derive(Serialize, Deserialize)]
pub struct Provider {
    pub id: String,
    pub name: String,
    #[serde(rename = "apiKey")]  // 映射到 camelCase
    pub api_key: String,
    #[serde(rename = "isActive")]
    pub is_active: bool,
}
```

**TypeScript 端** (`src/types/provider.ts`):
```typescript
export interface Provider {
    id: string;
    name: string;
    apiKey: string;      // camelCase
    isActive: boolean;   // camelCase
}
```

**规则**:
- Rust 内部: `snake_case`
- JSON 序列化: `camelCase`（通过 `#[serde(rename)]`）
- TypeScript: `camelCase`

---

## 类型导入最佳实践

### 1. 使用 type 导入（TypeScript 3.8+）

```typescript
// ✅ 推荐：明确标记类型导入
import type { Provider } from '../../types/provider';
import type { MouseEvent } from 'react';

// ⚠️ 可以但不推荐：混合导入
import { Provider } from '../../types/provider';
```

---

### 2. 避免循环依赖

```
❌ 错误：
types/provider.ts → types/config.ts → types/provider.ts

✅ 正确：
types/provider.ts ← components/ProviderCard.tsx
types/config.ts ← components/ConfigPanel.tsx
```

---

## 参考

- TypeScript 版本: 5.8
- 严格模式: 启用
- 完整配置: 见 `tsconfig.json`
- 类型示例: `src/types/provider.ts`
