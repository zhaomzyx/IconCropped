#!/bin/bash
# 将沙箱项目打包并准备下载

echo "=================================="
echo "准备项目下载"
echo "=================================="

# 进入项目目录
cd /workspace/projects

# 创建临时打包目录
PACK_DIR="/tmp/projects-backup"
rm -rf "$PACK_DIR"
mkdir -p "$PACK_DIR"

echo "正在打包项目..."

# 排除不需要的文件（更完善的排除列表）
rsync -av --progress \
  --exclude 'node_modules' \
  --exclude '.next' \
  --exclude '.git' \
  --exclude 'dist' \
  --exclude 'build' \
  --exclude '.vscode' \
  --exclude '*.log' \
  --exclude '.DS_Store' \
  --exclude 'coverage' \
  --exclude '.cache' \
  --exclude '.parcel-cache' \
  --exclude '*.tgz' \
  --exclude '*.tar.gz' \
  . "$PACK_DIR/" 2>/dev/null || cp -r . "$PACK_DIR/"

# 创建压缩包
cd /tmp
tar -czf projects.tar.gz projects-backup/

echo ""
echo "=================================="
echo "✓ 打包完成！"
echo "=================================="
echo "文件位置: /tmp/projects.tar.gz"
echo "文件大小: $(du -h /tmp/projects.tar.gz | cut -f1)"
echo ""
echo "现在你可以通过 Coze 平台的文件下载功能下载此文件。"
echo ""
