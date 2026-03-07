# projects

这是一个基于 [Next.js 16](https://nextjs.org) + [shadcn/ui](https://ui.shadcn.com) 的全栈应用项目，由扣子编程 CLI 创建。

## 📖 开发指南

### 🚀 方式 1：在沙箱中开发（推荐新手）
```bash
coze dev
```
启动后，在浏览器中打开 [http://localhost:5000](http://localhost:5000) 查看应用。

### 💻 方式 2：使用 VS Code 远程开发（推荐进阶用户）

你可以使用本地 VS Code 连接到沙箱环境进行开发，详见：
- [📋 远程开发指南](./REMOTE_DEV_GUIDE.md) - 详细的远程连接教程
- [🛠️ VS Code 配置](./VS_CODE_GUIDE.md) - VS Code 开发环境配置

#### SSH 连接信息
```
主机: 9.96.199.125
端口: 22
用户: root
密码: Developer123!
```

#### 快速启动远程开发环境
在沙箱终端运行：
```bash
./start-remote-dev.sh
```

### 🔧 方式 3：本地开发（需要复制文件）
将项目复制到本地，然后运行：
```bash
pnpm install
pnpm run dev
```

---

## 快速开始

### 启动开发服务器

```bash
coze dev
```

启动后，在浏览器中打开 [http://localhost:5000](http://localhost:5000) 查看应用。

开发服务器支持热更新，修改代码后页面会自动刷新。

### 构建生产版本

```bash
coze build
```

### 启动生产服务器

```bash
coze start
```

## 项目结构

```
src/
├── app/                      # Next.js App Router 目录
│   ├── layout.tsx           # 根布局组件
│   ├── page.tsx             # 首页
│   ├── globals.css          # 全局样式（包含 shadcn 主题变量）
│   └── [route]/             # 其他路由页面
├── components/              # React 组件目录
│   └── ui/                  # shadcn/ui 基础组件（优先使用）
│       ├── button.tsx
│       ├── card.tsx
│       └── ...
├── lib/                     # 工具函数库
│   └── utils.ts            # cn() 等工具函数
└── hooks/                   # 自定义 React Hooks（可选）
```

## 核心开发规范

### 1. 组件开发

**优先使用 shadcn/ui 基础组件**

本项目已预装完整的 shadcn/ui 组件库，位于 `src/components/ui/` 目录。开发时应优先使用这些组件作为基础：

```tsx
// ✅ 推荐：使用 shadcn 基础组件
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

export default function MyComponent() {
  return (
    <Card>
      <CardHeader>标题</CardHeader>
      <CardContent>
        <Input placeholder="输入内容" />
        <Button>提交</Button>
      </CardContent>
    </Card>
  );
}
```

**可用的 shadcn 组件清单**

- 表单：`button`, `input`, `textarea`, `select`, `checkbox`, `radio-group`, `switch`, `slider`
- 布局：`card`, `separator`, `tabs`, `accordion`, `collapsible`, `scroll-area`
- 反馈：`alert`, `alert-dialog`, `dialog`, `toast`, `sonner`, `progress`
- 导航：`dropdown-menu`, `menubar`, `navigation-menu`, `context-menu`
- 数据展示：`table`, `avatar`, `badge`, `hover-card`, `tooltip`, `popover`
- 其他：`calendar`, `command`, `carousel`, `resizable`, `sidebar`

详见 `src/components/ui/` 目录下的具体组件实现。

### 2. 路由开发

Next.js 使用文件系统路由，在 `src/app/` 目录下创建文件夹即可添加路由：

```bash
# 创建新路由 /about
src/app/about/page.tsx

# 创建动态路由 /posts/[id]
src/app/posts/[id]/page.tsx

# 创建路由组（不影响 URL）
src/app/(marketing)/about/page.tsx

# 创建 API 路由
src/app/api/users/route.ts
```

**页面组件示例**

```tsx
// src/app/about/page.tsx
import { Button } from '@/components/ui/button';

export const metadata = {
  title: '关于我们',
  description: '关于页面描述',
};

export default function AboutPage() {
  return (
    <div>
      <h1>关于我们</h1>
      <Button>了解更多</Button>
    </div>
  );
}
```

**动态路由示例**

```tsx
// src/app/posts/[id]/page.tsx
export default async function PostPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return <div>文章 ID: {id}</div>;
}
```

**API 路由示例**

```tsx
// src/app/api/users/route.ts
import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({ users: [] });
}

export async function POST(request: Request) {
  const body = await request.json();
  return NextResponse.json({ success: true });
}
```

### 3. 依赖管理

**必须使用 pnpm 管理依赖**

```bash
# ✅ 安装依赖
pnpm install

# ✅ 添加新依赖
pnpm add package-name

# ✅ 添加开发依赖
pnpm add -D package-name

# ❌ 禁止使用 npm 或 yarn
# npm install  # 错误！
# yarn add     # 错误！
```

项目已配置 `preinstall` 脚本，使用其他包管理器会报错。

### 4. 样式开发

**使用 Tailwind CSS v4**

本项目使用 Tailwind CSS v4 进行样式开发，并已配置 shadcn 主题变量。

```tsx
// 使用 Tailwind 类名
<div className="flex items-center gap-4 p-4 rounded-lg bg-background">
  <Button className="bg-primary text-primary-foreground">
    主要按钮
  </Button>
</div>

// 使用 cn() 工具函数合并类名
import { cn } from '@/lib/utils';

<div className={cn(
  "base-class",
  condition && "conditional-class",
  className
)}>
  内容
</div>
```

## 项目功能说明

本项目是一个合成游戏资源映射与可视化工具，用于分析竞品（如 Travel Town）的合成系统，解决本地资源混淆、数据形态不匹配、命名差异等痛点。

### 核心功能

1. **Wiki 图片裁切**：自动识别和裁切 Wiki 中的合成配方面板
2. **LLM 视觉识别**：使用大语言模型识别配方信息（物品名称、合成关系）
3. **数据映射**：将识别结果映射到本地游戏资源
4. **可视化调试**：提供调试台，可视化调整检测参数

### 算法方案

#### 1. Canvas 检测方案（调试台方案）

Canvas 检测方案是目前的核心检测方案，分为面板检测和图标定位两个部分。

**面板检测**
- **Y轴扫描**：检测面板的上下边界
- **X轴扫描**：检测面板的左右边界

**图标定位**
- 使用中心点间距计算图标位置
- 支持 `centerGapX`、`centerGapY` 参数
- 支持多行检测（`rows`、`cols`）
- 支持空图标过滤（颜色方差）

**特点**
- 可视化调试
- 参数可调节
- 精确的框体检测
- 支持复杂布局

#### 2. 工作台新方案

工作台新方案是对调试台方案的优化版本，职责分离更清晰。

**面板检测**
- 使用前端 Canvas 进行检测（与调试台完全一致）

**图标定位**
- 使用前端 Canvas 检测的坐标

**后端职责**
- 仅负责根据坐标裁切图片

**特点**
- 与调试台完全一致
- 支持空位检测
- 支持自定义参数

#### 3. 滑动窗口检测算法（新方案）

滑动窗口检测算法是一种基于颜色平均值的检测方法，用于更精确地检测多行多列的图标布局。

**红色横向矩形窗口（检测多行）**
- 宽度：整个面板宽度
- 高度：N 行（可调参数 `slidingWindowRows`）
- 计算窗口内的平均颜色
- 检测相邻窗口的颜色差异
- 中心点 Y 坐标作为行起始位置

**蓝色竖向矩形窗口（检测多列）**
- 高度：整个面板高度
- 宽度：M 列（可调参数 `slidingWindowCols`）
- 计算窗口内的平均颜色
- 检测相邻窗口的颜色差异
- 中心点 X 坐标作为列起始位置

**特点**
- 更精确的边界检测
- 减少噪点影响
- 参数可调（窗口大小、阈值、步长等）

**参数说明**
- `slidingWindowRows`：红色横向矩形窗口高度（N行）
- `slidingWindowCols`：蓝色竖向矩形窗口宽度（M列）
- `slidingWindowDiffThreshold`：滑动窗口颜色差异阈值
- `slidingWindowStepSize`：滑动窗口步长（像素）
- `slidingWindowMinGap`：最小行/列间距（像素）

### 页面说明

- **首页**：项目概览和快速开始指南
- **调试台** (`/debug`)：可视化调试工具，调整检测参数，实时查看检测结果
- **工作台** (`/workbench`)：批量处理 Wiki 图片，裁切和识别配方
- **Wiki集合** (`/wiki-collection`)：管理 Wiki 图片集合

### 技术栈

- **前端**：Next.js 16 (App Router), React 19, TypeScript 5, shadcn/ui, Tailwind CSS 4
- **后端**：Next.js API Routes
- **图片处理**：sharp
- **AI视觉识别**：coze-coding-dev-sdk (doubao-seed-1-6-vision-250815)
- **数据存储**：文件系统（public 目录）

### 开发指南

#### 添加新的检测算法

1. 在 `src/lib/` 目录下创建新的检测算法文件（如 `src/lib/new-detection.ts`）
2. 实现检测逻辑，返回检测到的坐标数据
3. 在调试台页面 (`src/app/debug/page.tsx`) 添加对应的 UI 参数控制
4. 在 `src/app/panel-detection.ts` 中添加对应的参数配置

#### 调试参数说明

调试台提供了丰富的参数调整功能，所有参数会自动保存到 LocalStorage。

**蓝框坐标（扫描线自动检测）**
- 蓝框坐标由扫描线自动检测，包括上下左右四个边界
- 无需手动调整参数
- 实时显示检测到的坐标和尺寸

**绿框相关**
- `gridStartY`：首个图标上边距（绿框高度）

**红框相关**
- `gridStartX`：首个图标左边距
- `iconSize`：图标边长尺寸
- `iconCenterOffsetX`：中心点 X 偏移
- `iconCenterOffsetY`：中心点 Y 偏移
- `centerGapX`：中心点横向间距
- `centerGapY`：中心点纵向间距

**扫描线相关（控制检测灵敏度）**
- `scanLineX`：扫描线 X 坐标
- `scanStartY`：扫描起始 Y 坐标
- `colorTolerance`：颜色容差值
- `sustainedPixels`：连续判定高度
- `colorToleranceX`：X轴颜色容差值
- `sustainedPixelsX`：X轴连续判定宽度

**滑动窗口检测相关**
- `slidingWindowRows`：窗口高度-行检测
- `slidingWindowCols`：窗口宽度-列检测
- `slidingWindowDiffThreshold`：颜色差异阈值
- `slidingWindowStepSize`：步长
- `slidingWindowMinGap`：最小间距

**注意**：
- 蓝框坐标完全由扫描线自动检测，不需要手动调整
- 扫描线相关参数控制检测灵敏度，影响蓝框检测的准确性
- 绿框和红框相关参数用于图标定位，需要根据实际情况调整

### 常见问题

**Q: 裁切结果不准确怎么办？**
A: 在调试台调整参数，实时查看检测结果，找到合适的参数组合后导出到工作台。

**Q: 如何保存和恢复参数？**
A: 参数会自动保存到 LocalStorage。也可以通过"导出配置"和"导入配置"功能保存和加载参数配置。

**Q: 滑动窗口检测和中心点检测有什么区别？**
A: 滑动窗口检测基于颜色平均值，适合检测多行多列的规则布局；中心点检测基于固定的间距，适合已知布局规律的场景。两种方法可以结合使用。

**Q: 为什么有时候检测不到图标？**
A: 可能的原因包括：
1. 颜色阈值设置过大或过小
2. 窗口大小不合适
3. 面板检测不准确
4. 图片质量较差或背景复杂

建议在调试台中逐步调整参数，找到最适合的配置。


**主题变量**

主题变量定义在 `src/app/globals.css` 中，支持亮色/暗色模式：

- `--background`, `--foreground`
- `--primary`, `--primary-foreground`
- `--secondary`, `--secondary-foreground`
- `--muted`, `--muted-foreground`
- `--accent`, `--accent-foreground`
- `--destructive`, `--destructive-foreground`
- `--border`, `--input`, `--ring`

### 5. 表单开发

推荐使用 `react-hook-form` + `zod` 进行表单开发：

```tsx
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const formSchema = z.object({
  username: z.string().min(2, '用户名至少 2 个字符'),
  email: z.string().email('请输入有效的邮箱'),
});

export default function MyForm() {
  const form = useForm({
    resolver: zodResolver(formSchema),
    defaultValues: { username: '', email: '' },
  });

  const onSubmit = (data: z.infer<typeof formSchema>) => {
    console.log(data);
  };

  return (
    <form onSubmit={form.handleSubmit(onSubmit)}>
      <Input {...form.register('username')} />
      <Input {...form.register('email')} />
      <Button type="submit">提交</Button>
    </form>
  );
}
```

### 6. 数据获取

**服务端组件（推荐）**

```tsx
// src/app/posts/page.tsx
async function getPosts() {
  const res = await fetch('https://api.example.com/posts', {
    cache: 'no-store', // 或 'force-cache'
  });
  return res.json();
}

export default async function PostsPage() {
  const posts = await getPosts();

  return (
    <div>
      {posts.map(post => (
        <div key={post.id}>{post.title}</div>
      ))}
    </div>
  );
}
```

**客户端组件**

```tsx
'use client';

import { useEffect, useState } from 'react';

export default function ClientComponent() {
  const [data, setData] = useState(null);

  useEffect(() => {
    fetch('/api/data')
      .then(res => res.json())
      .then(setData);
  }, []);

  return <div>{JSON.stringify(data)}</div>;
}
```

## 常见开发场景

### 添加新页面

1. 在 `src/app/` 下创建文件夹和 `page.tsx`
2. 使用 shadcn 组件构建 UI
3. 根据需要添加 `layout.tsx` 和 `loading.tsx`

### 创建业务组件

1. 在 `src/components/` 下创建组件文件（非 UI 组件）
2. 优先组合使用 `src/components/ui/` 中的基础组件
3. 使用 TypeScript 定义 Props 类型

### 添加全局状态

推荐使用 React Context 或 Zustand：

```tsx
// src/lib/store.ts
import { create } from 'zustand';

interface Store {
  count: number;
  increment: () => void;
}

export const useStore = create<Store>((set) => ({
  count: 0,
  increment: () => set((state) => ({ count: state.count + 1 })),
}));
```

### 集成数据库

推荐使用 Prisma 或 Drizzle ORM，在 `src/lib/db.ts` 中配置。

## 技术栈

- **框架**: Next.js 16.1.1 (App Router)
- **UI 组件**: shadcn/ui (基于 Radix UI)
- **样式**: Tailwind CSS v4
- **表单**: React Hook Form + Zod
- **图标**: Lucide React
- **字体**: Geist Sans & Geist Mono
- **包管理器**: pnpm 9+
- **TypeScript**: 5.x

## 参考文档

- [Next.js 官方文档](https://nextjs.org/docs)
- [shadcn/ui 组件文档](https://ui.shadcn.com)
- [Tailwind CSS 文档](https://tailwindcss.com/docs)
- [React Hook Form](https://react-hook-form.com)

## 重要提示

1. **必须使用 pnpm** 作为包管理器
2. **优先使用 shadcn/ui 组件** 而不是从零开发基础组件
3. **遵循 Next.js App Router 规范**，正确区分服务端/客户端组件
4. **使用 TypeScript** 进行类型安全开发
5. **使用 `@/` 路径别名** 导入模块（已配置）
