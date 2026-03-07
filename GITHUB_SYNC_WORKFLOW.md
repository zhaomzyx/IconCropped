# GitHub 双向同步工作流指南

## 🎯 工作流概览

```
┌─────────────┐         ┌─────────────┐         ┌─────────────┐
│  本地 VS    │  <-->   │  GitHub     │  <-->   │  沙箱环境   │
│  Code       │         │  仓库       │         │  (开发/测试) │
└─────────────┘         └─────────────┘         └─────────────┘
```

**核心原则**：
- GitHub 是中心仓库
- 本地和沙箱都可以推送/拉取
- 使用 Git 分支管理避免冲突

---

## 📋 完整工作流

### 场景 1：本地开发 → 推送到 GitHub → 沙箱同步

**步骤**：

#### 1. 本地编辑并推送
```bash
# 在你本地 VS Code / 终端

# 1. 编辑代码
# ...

# 2. 查看修改
git status

# 3. 添加修改
git add .

# 4. 提交
git commit -m "feat: 添加新功能"

# 5. 推送到 GitHub
git push origin main
```

#### 2. 沙箱拉取最新代码
```bash
# 在沙箱终端

# 方式 A：使用同步脚本（推荐）
./sync-from-github.sh

# 方式 B：手动拉取
cd /workspace/projects
git pull origin main

# 方式 C：使用 git fetch + merge
git fetch origin
git merge origin/main
```

#### 3. 沙箱测试
```bash
# 重启开发服务器（如果需要）
coze dev

# 或者直接刷新浏览器（如果开发服务器已在运行）
```

---

### 场景 2：沙箱开发 → 推送到 GitHub → 本地同步

**步骤**：

#### 1. 沙箱编辑并推送
```bash
# 在沙箱终端

# 1. 编辑代码（使用 nano/vim）
nano src/app/page.tsx

# 2. 提交修改
git add .
git commit -m "fix: 修复 bug"

# 3. 推送到 GitHub
git push origin main

# 或者使用脚本
./sync-to-github.sh
```

#### 2. 本地拉取最新代码
```bash
# 在你本地 VS Code / 终端

# 1. 拉取最新代码
git pull origin main

# 2. VS Code 会自动显示修改的文件
```

---

### 场景 3：同时修改 → 冲突解决

**当本地和沙箱同时修改同一个文件时**

#### 1. 一方先推送
```bash
# 假设本地先推送
git push origin main
```

#### 2. 另一方拉取时遇到冲突
```bash
# 沙箱拉取时遇到冲突
git pull origin main

# Git 会提示冲突
# Auto-merging src/app/page.tsx
# CONFLICT (content): Merge conflict in src/app/page.tsx
```

#### 3. 解决冲突
```bash
# 1. 查看冲突文件
git status

# 2. 编辑冲突文件（标记为 <<<<<<<, =======, >>>>>>>）
nano src/app/page.tsx

# 3. 手动解决冲突，删除标记

# 4. 标记为已解决
git add src/app/page.tsx

# 5. 完成合并
git commit -m "resolve: 解决合并冲突"

# 6. 推送到 GitHub
git push origin main
```

#### 4. 本地拉取合并后的代码
```bash
git pull origin main
```

---

## 🚀 推荐的协作策略

### 策略 A：分支开发（推荐）⭐⭐⭐⭐⭐

**避免冲突的最佳实践**

```bash
# 1. 创建新分支进行开发
git checkout -b feature/new-feature

# 2. 在分支上开发
# ...

# 3. 提交修改
git add .
git commit -m "feat: 添加新功能"

# 4. 推送分支到 GitHub
git push origin feature/new-feature

# 5. 在 GitHub 上创建 Pull Request

# 6. 合并到 main 分支

# 7. 删除分支
git checkout main
git pull origin main
git branch -d feature/new-feature
```

**优点**：
- ✅ 避免直接在 main 分支上修改
- ✅ 每个 feature 独立开发
- ✅ 代码审查（通过 PR）
- ✅ 容易回滚

---

### 策略 B：角色分工

**定义责任边界**

| 角色 | 职责 | 操作 |
|------|------|------|
| 本地开发 | 新功能开发、UI 调整 | 推送到 feature 分支 |
| 沙箱环境 | 测试、修复、部署 | 推送到 main 分支 |
| GitHub 仓库 | 版本发布、备份 | 接收推送、管理 PR |

---

## 🔄 自动化同步（可选）

### 设置自动拉取定时任务

```bash
# 编辑 crontab
crontab -e

# 添加以下行（每隔 5 分钟自动拉取）
*/5 * * * * /workspace/projects/sync-from-github.sh >> /tmp/sync.log 2>&1

# 或者每小时拉取一次
0 * * * * /workspace/projects/sync-from-github.sh >> /tmp/sync.log 2>&1
```

**查看同步日志**：
```bash
tail -f /tmp/sync.log
```

---

## 🛠️ 常用 Git 命令

### 查看状态
```bash
git status              # 查看工作区状态
git log --oneline -5    # 查看最近 5 次提交
git diff                # 查看未暂存的修改
git diff --staged       # 查看已暂存的修改
```

### 分支操作
```bash
git branch              # 查看所有分支
git branch -a           # 查看所有分支（包括远程）
git checkout <branch>   # 切换分支
git checkout -b <branch> # 创建并切换到新分支
git branch -d <branch>  # 删除分支
```

### 同步操作
```bash
git fetch origin        # 获取远程更新（不合并）
git pull origin main    # 拉取并合并
git push origin main    # 推送到远程
git push origin <branch> # 推送指定分支
```

### 冲突解决
```bash
git mergetool           # 使用图形工具解决冲突
git reset --hard HEAD   # 放弃所有本地修改（慎用）
git stash               # 暂存当前修改
git stash pop           # 恢复暂存的修改
```

---

## ⚠️ 注意事项

### 1. 避免同时修改同一文件
- **最佳实践**：使用分支开发
- **应急方案**：先沟通谁负责修改哪个文件

### 2. 提交前先拉取
```bash
git pull origin main    # 先拉取最新代码
git add .               # 再提交修改
git commit -m "..."
git push origin main    # 最后推送
```

### 3. 定期同步
- 本地：每天开始工作前 `git pull`
- 沙箱：测试前 `git pull`
- GitHub：定期查看提交历史

### 4. 备份重要数据
- 定期打标签：`git tag -a v1.0.0 -m "版本 1.0.0"`
- 推送标签：`git push origin --tags`

---

## 💡 最佳实践

### 1. 清晰的提交信息
```
✅ 好的提交信息：
- feat: 添加用户登录功能
- fix: 修复页面加载错误
- docs: 更新 README
- refactor: 重构检测算法

❌ 不好的提交信息：
- update
- fix bug
- 修改
```

### 2. 小步提交
- 每完成一个小功能就提交
- 不要累积太多修改
- 方便回滚和审查

### 3. 使用 .gitignore
```bash
# 忽略不需要版本控制的文件
node_modules/
.next/
*.log
.env.local
.DS_Store
```

### 4. 代码审查
- 使用 GitHub Pull Request
- 邀请他人审查代码
- 记录审查意见

---

## 📞 问题排查

### 问题 1：拉取时提示 "Already up to date"
**原因**：没有新代码
**解决**：正常，无需操作

### 问题 2：推送时提示 "Updates were rejected"
**原因**：远程有新的提交
**解决**：
```bash
git pull origin main    # 先拉取
git push origin main    # 再推送
```

### 问题 3：提示 "failed to push some refs"
**原因**：推送被拒绝（可能是权限或网络）
**解决**：
```bash
# 检查远程仓库配置
git remote -v

# 检查网络连接
ping github.com

# 检查凭证
git config --list | grep user
```

---

## 🎯 总结

**方案 2 的双向同步完全可行**，工作流如下：

1. ✅ 本地编辑 → 推送到 GitHub
2. ✅ 沙箱拉取 → 测试/部署
3. ✅ 沙箱修改 → 推送到 GitHub
4. ✅ 本地拉取 → 查看沙箱的修改

**推荐策略**：
- 使用分支开发避免冲突
- 定期同步保持最新
- 清晰的提交信息
- 代码审查保证质量

现在你可以放心使用方案 2 了！🎉
