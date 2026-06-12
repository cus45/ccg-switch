# 组件开发规范

## 概述

本项目使用 React 19 函数组件 + TypeScript 5.8，样式使用 TailwindCSS 3 + DaisyUI 4，图标使用 lucide-react。

---

## 组件结构

### 标准组件文件结构

```tsx
// 1. 导入依赖（分组：React → 第三方库 → 本地模块）
import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Edit2, Trash2, Eye } from 'lucide-react';

import { Provider } from '../../types/provider';
import { useProviderStore } from '../../stores/useProviderStore';

// 2. 类型定义（Props 接口）
interface ProviderCardProps {
    provider: Provider;
    onEdit: (provider: Provider) => void;
    onDelete: (id: string) => void;
}

// 3. 辅助函数（组件外部定义）
function maskApiKey(key: string) {
    if (key.length <= 10) return '***';
    return key.substring(0, 7) + '...' + key.substring(key.length - 4);
}

// 4. 组件定义
export default function ProviderCard({
    provider,
    onEdit,
    onDelete,
}: ProviderCardProps) {
    const { t } = useTranslation();
    const [showKey, setShowKey] = useState(false);

    // Hooks
    useEffect(() => {
        // ...
    }, []);

    // 事件处理
    const handleEdit = () => {
        onEdit(provider);
    };

    // 渲染
    return (
        <div className="...">
            {/* JSX */}
        </div>
    );
}

// 5. 子组件（如果存在，定义在主组件下方）
function SubComponent() {
    return <div>...</div>;
}
```

---

## Props 规范

### 1. Props 接口定义

**规则**:
- 总是定义独立的 Props 接口
- 接口名: `{ComponentName}Props`
- 使用 TypeScript 严格模式

**实际示例** (`src/components/providers/ProviderCard.tsx:11-23`):
```tsx
interface ProviderCardProps {
    provider: Provider;
    isDragging?: boolean;
    isDragOver?: boolean;
    onSwitch: (id: string) => void;
    onEdit: (provider: Provider) => void;
    onClone: (provider: Provider) => void;
    onDelete: (id: string, name: string) => void;
    onPointerDragStart: (e: React.PointerEvent<HTMLElement>) => void;
    onPointerOver: () => void;
    healthStatus?: HealthStatus;
    onHealthCheck?: (id: string) => void;
}
```

---

### 2. Props 命名约定

| 类型 | 命名模式 | 示例 |
|------|---------|------|
| 事件回调 | `on*` | `onEdit`, `onClick`, `onDelete` |
| 布尔标志 | `is*` / `has*` / `should*` | `isActive`, `hasError`, `shouldShow` |
| 渲染函数 | `render*` | `renderHeader`, `renderItem` |
| 样式相关 | `*ClassName` / `*Style` | `containerClassName` |

**实际示例**:
```tsx
interface CardProps {
    isActive: boolean;          // ✅ 布尔标志
    isDragging?: boolean;       // ✅ 可选布尔
    onSwitch: (id: string) => void;  // ✅ 事件回调
    healthStatus?: HealthStatus;     // ✅ 可选数据
}
```

---

### 3. Props 解构

**规则**: 直接在函数参数中解构 Props。

```tsx
// ✅ 推荐：参数解构
export default function ProviderCard({
    provider,
    onEdit,
    onDelete,
}: ProviderCardProps) {
    // ...
}

// ❌ 不推荐：内部解构
export default function ProviderCard(props: ProviderCardProps) {
    const { provider, onEdit, onDelete } = props;
    // ...
}
```

---

## 样式规范

### 1. TailwindCSS + DaisyUI

**规则**:
- 使用 TailwindCSS 原子类
- 使用 DaisyUI 组件（`btn`, `card`, `badge` 等）
- 复杂样式使用模板字符串拼接

**实际示例** (`src/components/providers/ProviderCard.tsx:46-57`):
```tsx
return (
    <div
        className={`bg-white dark:bg-base-100 rounded-xl shadow-sm border transition-all flex flex-col ${
            provider.isActive
                ? 'border-green-400 dark:border-green-500 ring-1 ring-green-200 dark:ring-green-800'
                : 'border-gray-100 dark:border-base-200'
        } ${isDragging ? 'opacity-50 scale-95' : ''} ${
            isDragOver ? 'ring-2 ring-info/40' : ''
        }`}
    >
        {/* 内容 */}
    </div>
);
```

---

### 2. 卡片样式标准

**标准卡片类名**:
```tsx
className="bg-white dark:bg-base-100 rounded-xl shadow-sm border border-gray-100 dark:border-base-200"
```

**实际使用** (`src/pages/Dashboard.tsx:550`):
```tsx
<div className="bg-white dark:bg-base-100 rounded-xl p-4 shadow-sm border border-gray-100 dark:border-base-200 transition-all duration-300 hover:shadow-lg hover:-translate-y-0.5">
    {/* 卡片内容 */}
</div>
```

---

### 3. 按钮样式

**DaisyUI 按钮类**:
```tsx
// 主按钮（渐变色）
<button className="btn bg-gradient-to-r from-orange-500 to-pink-500 text-white border-none">
    确认
</button>

// Ghost 按钮
<button className="btn btn-ghost">
    取消
</button>

// 尺寸变体
<button className="btn btn-sm">小按钮</button>
<button className="btn btn-xs">超小按钮</button>
```

**实际示例** (`src/pages/Dashboard.tsx:168-174`):
```tsx
<button
    onClick={() => loadData(true)}
    disabled={loading}
    className="btn btn-ghost btn-sm hover:bg-base-200 transition-all duration-200 hover:-translate-y-0.5"
    title={t('common.refresh')}
>
    <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
</button>
```

---

### 4. 深色模式支持

**规则**: 所有组件必须支持深色模式。

**模式**:
```tsx
// 背景色
className="bg-white dark:bg-base-100"

// 文本颜色
className="text-gray-900 dark:text-base-content"

// 边框
className="border-gray-100 dark:border-base-200"

// 次要文本
className="text-gray-500 dark:text-gray-400"
```

---

## 国际化 (i18n)

### 1. 使用 `useTranslation` Hook

**规则**: 所有用户可见文本必须国际化。

**实际示例** (`src/components/providers/ProviderCard.tsx:43-44`):
```tsx
export default function ProviderCard({ provider }: ProviderCardProps) {
    const { t } = useTranslation();
    
    return (
        <button title={t('common.edit')}>
            <Edit2 className="w-4 h-4" />
        </button>
    );
}
```

---

### 2. 翻译键命名约定

**结构**: `{domain}.{key}`

**示例**:
```tsx
t('dashboard.welcome')           // 仪表盘.欢迎
t('provider.add_button')         // Provider.添加按钮
t('common.save')                 // 通用.保存
t('token_usage.total_tokens')    // Token用量.总Token数
```

---

### 3. 新增翻译

**流程**:
1. 在 `src/locales/zh.json` 添加中文
2. 在 `src/locales/en.json` 添加英文
3. 两者必须同步更新

---

## 图标使用

### lucide-react

**规则**:
- 使用 lucide-react 图标库
- 图标大小: `w-4 h-4`（小）、`w-5 h-5`（中）、`w-6 h-6`（大）

**实际示例** (`src/components/providers/ProviderCard.tsx:1`):
```tsx
import { Zap, Edit2, Trash2, Eye, EyeOff, GripVertical } from 'lucide-react';

// 使用
<Zap className="w-3 h-3" fill="currentColor" />
<Edit2 className="w-4 h-4" />
```

---

## 状态管理

### 1. 本地状态 (useState)

**适用场景**: 仅组件内部使用的状态。

**实际示例** (`src/components/providers/ProviderCard.tsx:44`):
```tsx
export default function ProviderCard({ provider }: ProviderCardProps) {
    const [showKey, setShowKey] = useState(false);
    
    return (
        <button onClick={() => setShowKey(!showKey)}>
            {showKey ? <EyeOff /> : <Eye />}
        </button>
    );
}
```

---

### 2. 全局状态 (Zustand)

**适用场景**: 跨组件共享的状态。

**实际示例** (`src/pages/Dashboard.tsx:19`):
```tsx
function Dashboard() {
    const { stats, loading, loadData } = useDashboardStore();
    
    useEffect(() => {
        void loadData();
    }, [loadData]);
    
    return <div>{stats.num_startups}</div>;
}
```

---

## 事件处理

### 1. 事件回调命名

**模式**: `handle*`（组件内部）+ `on*`（Props 接口）

```tsx
interface CardProps {
    onEdit: (id: string) => void;  // Props 使用 on*
}

export default function Card({ onEdit }: CardProps) {
    const handleEdit = () => {     // 内部使用 handle*
        // 处理逻辑
        onEdit(id);
    };
    
    return <button onClick={handleEdit}>编辑</button>;
}
```

---

### 2. 内联 vs 独立函数

```tsx
// ✅ 简单逻辑：内联
<button onClick={() => setCount(count + 1)}>
    +1
</button>

// ✅ 复杂逻辑：独立函数
const handleSubmit = async () => {
    setLoading(true);
    try {
        await saveData();
        showToast('保存成功');
    } catch (error) {
        showToast('保存失败');
    } finally {
        setLoading(false);
    }
};

<button onClick={handleSubmit}>保存</button>
```

---

## Tauri 窗口拖拽

### data-tauri-drag-region

**规则**: 顶部固定区域需要添加窗口拖拽属性。

**实际示例** (`src/components/layout/Layout.tsx:15-25`):
```tsx
<div
    className="fixed top-0 left-0 right-0 h-8"
    style={{
        zIndex: 9999,
        backgroundColor: 'rgba(0,0,0,0.001)',
        cursor: 'default',
        userSelect: 'none',
        WebkitUserSelect: 'none'
    }}
    data-tauri-drag-region
/>
```

**避让**: Navbar 使用 `pt-9` 避让拖拽区域。

---

## 无障碍 (Accessibility)

### 基本要求

1. **按钮/链接必须有可见文本或 `aria-label`**
```tsx
// ✅ 有文本
<button>保存</button>

// ✅ 图标按钮 + title
<button title={t('common.edit')}>
    <Edit2 className="w-4 h-4" />
</button>
```

2. **表单输入必须关联 label**
```tsx
<label htmlFor="api-key">API Key</label>
<input id="api-key" type="text" />
```

3. **使用语义化 HTML**
```tsx
// ✅ 语义化
<nav>...</nav>
<main>...</main>
<button>...</button>

// ❌ 非语义
<div onClick={...}>...</div>
```

---

## 常见错误

### ❌ 错误：未定义 Props 接口
```tsx
export default function Card({ name, onEdit }) {  // ❌ 缺少类型
    // ...
}
```

### ✅ 正确：定义 Props 接口
```tsx
interface CardProps {
    name: string;
    onEdit: () => void;
}

export default function Card({ name, onEdit }: CardProps) {
    // ...
}
```

---

### ❌ 错误：硬编码文本
```tsx
<button>保存</button>  // ❌ 硬编码中文
```

### ✅ 正确：使用 i18n
```tsx
<button>{t('common.save')}</button>  // ✅
```

---

### ❌ 错误：忘记深色模式
```tsx
<div className="bg-white text-gray-900">  // ❌ 缺少 dark: 变体
```

### ✅ 正确：支持深色模式
```tsx
<div className="bg-white dark:bg-base-100 text-gray-900 dark:text-base-content">
```

---

## 组件复用原则

### 何时抽取独立组件

- **重复 3 次以上** → 抽取组件
- **逻辑复杂** → 抽取子组件
- **跨页面使用** → 移到 `components/common/`

**示例**: `HealthStatusBadge` 被多个页面使用，独立为通用组件。

---

## 参考

- UI 框架: TailwindCSS 3 + DaisyUI 4
- 图标库: lucide-react
- 国际化: i18next
- 完整技术栈: 见 `CLAUDE.md` 第 4-18 行
