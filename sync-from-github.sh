#!/bin/bash
# 自动从 GitHub 拉取最新代码

cd /workspace/projects

echo "=================================="
echo "开始拉取最新代码"
echo "=================================="

# 保存当前分支名
CURRENT_BRANCH=$(git branch --show-current)

# 拉取最新代码
echo "正在拉取 origin/$CURRENT_BRANCH ..."
git pull origin $CURRENT_BRANCH

# 检查结果
if [ $? -eq 0 ]; then
    echo "✓ 拉取成功"

    # 检查是否有冲突
    if git status | grep -q "Unmerged paths"; then
        echo "⚠️ 警告：检测到合并冲突！"
        echo "冲突的文件："
        git status | grep "Unmerged paths" -A 20
    else
        echo "✓ 无冲突，代码已更新到最新版本"
    fi
else
    echo "✗ 拉取失败"
    echo "可能原因："
    echo "  - 网络问题"
    echo "  - 仓库配置错误"
    echo "  - 认证失败"
fi

echo "=================================="
echo "当前状态："
git log --oneline -3
echo "=================================="
