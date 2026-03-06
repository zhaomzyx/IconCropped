/**
 * 滑动窗口检测测试脚本
 * 测试多行多列的图标布局检测
 */

import sharp from 'sharp';
import path from 'path';
import {
  detectRowsBySlidingWindow,
  detectColumnsBySlidingWindow,
  detectIconPositionsBySlidingWindow
} from '../src/lib/sliding-window-detection.ts';
import { cwd } from 'process';

async function testSlidingWindowDetection() {
  try {
    // 测试图片路径
    const imagePath = path.join(cwd(), 'public', 'WikiPic', 'Collection', 'wiki-1772694937500-17.png');

    console.log('读取测试图片:', imagePath);

    // 读取图片
    const imageBuffer = await sharp(imagePath).raw().toBuffer();
    const metadata = await sharp(imagePath).metadata();
    const width = metadata.width;
    const height = metadata.height;

    console.log(`图片尺寸: ${width}x${height}`);

    // 模拟检测到的面板区域（假设）
    const panelX = 47;
    const panelY = 242;
    const panelWidth = 879;
    const panelHeight = 468;

    console.log(`面板区域: (${panelX}, ${panelY}), 尺寸: ${panelWidth}x${panelHeight}`);

    // 滑动窗口参数
    const windowHeight = 20;      // N行：窗口高度
    const windowWidth = 20;       // M列：窗口宽度
    const diffThreshold = 30;     // 颜色差异阈值
    const stepSize = 5;           // 步长
    const minGap = 50;            // 最小间距

    console.log('\n=== 测试1: 检测多行（红色横向矩形窗口） ===');
    const rows = detectRowsBySlidingWindow(
      imageBuffer,
      width,
      panelX,
      panelY,
      panelWidth,
      panelHeight,
      windowHeight,
      diffThreshold,
      stepSize,
      minGap
    );

    console.log('\n=== 测试2: 检测多列（蓝色竖向矩形窗口） ===');
    const cols = detectColumnsBySlidingWindow(
      imageBuffer,
      width,
      panelX,
      panelY,
      panelWidth,
      panelHeight,
      windowWidth,
      diffThreshold,
      stepSize,
      minGap
    );

    console.log('\n=== 测试3: 综合检测（生成所有图标位置） ===');
    const icons = detectIconPositionsBySlidingWindow(
      imageBuffer,
      width,
      panelX,
      panelY,
      panelWidth,
      panelHeight,
      windowHeight,
      windowWidth,
      diffThreshold,
      stepSize
    );

    console.log('\n=== 检测结果 ===');
    console.log(`检测到 ${rows.length} 行:`, rows.map(r => ({ Y: r.centerY, diff: r.diffValue.toFixed(2) })));
    console.log(`检测到 ${cols.length} 列:`, cols.map(c => ({ X: c.centerX, diff: c.diffValue.toFixed(2) })));
    console.log(`生成 ${icons.length} 个图标位置:`);

    icons.forEach(icon => {
      console.log(`  [${icon.row}, ${icon.col}] 中心点: (${icon.centerX}, ${icon.centerY}), 差异值: ${icon.diffValue.toFixed(2)}`);
    });

    // 生成测试图片，标注检测结果
    const svgAnnotations = [];

    // 标注行（红色横向矩形窗口）
    rows.forEach(row => {
      svgAnnotations.push(`
        <rect x="${panelX}" y="${row.centerY - windowHeight / 2}" width="${panelWidth}" height="${windowHeight}"
          fill="none" stroke="red" stroke-width="2" stroke-dasharray="5,5" />
        <text x="${panelX + panelWidth + 10}" y="${row.centerY}" font-size="12" fill="red">
          Row ${row.rowIndex}: Y=${row.centerY}
        </text>
      `);
    });

    // 标注列（蓝色竖向矩形窗口）
    cols.forEach(col => {
      svgAnnotations.push(`
        <rect x="${col.centerX - windowWidth / 2}" y="${panelY}" width="${windowWidth}" height="${panelHeight}"
          fill="none" stroke="blue" stroke-width="2" stroke-dasharray="5,5" />
        <text x="${col.centerX}" y="${panelY - 10}" font-size="12" fill="blue" text-anchor="middle">
          Col ${col.colIndex}: X=${col.centerX}
        </text>
      `);
    });

    // 标注图标位置（绿色圆点）
    icons.forEach(icon => {
      svgAnnotations.push(`
        <circle cx="${icon.centerX}" cy="${icon.centerY}" r="5" fill="green" />
        <text x="${icon.centerX + 8}" y="${icon.centerY + 4}" font-size="10" fill="green">
          [${icon.row}, ${icon.col}]
        </text>
      `);
    });

    // 绘制 SVG 图片
    const svgContent = `
      <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
        <!-- 面板区域 -->
        <rect x="${panelX}" y="${panelY}" width="${panelWidth}" height="${panelHeight}"
          fill="none" stroke="yellow" stroke-width="2" />
        
        <!-- 标注 -->
        ${svgAnnotations.join('')}
      </svg>
    `;

    const svgBuffer = Buffer.from(svgContent);
    const outputImagePath = path.join(cwd(), 'public', 'test-sliding-window.png');

    await sharp(imagePath)
      .composite([{ input: svgBuffer, blend: 'over' }])
      .png()
      .toFile(outputImagePath);

    console.log(`\n测试图片已保存到: ${outputImagePath}`);

  } catch (error) {
    console.error('测试失败:', error);
    process.exit(1);
  }
}

// 运行测试
testSlidingWindowDetection();
