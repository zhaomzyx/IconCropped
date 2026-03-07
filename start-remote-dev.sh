#!/bin/bash
# 沙箱远程开发环境启动脚本
# 用于启动 SSH 服务和开发环境

echo "=================================="
echo "沙箱远程开发环境启动脚本"
echo "=================================="

# 1. 检查并启动 SSH 服务
echo ""
echo "[1/3] 检查 SSH 服务..."
if pgrep -x "sshd" > /dev/null; then
    echo "✓ SSH 服务已运行"
else
    echo "✗ SSH 服务未运行，正在启动..."
    mkdir -p /run/sshd
    /usr/sbin/sshd -D &
    sleep 2

    if pgrep -x "sshd" > /dev/null; then
        echo "✓ SSH 服务启动成功"
    else
        echo "✗ SSH 服务启动失败"
    fi
fi

# 2. 显示连接信息
echo ""
echo "[2/3] 显示连接信息..."
echo "=================================="
echo "SSH 连接信息："
echo "  主机: $(hostname -I | awk '{print $1}')"
echo "  端口: 22"
echo "  用户: root"
echo "  密码: Developer123!"
echo "=================================="

# 3. 检查项目目录
echo ""
echo "[3/3] 检查项目目录..."
if [ -d "/workspace/projects" ]; then
    echo "✓ 项目目录存在: /workspace/projects"
    cd /workspace/projects
    echo "  当前工作目录: $(pwd)"
else
    echo "✗ 项目目录不存在: /workspace/projects"
fi

# 4. 显示端口监听状态
echo ""
echo "=================================="
echo "端口监听状态："
echo "----------------------------------"
ss -tuln | grep -E ":(22|5000|8080)" || echo "无相关端口监听"
echo "=================================="

echo ""
echo "=================================="
echo "启动完成！"
echo "=================================="
echo ""
echo "现在你可以："
echo "1. 使用 VS Code Remote - SSH 连接"
echo "2. 使用 VS Code Remote - Tunnels 连接"
echo "3. 访问 code-server Web 界面（如果已启动）"
echo ""
echo "开发服务器启动命令："
echo "  cd /workspace/projects"
echo "  pnpm run dev"
echo ""
