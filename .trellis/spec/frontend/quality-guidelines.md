# 代码质量规范

## 概述

本文档定义前端代码质量标准，包括禁止模式、必需模式、测试要求和代码审查检查清单。

---

## 构建与验证命令

### 可用命令

```bash
# 开发模式
npm run dev              # 仅前端（Vite）
npm run tauri dev        # 完整应用（前端 + Rust）

# 构建
npm run build            # TypeScript 类型检查 + Vite 构建
npm run tauri build      # 生产构建（桌面应用）

# 预览
npm run preview          # 预览生产构建

# 版本管理
npm run bump <version> [type] [description]
```

---

### 提交前必检

```bash
# 1. TypeScript 类型检查
npm run build

# 2. Rust 编译检查
cargo check --manifest-path src-tauri/Cargo.toml

# 3. 手动测试主要功能
npm run tauri dev
```

---

## 禁止的模式

### 1. TypeScript 相关

#### ❌ 禁止：使用 `any` 类型
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

#### ❌ 禁止：类型断言滥用
```typescript
// ❌ 错误：强制类型转换
const provider = data as Provider;

// ✅ 正确：类型守卫
if (isProvider(data)) {
    const provider = data;
}

// ✅ 正确：明确的 Tauri invoke 类型
const provider = await invoke<Provider>('get_provider', { id });
```

---

#### ❌ 禁止：忽略 TypeScript 错误
```typescript
// ❌ 错误：使用 @ts-ignore
// @ts-ignore
const value = obj.nonExistentField;

// ✅ 正确：修复类型定义
interface Obj {
    nonExistentField?: string;
}
const value = obj.nonExistentField;
```

---

#### ❌ 禁止：未使用的变量
```typescript
// ❌ 错误：定义但未使用（tsconfig 配置会报错）
const unused = 123;

// ✅ 正确：删除未使用的变量
// （或使用下划线前缀表示故意忽略）
const _ignored = 123;
```

---

### 2. React 相关

#### ❌ 禁止：在条件/循环中调用 Hooks
```typescript
// ❌ 错误：违反 Hook 规则
function Component({ shouldFetch }: Props) {
    if (shouldFetch) {
        const data = useFetchData();  // ❌
    }
}

// ✅ 正确：Hook 在顶层调用
function Component({ shouldFetch }: Props) {
    const { data, fetch } = useFetchData();
    
    useEffect(() => {
        if (shouldFetch) void fetch();
    }, [shouldFetch, fetch]);
}
```

---

#### ❌ 禁止：直接修改状态
```typescript
// ❌ 错误：直接修改数组
const [items, setItems] = useState([]);
items.push(newItem);  // ❌

// ✅ 正确：创建新数组
setItems([...items, newItem]);
```

---

#### ❌ 禁止：遗漏依赖数组
```typescript
// ❌ 错误：遗漏依赖
useEffect(() => {
    fetchData(userId);
}, []);  // ❌ 缺少 userId

// ✅ 正确：包含所有依赖
useEffect(() => {
    void fetchData(userId);
}, [userId]);
```

---

### 3. 样式相关

#### ❌ 禁止：忘记深色模式
```typescript
// ❌ 错误：仅浅色模式
<div className="bg-white text-gray-900">

// ✅ 正确：支持深色模式
<div className="bg-white dark:bg-base-100 text-gray-900 dark:text-base-content">
```

---

#### ❌ 禁止：内联样式（除非必要）
```tsx
// ❌ 不推荐：简单样式使用内联
<div style={{ padding: '16px', margin: '8px' }}>

// ✅ 推荐：使用 Tailwind 类
<div className="p-4 m-2">

// ✅ 允许：复杂动态样式
<div style={{ transform: `translateX(${offset}px)` }}>
```

---

### 4. 国际化相关

#### ❌ 禁止：硬编码文本
```tsx
// ❌ 错误：硬编码中文
<button>保存</button>

// ✅ 正确：使用 i18n
<button>{t('common.save')}</button>
```

---

#### ❌ 禁止：只更新一种语言
```json
// ❌ 错误：只更新 zh.json
{
  "dashboard": {
    "new_feature": "新功能"
  }
}

// ✅ 正确：同时更新 zh.json 和 en.json
// zh.json
{
  "dashboard": {
    "new_feature": "新功能"
  }
}

// en.json
{
  "dashboard": {
    "new_feature": "New Feature"
  }
}
```

---

### 5. Tauri 相关

#### ❌ 禁止：未指定 invoke 返回类型
```typescript
// ❌ 错误：缺少类型
const data = await invoke('get_data');

// ✅ 正确：指定返回类型
const data = await invoke<Provider[]>('get_data');
```

---

#### ❌ 禁止：硬编码路径分隔符
```typescript
// ❌ 错误：硬编码 Windows 路径
const path = 'C:\\Users\\...';

// ✅ 正确：使用 Tauri path API
import { homeDir, join } from '@tauri-apps/api/path';
const home = await homeDir();
const configPath = await join(home, '.claude', 'settings.json');
```

---

## 必需的模式

### 1. TypeScript 严格模式

**规则**: 所有 TypeScript 文件必须通过严格模式检查。

```json
// tsconfig.json
{
  "compilerOptions": {
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true
  }
}
```

---

### 2. Props 接口定义

**规则**: 所有组件必须定义 Props 接口。

```tsx
// ✅ 必需
interface ProviderCardProps {
    provider: Provider;
    onEdit: (provider: Provider) => void;
}

export default function ProviderCard({ provider, onEdit }: ProviderCardProps) {
    // ...
}
```

---

### 3. 国际化

**规则**: 所有用户可见文本必须使用 `t()` 函数。

```tsx
// ✅ 必需
const { t } = useTranslation();
return <button>{t('common.save')}</button>;
```

---

### 4. 深色模式支持

**规则**: 所有 UI 组件必须支持深色模式。

```tsx
// ✅ 必需：所有颜色类都有 dark: 变体
<div className="bg-white dark:bg-base-100 text-gray-900 dark:text-base-content">
```

---

### 5. 错误处理

**规则**: 所有异步操作必须处理错误。

```typescript
// ✅ 必需：try-catch + 用户提示
try {
    await invoke('save_data', { data });
    showToast(t('common.save_success'));
} catch (error) {
    showToast(t('common.save_error'));
    console.error('Save failed:', error);
}
```

---

### 6. 加载状态

**规则**: 异步操作必须显示加载状态。

```tsx
// ✅ 必需
function Component() {
    const { data, loading } = useData();
    
    if (loading) return <LoadingSpinner />;
    return <div>{data}</div>;
}
```

---

## 代码组织规范

### 1. 导入顺序

**规则**: 按分组排序导入语句。

```typescript
// 1. React 核心
import { useState, useEffect, useCallback } from 'react';

// 2. 第三方库
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { Edit2, Trash2 } from 'lucide-react';

// 3. 本地模块（类型）
import type { Provider } from '../../types/provider';

// 4. 本地模块（其他）
import { useProviderStore } from '../../stores/useProviderStore';
import { showToast } from '../../utils/toast';
```

---

### 2. 组件文件结构

```tsx
// 1. 导入
import { ... } from 'react';

// 2. 类型定义
interface ComponentProps { ... }

// 3. 辅助函数（组件外部）
function helperFunction() { ... }

// 4. 主组件
export default function Component(props: ComponentProps) {
    // 4.1 Hooks
    const { t } = useTranslation();
    const [state, setState] = useState();
    
    // 4.2 事件处理
    const handleClick = () => { ... };
    
    // 4.3 副作用
    useEffect(() => { ... }, []);
    
    // 4.4 渲染
    return <div>...</div>;
}

// 5. 子组件（如果存在）
function SubComponent() { ... }
```

---

## 测试要求

### 当前状态

**前端**: 暂无自动化测试框架。

**后端**: Rust 测试可用 `cargo test --manifest-path src-tauri/Cargo.toml`。

---

### 手动测试清单

#### 新功能开发
- [ ] 功能在开发模式正常工作 (`npm run tauri dev`)
- [ ] 功能在生产构建正常工作 (`npm run tauri build`)
- [ ] 浅色模式和深色模式都正常显示
- [ ] 中英文翻译都已添加
- [ ] 错误场景有合理提示
- [ ] 加载状态正确显示

---

#### Bug 修复
- [ ] 复现原始 Bug
- [ ] 修复后 Bug 不再出现
- [ ] 相关功能未受影响

---

### 未来计划

建议引入以下测试框架：
- **单元测试**: Vitest
- **组件测试**: React Testing Library
- **E2E 测试**: Playwright（Tauri 官方支持）

---

## 性能规范

### 1. 避免不必要的重渲染

```tsx
// ✅ 使用 useMemo 缓存昂贵计算
const sortedItems = useMemo(() => 
    items.sort((a, b) => a.name.localeCompare(b.name)),
    [items]
);

// ✅ 使用 useCallback 缓存回调
const handleClick = useCallback(() => {
    console.log(selectedId);
}, [selectedId]);
```

---

### 2. 避免重复数据加载

```typescript
// ✅ 使用 hasLoaded 标志
loadData: async (force = false) => {
    if (!force && get().hasLoaded) return;  // 避免重复加载
    // ...
}
```

---

### 3. 图片优化

```tsx
// ✅ 使用合适的图片格式和尺寸
<img src="icon.svg" alt="Logo" className="w-8 h-8" />  // SVG 用于图标
<img src="photo.webp" alt="Photo" loading="lazy" />   // WebP + 懒加载
```

---

## 无障碍规范

### 1. 语义化 HTML

```tsx
// ✅ 正确：使用语义化标签
<nav>...</nav>
<main>...</main>
<button>...</button>

// ❌ 错误：非语义化
<div onClick={...}>...</div>
```

---

### 2. 键盘导航

```tsx
// ✅ 确保可键盘操作
<button onClick={handleClick}>确认</button>

// ❌ 避免：仅鼠标可用
<div onClick={handleClick}>确认</div>
```

---

### 3. 可访问标签

```tsx
// ✅ 图标按钮必须有 title 或 aria-label
<button title={t('common.edit')}>
    <Edit2 className="w-4 h-4" />
</button>

// ✅ 表单输入必须有 label
<label htmlFor="api-key">API Key</label>
<input id="api-key" type="text" />
```

---

## 代码审查清单

### 功能审查

- [ ] 功能符合需求
- [ ] 错误场景有合理处理
- [ ] 加载状态正确显示
- [ ] 没有明显的性能问题

---

### 代码质量

- [ ] TypeScript 类型安全（无 `any`, 无 `@ts-ignore`）
- [ ] 没有未使用的变量/导入
- [ ] Props 接口已定义
- [ ] 命名清晰易懂

---

### UI/UX

- [ ] 深色模式支持
- [ ] 响应式布局（移动端/桌面端）
- [ ] 所有文本已国际化（zh + en）
- [ ] 图标使用 lucide-react
- [ ] 按钮/链接有合理的悬停效果

---

### 样式规范

- [ ] 使用 TailwindCSS 类
- [ ] 卡片使用标准样式（见组件规范）
- [ ] 颜色使用项目调色板
- [ ] 间距使用 Tailwind spacing scale

---

### 无障碍

- [ ] 使用语义化 HTML
- [ ] 图标按钮有 title 或 aria-label
- [ ] 表单输入有关联 label
- [ ] 可键盘导航

---

### 跨平台

- [ ] 路径使用 Tauri API（不硬编码）
- [ ] 没有平台特定的假设
- [ ] Tauri 窗口拖拽区域正确设置

---

## Commit 规范

### Conventional Commits

**格式**: `<type>(<scope>): <description>`

**类型**:
- `feat`: 新功能
- `fix`: Bug 修复
- `refactor`: 重构（不改变功能）
- `docs`: 文档
- `style`: 代码格式（不影响功能）
- `test`: 测试
- `chore`: 构建/工具配置

**示例**:
```bash
feat(provider): 添加 Provider 健康检查功能
fix(dashboard): 修复 Token 统计显示错误
refactor(store): 重构 useProviderStore 结构
docs(readme): 更新安装说明
chore: bump version to 1.5.0
```

---

## Pull Request 规范

### PR 标题

使用 Conventional Commit 格式。

---

### PR 描述模板

```markdown
## 变更说明
<!-- 简要描述本次变更的内容 -->

## 变更类型
- [ ] 新功能
- [ ] Bug 修复
- [ ] 重构
- [ ] 文档更新

## 测试
<!-- 描述如何测试本次变更 -->
- [ ] 本地测试通过
- [ ] TypeScript 类型检查通过（`npm run build`）
- [ ] Rust 编译检查通过（`cargo check`）

## UI 截图
<!-- 如有 UI 变更，附上截图 -->

## 相关 Issue
<!-- 关联的 Issue 编号 -->
Closes #123
```

---

## 常见问题

### Q: 如何确保代码质量？

**A**: 提交前运行：
```bash
npm run build                                      # TypeScript 检查
cargo check --manifest-path src-tauri/Cargo.toml  # Rust 检查
```

---

### Q: 如何处理 TypeScript 错误？

**A**: 
1. 不要使用 `@ts-ignore` 忽略错误
2. 修复类型定义或使用类型守卫
3. 如确实需要，使用 `@ts-expect-error` + 注释说明原因

---

### Q: 深色模式不生效？

**A**: 检查是否所有颜色类都添加了 `dark:` 变体：
```tsx
className="bg-white dark:bg-base-100"
```

---

### Q: 国际化文本未显示？

**A**: 
1. 检查翻译键是否存在于 `zh.json` 和 `en.json`
2. 确保组件中调用了 `useTranslation()`

---

## 参考

- TypeScript 配置: `tsconfig.json`
- 提交规范: Conventional Commits
- 完整技术栈: 见 `CLAUDE.md`
- 代码规范: 见 `AGENTS.md`
