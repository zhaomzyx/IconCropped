const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

async function testCrop() {
  const imagePath = path.join(__dirname, 'public/WikiPic/Collection/wiki-1772694917387-15.png');
  console.log('测试图片路径:', imagePath);

  // 1. 获取图片信息
  const metadata = await sharp(imagePath).metadata();
  console.log('\n图片元数据:');
  console.log('尺寸:', metadata.width, 'x', metadata.height);

  // 2. 模拟调试页面计算的坐标（基于你的配置）
  const params = {
    panelLeftOffset: -28,
    panelTopOffset: 0,
    gridStartX: 69,
    gridStartY: 107,
    iconSize: 132,
    gapX: 14,
    gapY: 12,
  };

  console.log('\n参数配置:', params);

  // 3. 假设LLM识别到的第一个面板
  const panel = {
    title: 'Energy',
    x: 0,  // LLM识别的X
    y: 0,  // LLM识别的Y（会被滑动窗口覆盖）
    width: 670,  // 假设宽度
    rows: 1,
    cols: 5
  };

  // 4. 模拟滑动窗口扫描的结果（假设第一个面板在Y=300）
  const panelY = 300;

  // 5. 计算icon位置
  const panelX = panel.x + params.panelLeftOffset;
  console.log('\n面板坐标:');
  console.log('X:', panelX);
  console.log('Y:', panelY);

  const redBoxes = [];
  for (let col = 0; col < panel.cols; col++) {
    const x = panelX + params.gridStartX + col * (params.iconSize + params.gapX);
    const y = panelY + params.gridStartY;
    redBoxes.push({ x, y, width: params.iconSize, height: params.iconSize, col });
  }

  console.log('\n红框坐标（红框裁切区域）:');
  redBoxes.forEach((box, i) => {
    console.log(`Icon #${i + 1}: x=${box.x}, y=${box.y}, w=${box.width}, h=${box.height}`);
  });

  // 6. 实际裁切并查看结果
  console.log('\n实际裁切测试...');
  const outputDir = path.join(__dirname, 'public/wiki-cropped/test');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  for (let i = 0; i < redBoxes.length; i++) {
    const box = redBoxes[i];
    const outputPath = path.join(outputDir, `icon_${i + 1}.png`);

    try {
      await sharp(imagePath)
        .extract({
          left: Math.round(box.x),
          top: Math.round(box.y),
          width: Math.round(box.width),
          height: Math.round(box.height)
        })
        .png()
        .toFile(outputPath);

      console.log(`✓ 裁切 icon_${i + 1}.png 成功`);
    } catch (error) {
      console.error(`✗ 裁切 icon_${i + 1}.png 失败:`, error.message);
    }
  }

  console.log('\n裁切完成，请检查 public/wiki-cropped/test/ 目录');
}

testCrop().catch(console.error);
