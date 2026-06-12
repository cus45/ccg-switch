# 前端开发规范

> CC Switch 项目前端开发最佳实践。

---

## 概述

本目录包含前端开发的所有规范文档，涵盖目录结构、组件开发、状态管理、类型安全、Hooks 使用和代码质量标准。

**技术栈**: React 19 + TypeScript 5.8 + Vite 7 + TailwindCSS 3 + DaisyUI 4 + Zustand 5

---

## 规范索引

| 规范文档 | 描述 | 状态 |
|---------|------|------|
| [目录结构规范](./directory-structure.md) | 模块组织、文件布局、命名约定 | ✅ 已完成 |
| [组件开发规范](./component-guidelines.md) | 组件模式、Props 约定、样式规范 | ✅ 已完成 |
| [Hooks 使用规范](./hook-guidelines.md) | 自定义 Hooks、数据获取模式 | ✅ 已完成 |
| [状态管理规范](./state-management.md) | 本地状态、全局状态、服务端状态 | ✅ 已完成 |
| [类型安全规范](./type-safety.md) | TypeScript 类型模式、工具类型 | ✅ 已完成 |
| [代码质量规范](./quality-guidelines.md) | 代码标准、禁止模式、测试要求 | ✅ 已完成 |

---

## 快速参考

### 核心约定

#### 文件命名
- **组件**: PascalCase (`ProviderCard.tsx`)
- **Hooks**: camelCase + `use` 前缀 (`useHealthCheck.ts`)
- **Store**: camelCase + `use` 前缀 + `Store` 后缀 (`useProviderStore.ts`)
- **类型**: camelCase (`provider.ts`)
- **服务**: camelCase + `Service` 后缀 (`configService.ts`)

---

#### 导入顺序
```typescript
// 1. React 核心
import { useState, useEffect } from 'react';

// 2. 第三方库
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';

// 3. 类型（使用 type 关键字）
import type { Provider } from '../../types/provider';

// 4. 本地模块
import { useProviderStore } from '../../stores/useProviderStore';
```

---

#### 组件结构
```tsx
// 1. 导入
// 2. 类型定义（Props 接口）
// 3. 辅助函数（组件外）
// 4. 主组件
//    4.1 Hooks
//    4.2 事件处理
//    4.3 副作用（useEffect）
//    4.4 渲染
// 5. 子组件（如果存在）
```

---

#### 样式约定

**标准卡片**:
```tsx
className="bg-white dark:bg-base-100 rounded-xl shadow-sm border border-gray-100 dark:border-base-200"
```

**页面容器**:
```tsx
<div className="h-full w-full overflow-y-auto">
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
        {/* 内容 */}
    </div>
</div>
```

**深色模式**（必需）:
```tsx
className="bg-white dark:bg-base-100 text-gray-900 dark:text-base-content"
```

---

#### 状态管理

**本地状态** (`useState`):
- 仅组件内使用的状态
- UI 交互状态（展开/收起、输入值）

**全局状态** (Zustand):
- 跨组件共享的状态
- 业务数据（Provider 列表、配置）
- 服务端数据

**Store 命名**: `useXStore`

**异步操作模式**:
```typescript
loadData: async (force = false) => {
    if (!force && get().hasLoaded) return;
    set({ loading: true, error: null });
    try {
        const data = await invoke<T[]>('get_data');
        set({ data, loading: false, hasLoaded: true });
    } catch (error) {
        set({ error: String(error), loading: false });
    }
}
```

---

#### 类型安全

**严格模式**: 启用 `strict: true`

**Props 接口**（必需）:
```typescript
interface ComponentProps {
    data: DataType;
    onAction: (id: string) => void;
}
```

**Tauri 命令类型**（必需）:
```typescript
const data = await invoke<DataType[]>('command_name', { param });
```

**禁止模式**:
- ❌ `any` 类型
- ❌ `@ts-ignore`
- ❌ 类型断言滥用

---

#### 国际化

**必需**: 所有用户可见文本必须国际化。

```tsx
const { t } = useTranslation();
return <button>{t('common.save')}</button>;
```

**翻译文件**: 同步更新 `zh.json` 和 `en.json`。

---

## 开发流程

### 1. 开发前

```bash
# 启动开发服务器
npm run tauri dev
```

---

### 2. 提交前检查

```bash
# TypeScript 类型检查
npm run build

# Rust 编译检查
cargo check --manifest-path src-tauri/Cargo.toml
```

---

### 3. 手动测试清单

- [ ] 功能在浅色模式和深色模式都正常
- [ ] 中英文翻译都已添加
- [ ] 错误场景有合理提示
- [ ] 加载状态正确显示

---

## 禁止模式汇总

| 类别 | 禁止模式 | 原因 |
|------|---------|------|
| TypeScript | `any` 类型 | 丢失类型安全 |
| TypeScript | `@ts-ignore` | 隐藏错误 |
| React | 条件调用 Hooks | 违反 Hook 规则 |
| React | 直接修改状态 | 破坏不可变性 |
| 样式 | 忘记深色模式 | 用户体验差 |
| i18n | 硬编码文本 | 无法国际化 |
| Tauri | 未指定 invoke 类型 | 类型不安全 |
| Tauri | 硬编码路径 | 跨平台问题 |

---

## 必需模式汇总

| 类别 | 必需模式 | 原因 |
|------|---------|------|
| TypeScript | Props 接口定义 | 类型安全 |
| React | 依赖数组完整 | 避免 Bug |
| 样式 | 深色模式支持 | 用户体验 |
| i18n | 使用 `t()` 函数 | 国际化支持 |
| 错误处理 | try-catch + 提示 | 用户体验 |
| 加载状态 | 显示 loading | 用户反馈 |

---

## 代码示例索引

### 组件示例
- **卡片组件**: `src/components/providers/ProviderCard.tsx`
- **页面组件**: `src/pages/Dashboard.tsx`
- **布局组件**: `src/components/layout/Layout.tsx`

---

### Store 示例
- **标准 Store**: `src/stores/useProviderStore.ts`
- **配置 Store**: `src/stores/useConfigStore.ts`
- **仪表盘 Store**: `src/stores/useDashboardStore.ts`

---

### Hooks 示例
- **异步操作**: `src/hooks/useHealthCheck.ts`

---

### 类型示例
- **业务模型**: `src/types/provider.ts`
- **枚举类型**: `src/types/app.ts`

---

## 参考文档

- **完整技术栈**: `CLAUDE.md` 第 4-18 行
- **项目约定**: `AGENTS.md`
- **TypeScript 配置**: `tsconfig.json`
- **路由定义**: `src/App.tsx`

---

## 规范维护

这些规范基于项目的实际代码模式生成，应保持与代码库同步。

**更新时机**:
- 引入新的技术栈组件
- 发现新的常见错误模式
- 团队约定发生变化

**更新方式**:
1. 修改对应的规范文档
2. 确保示例代码引用真实存在的文件
3. 更新本索引文件的状态

---

**语言**: 本项目规范使用中文编写，与团队沟通语言保持一致。
