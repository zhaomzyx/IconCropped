# VS Code 远程开发指南

本指南介绍如何使用 VS Code 远程连接到沙箱开发环境。

## 🚀 方法选择

### 方法 1：VS Code Remote - SSH（推荐）
适合：熟悉 SSH、需要稳定连接的开发者
优点：功能完整、性能好
缺点：需要配置 SSH、可能需要端口转发

### 方法 2：VS Code Remote - Tunnels（最简单）
适合：希望快速连接、不熟悉 SSH 的开发者
优点：无需配置、使用 GitHub 账户
缺点：需要安装额外服务

### 方法 3：code-server（Web 版）
适合：需要从浏览器访问、不想安装 VS Code 的开发者
优点：无需本地安装、跨平台
缺点：功能略有限制

---

## 📋 方法 1：VS Code Remote - SSH

### 前置要求
- 本地安装了 VS Code
- 可以访问沙箱的 SSH 端口（22）
- 沙箱 SSH 服务已启动（✅ 已完成）

### 连接信息
```
主机: 9.96.199.125
端口: 22
用户名: root
密码: Developer123!
```

### 详细步骤

#### 步骤 1：安装 VS Code 扩展
在你的本地 VS Code 中：
1. 打开扩展面板（`Ctrl+Shift+X`）
2. 搜索 "Remote - SSH"
3. 安装微软官方扩展（ID: `ms-vscode-remote.remote-ssh`）

#### 步骤 2：配置 SSH 连接

**方式 A：使用 VS Code 命令面板**
1. 按 `Ctrl+Shift+P` 打开命令面板
2. 输入 `Remote-SSH: Connect to Host...`
3. 选择 `Add New SSH Host...`
4. 输入：`root@9.96.199.125`
5. 选择 SSH 配置文件位置（默认：`~/.ssh/config`）

**方式 B：手动编辑配置文件**
在你的本地终端执行：
```bash
# 编辑 SSH 配置文件
nano ~/.ssh/config
```

添加以下内容：
```
Host sandbox
    HostName 9.96.199.125
    User root
    Port 22
    StrictHostKeyChecking no
    UserKnownHostsFile /dev/null
    ServerAliveInterval 60
    ServerAliveCountMax 3
    Compression yes
```

保存并退出（`Ctrl+X`，然后 `Y`，然后 `Enter`）

#### 步骤 3：连接到沙箱
1. 在 VS Code 中按 `Ctrl+Shift+P`
2. 输入 `Remote-SSH: Connect to Host...`
3. 选择 `sandbox`（或直接输入 `root@9.96.199.125`）
4. 在弹出的窗口中输入密码：`Developer123!`
5. 等待连接建立（左下角会显示连接状态）

#### 步骤 4：打开项目
连接成功后：
1. 点击左侧资源管理器图标
2. 点击 `Open Folder`
3. 在弹出的对话框中输入：`/workspace/projects`
4. 点击 `OK`

#### 步骤 5：开始开发
- 📁 左侧资源管理器显示远程文件
- 🖥️ 终端连接到远程环境
- 🔍 搜索在远程文件中执行
- 🐛 调试在远程环境中运行
- ⚡ 编辑器自动同步文件更改

---

## 🌐 方法 2：VS Code Remote - Tunnels

### 前置要求
- 本地安装了 VS Code
- 拥有 GitHub 账户
- 可以访问互联网

### 详细步骤

#### 步骤 1：在沙箱中安装 code CLI
在沙箱终端执行：
```bash
# 下载 code CLI
curl -Lk 'https://code.visualstudio.com/sha/download?build=stable&os=cli-alpine-x64' --output vscode_cli.tar.gz

# 解压
tar -xf vscode_cli.tar.gz

# 移动到 PATH
sudo mv code /usr/local/bin/
```

#### 步骤 2：在沙箱中启动 tunnel
在沙箱终端执行：
```bash
# 登录 GitHub 账户（首次需要）
code tunnel login

# 启动 tunnel
code tunnel --accept-server-license-terms
```

这会显示一个连接 URL，类似：
```
Open this link in a browser: https://aka.ms/dev-tunnels/connect?access_token=xxx
```

#### 步骤 3：在本地 VS Code 中连接
1. 在浏览器中打开显示的 URL
2. 使用 GitHub 账户登录
3. 在 VS Code 中会提示连接到远程环境
4. 点击连接后即可开始使用

---

## 🌍 方法 3：code-server（Web 版 VS Code）

### 前置要求
- 可以访问沙箱的 HTTP 端口（8080）
- 现代浏览器

### 详细步骤

#### 步骤 1：在沙箱中安装 code-server
在沙箱终端执行：
```bash
curl -fsSL https://code-server.dev/install.sh | sh
```

#### 步骤 2：启动 code-server
在沙箱终端执行：
```bash
# 创建配置目录
mkdir -p ~/.config/code-server

# 设置密码
echo "bind-addr: 0.0.0.0:8080" > ~/.config/code-server/config.yaml
echo "auth: password" >> ~/.config/code-server/config.yaml
echo "password: Developer123!" >> ~/.config/code-server/config.yaml
echo "cert: false" >> ~/.config/code-server/config.yaml

# 启动 code-server（后台运行）
nohup ~/.local/bin/code-server > /tmp/code-server.log 2>&1 &
```

#### 步骤 3：访问 Web 版 VS Code
在浏览器中访问：
```
http://9.96.199.125:8080
```

输入密码：`Developer123!`

#### 步骤 4：打开项目
在 code-server 中：
1. 点击左侧资源管理器
2. 点击 `Open Folder`
3. 选择 `/workspace/projects`
4. 点击 `OK`

---

## 🔧 故障排除

### 问题 1：无法连接到 SSH
**症状**：VS Code 提示 "Connection refused" 或 "Host unreachable"

**解决方案**：
1. 检查沙箱 SSH 服务是否运行：
   ```bash
   ps aux | grep sshd | grep -v grep
   ```
2. 检查端口是否监听：
   ```bash
   ss -tuln | grep :22
   ```
3. 检查防火墙规则：
   ```bash
   iptables -L -n
   ```
4. 尝试使用平台提供的端口转发功能

### 问题 2：SSH 连接超时
**症状**：VS Code 提示 "Connection timed out"

**解决方案**：
1. 检查网络连接
2. 增加连接超时时间（在 SSH 配置中添加）：
   ```
   ConnectTimeout 60
   ```
3. 使用方法 2（Tunnels）或方法 3（code-server）

### 问题 3：密码验证失败
**症状**：VS Code 提示 "Authentication failed"

**解决方案**：
1. 确认密码正确：`Developer123!`
2. 检查 SSH 配置是否允许密码认证：
   ```bash
   grep PasswordAuthentication /etc/ssh/sshd_config
   ```
3. 检查 SSH 配置是否允许 root 登录：
   ```bash
   grep PermitRootLogin /etc/ssh/sshd_config
   ```

### 问题 4：无法访问 code-server Web 界面
**症状**：浏览器提示 "无法访问此网站"

**解决方案**：
1. 检查 code-server 是否运行：
   ```bash
   ps aux | grep code-server
   ```
2. 检查端口是否监听：
   ```bash
   ss -tuln | grep :8080
   ```
3. 检查 code-server 日志：
   ```bash
   tail -f /tmp/code-server.log
   ```

---

## 📝 快速命令参考

### 在沙箱中
```bash
# 检查 SSH 服务状态
service ssh status

# 重启 SSH 服务
pkill sshd && /usr/sbin/sshd -D &

# 查看进程
ps aux | grep sshd | grep -v grep

# 查看监听端口
ss -tuln | grep :22

# 修改 root 密码
echo 'root:你的密码' | chpasswd

# 启动 code-server
~/.local/bin/code-server --bind-addr 0.0.0.0:8080 --auth password

# 启动项目开发服务器
cd /workspace/projects
pnpm run dev
```

### 在本地 VS Code 中
```
Ctrl+Shift+P    # 打开命令面板
F5              # 启动调试
Ctrl+`          # 打开终端
Ctrl+Shift+E    # 切换到资源管理器
```

---

## 💡 提示

1. **保持连接活跃**：SSH 配置中已添加 `ServerAliveInterval` 防止超时
2. **使用密码管理器**：建议使用密码管理器保存 SSH 密码
3. **性能优化**：VS Code Remote 会自动优化远程文件操作
4. **断线重连**：网络中断后 VS Code 会自动重连
5. **扩展同步**：本地安装的扩展会在远程环境中自动安装

---

## 📞 需要帮助？

如果遇到问题：
1. 查看故障排除部分
2. 检查 VS Code 日志（`Help > Toggle Developer Tools`）
3. 检查沙箱终端日志
4. 尝试其他连接方法
