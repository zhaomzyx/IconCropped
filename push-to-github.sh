#!/bin/bash
# 推送项目到 GitHub

cd /workspace/projects

echo "=================================="
echo "准备推送到 GitHub"
echo "=================================="

# 显示远程仓库
echo "远程仓库："
git remote -v

# 显示当前分支
echo -e "\n当前分支："
git branch

# 显示最近的提交
echo -e "\n最近的 3 次提交："
git log --oneline -3

# 检查工作区状态
echo -e "\n工作区状态："
git status --short

echo -e "\n=================================="
echo "准备推送..."
echo "=================================="

# 提示输入 PAT
if [ -z "$GITHUB_TOKEN" ]; then
    echo ""
    echo "请提供 GitHub Personal Access Token (PAT)"
    echo "如果没有，请按以下步骤创建："
    echo "  1. 访问：https://github.com/settings/tokens"
    echo "  2. 点击 'Generate new token (classic)'"
    echo "  3. 勾选 'repo' 权限"
    echo "  4. 复制生成的 token"
    echo ""
    read -p "请输入 PAT: " GITHUB_TOKEN
fi

if [ -z "$GITHUB_TOKEN" ]; then
    echo "✗ 未提供 PAT，无法推送"
    exit 1
fi

# 配置 Git 凭证
echo -e "\n正在配置 Git 凭证..."
git config credential.helper store
echo "https://${GITHUB_TOKEN}@github.com" > ~/.git-credentials
chmod 600 ~/.git-credentials

# 推送到 GitHub
echo ""
echo "正在推送到 GitHub..."
echo "仓库: https://github.com/zhaomzyx/IconCropped.git"
echo "分支: main"
echo ""

git push -u origin main

# 检查结果
if [ $? -eq 0 ]; then
    echo ""
    echo "=================================="
    echo "✓ 推送成功！"
    echo "=================================="
    echo ""
    echo "你现在可以访问："
    echo "  https://github.com/zhaomzyx/IconCropped"
    echo ""
    echo "后续同步操作："
    echo "  拉取最新代码：./sync-from-github.sh"
    echo "  推送修改：./sync-to-github.sh"
    echo ""
else
    echo ""
    echo "=================================="
    echo "✗ 推送失败"
    echo "=================================="
    echo ""
    echo "可能的原因："
    echo "  1. PAT 无效或权限不足"
    echo "  2. 网络问题"
    echo "  3. 仓库配置错误"
    echo ""
    echo "请检查错误信息并重试"
fi

# 清理凭证（可选，更安全）
# rm ~/.git-credentials
