#!/bin/bash
# 推送本地修改到 GitHub

cd /workspace/projects

echo "=================================="
echo "开始推送到 GitHub"
echo "=================================="

# 检查是否有修改
if [ -z "$(git status --porcelain)" ]; then
    echo "✓ 没有需要提交的修改"
    exit 0
fi

# 显示修改的文件
echo "修改的文件："
git status --short
echo ""

# 提示输入提交信息
read -p "请输入提交信息（留空使用默认）: " COMMIT_MSG

if [ -z "$COMMIT_MSG" ]; then
    COMMIT_MSG="update: $(date '+%Y-%m-%d %H:%M:%S')"
fi

# 添加所有修改
git add .

# 提交
git commit -m "$COMMIT_MSG"

# 推送
echo ""
echo "正在推送到 GitHub ..."
git push origin $(git branch --show-current)

if [ $? -eq 0 ]; then
    echo "✓ 推送成功"
else
    echo "✗ 推送失败"
    echo "可能需要手动解决冲突"
fi

echo "=================================="
