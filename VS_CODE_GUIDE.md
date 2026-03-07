# VS Code 开发指南

这个项目已经配置好 VS Code 开发环境，你可以直接在本地使用 VS Code 编辑。

## 🚀 快速开始

### 1. 克隆或下载项目

将 `/workspace/projects` 目录下的所有文件复制到你的本地工作目录。

### 2. 安装依赖

```bash
pnpm install
```

### 3. 启动开发服务器

**方式一：使用 VS Code 任务**
1. 按 `Ctrl+Shift+P` (Windows/Linux) 或 `Cmd+Shift+P` (Mac)
2. 输入 "Tasks: Run Task"
3. 选择 "dev: 启动开发服务器"

**方式二：使用终端**
```bash
pnpm run dev
```

服务器将在 `http://localhost:5000` 启动。

### 4. 调试应用

**方式一：使用 VS Code 调试器**
1. 按 `F5` 或点击左侧调试图标
2. 选择调试配置：
   - `Next.js: debug server-side` - 调试服务端代码
   - `Next.js: debug client-side` - 调试客户端代码
   - `Next.js: debug full stack` - 全栈调试

**方式二：使用浏览器开发者工具**
1. 在浏览器中打开 `http://localhost:5000`
2. 按 `F12` 打开开发者工具
3. 在 "Sources" 标签中设置断点

## 📦 推荐扩展

VS Code 会自动提示安装以下扩展：

- **ESLint** - JavaScript/TypeScript 代码检查
- **Prettier** - 代码格式化
- **Tailwind CSS IntelliSense** - Tailwind CSS 自动补全
- **GitLens** - Git 增强功能
- **Import Cost** - 显示导入包的大小

## ⚙️ 项目配置

### ESLint
- 保存时自动修复代码问题
- 支持 TypeScript 和 JavaScript

### Prettier
- 保存时自动格式化代码
- 2 空格缩进
- 单引号

### Tailwind CSS
- 自动补全类名
- 支持动态类名（如 `cn()` 函数）

## 🔧 常用命令

| 命令 | 说明 |
|------|------|
| `pnpm run dev` | 启动开发服务器 |
| `pnpm run build` | 构建生产版本 |
| `pnpm run start` | 启动生产服务器 |
| `pnpm run lint` | 运行 ESLint 检查 |
| `npx tsc --noEmit` | TypeScript 类型检查 |

## 📁 项目结构

```
.
├── .vscode/           # VS Code 配置
│   ├── settings.json    # 编辑器设置
│   ├── extensions.json  # 推荐扩展
│   ├── launch.json      # 调试配置
│   └── tasks.json       # 任务配置
├── src/
│   ├── app/           # Next.js App Router
│   ├── components/    # React 组件
│   ├── lib/           # 工具函数
│   └── types/         # TypeScript 类型定义
├── public/            # 静态资源
└── package.json       # 项目配置
```

## 🐛 调试技巧

### 1. 服务端调试
- 在 API 路由文件中设置断点
- 使用 `Next.js: debug server-side` 配置
- 使用 `console.log()` 输出调试信息到终端

### 2. 客户端调试
- 在组件中设置断点
- 使用 `Next.js: debug client-side` 配置
- 使用浏览器开发者工具

### 3. 查看日志
- **服务端日志**：终端输出
- **客户端日志**：浏览器控制台
- **调试日志**：`/app/work/logs/bypass/app.log`

## 📝 代码风格

- 使用 2 空格缩进
- 使用单引号
- 保存时自动格式化
- 使用 ESLint 检查代码质量

## 🔗 相关文档

- [Next.js 文档](https://nextjs.org/docs)
- [React 文档](https://react.dev)
- [TypeScript 文档](https://www.typescriptlang.org/docs)
- [Tailwind CSS 文档](https://tailwindcss.com/docs)
- [shadcn/ui 文档](https://ui.shadcn.com)

## 💡 提示

1. **热重载**：修改代码后会自动刷新浏览器，无需重启服务器
2. **类型提示**：VS Code 会提供完整的 TypeScript 类型提示
3. **自动导入**：输入组件名时会自动添加 import 语句
4. **Git 集成**：使用 GitLens 可以查看文件历史和提交信息
