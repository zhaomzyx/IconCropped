/**
 * 滑动窗口检测算法
 * 用于检测多行多列的图标布局
 */

import { Buffer } from 'buffer';

// 颜色差异计算
function colorDiff(color1: [number, number, number], color2: [number, number, number]): number {
  return Math.max(
    Math.abs(color1[0] - color2[0]),
    Math.abs(color1[1] - color2[1]),
    Math.abs(color1[2] - color2[2])
  );
}

// 获取像素颜色
function getPixelColor(pixelData: Buffer, width: number, x: number, y: number): [number, number, number] {
  const index = (y * width + x) * 4;
  return [pixelData[index], pixelData[index + 1], pixelData[index + 2]];
}

// 计算区域的平均颜色
function getAverageColor(
  pixelData: Buffer,
  width: number,
  startX: number,
  startY: number,
  windowWidth: number,
  windowHeight: number
): [number, number, number] {
  let rSum = 0, gSum = 0, bSum = 0;
  let count = 0;

  for (let y = startY; y < startY + windowHeight; y++) {
    for (let x = startX; x < startX + windowWidth; x++) {
      const index = (y * width + x) * 4;
      rSum += pixelData[index];
      gSum += pixelData[index + 1];
      bSum += pixelData[index + 2];
      count++;
    }
  }

  return [rSum / count, gSum / count, bSum / count];
}

// 计算两个区域之间的颜色差异（滑动窗口）
function calculateRegionDiff(
  pixelData: Buffer,
  width: number,
  windowX: number,
  windowY: number,
  windowWidth: number,
  windowHeight: number,
  direction: 'horizontal' | 'vertical',
  stepSize: number = 1
): number {
  // 获取当前窗口的平均颜色
  const currentColor = getAverageColor(pixelData, width, windowX, windowY, windowWidth, windowHeight);

  // 获取相邻窗口的平均颜色
  let nextX = windowX;
  let nextY = windowY;

  if (direction === 'horizontal') {
    nextX += stepSize;
  } else {
    nextY += stepSize;
  }

  const nextColor = getAverageColor(pixelData, width, nextX, nextY, windowWidth, windowHeight);

  // 计算颜色差异
  return colorDiff(currentColor, nextColor);
}

// 滑动窗口检测 - 多行检测（红色横向矩形窗口）
export interface RowDetectionResult {
  centerY: number;          // 窗口中心点的Y坐标
  rowIndex: number;         // 行索引（从0开始）
  diffValue: number;        // 颜色差异值
}

export function detectRowsBySlidingWindow(
  pixelData: Buffer,
  imageWidth: number,
  panelX: number,
  panelY: number,
  panelWidth: number,
  panelHeight: number,
  windowHeight: number,     // N行：窗口高度
  diffThreshold: number,    // 颜色差异阈值
  stepSize: number = 1,     // 步长（像素）
  minGap: number = 50       // 最小行间距（像素）
): RowDetectionResult[] {
  console.log(`[滑动窗口检测-行] 开始扫描...`);
  console.log(`  面板位置: (${panelX}, ${panelY}), 尺寸: ${panelWidth}x${panelHeight}`);
  console.log(`  窗口高度: ${windowHeight}px, 阈值: ${diffThreshold}, 步长: ${stepSize}px`);

  const results: RowDetectionResult[] = [];
  let lastRowY = -Infinity;

  // 从上到下扫描
  for (let y = panelY; y <= panelY + panelHeight - windowHeight; y += stepSize) {
    // 计算当前窗口与相邻窗口的颜色差异
    const diffValue = calculateRegionDiff(
      pixelData,
      imageWidth,
      panelX,                  // X：从面板左侧开始
      y,                       // Y：当前扫描位置
      panelWidth,              // 窗口宽度：整个面板宽度
      windowHeight,            // 窗口高度：N行
      'vertical',              // 方向：垂直（上下滑动）
      stepSize
    );

    // 触发条件：颜色差异超过阈值
    if (diffValue > diffThreshold) {
      const centerY = y + Math.floor(windowHeight / 2);

      // 检查是否与上一行足够远（避免重复检测）
      if (centerY - lastRowY >= minGap) {
        results.push({
          centerY,
          rowIndex: results.length,
          diffValue
        });

        lastRowY = centerY;
        console.log(`  检测到第 ${results.length} 行: Y=${centerY}, 差异值=${diffValue.toFixed(2)}`);

        // 跳过窗口大小的区域，避免重复检测
        y += windowHeight;
      }
    }
  }

  console.log(`[滑动窗口检测-行] 完成，共检测到 ${results.length} 行`);
  return results;
}

// 滑动窗口检测 - 多列检测（蓝色竖向矩形窗口）
export interface ColumnDetectionResult {
  centerX: number;          // 窗口中心点的X坐标
  colIndex: number;         // 列索引（从0开始）
  diffValue: number;        // 颜色差异值
}

export function detectColumnsBySlidingWindow(
  pixelData: Buffer,
  imageWidth: number,
  panelX: number,
  panelY: number,
  panelWidth: number,
  panelHeight: number,
  windowWidth: number,      // M列：窗口宽度
  diffThreshold: number,    // 颜色差异阈值
  stepSize: number = 1,     // 步长（像素）
  minGap: number = 50       // 最小列间距（像素）
): ColumnDetectionResult[] {
  console.log(`[滑动窗口检测-列] 开始扫描...`);
  console.log(`  面板位置: (${panelX}, ${panelY}), 尺寸: ${panelWidth}x${panelHeight}`);
  console.log(`  窗口宽度: ${windowWidth}px, 阈值: ${diffThreshold}, 步长: ${stepSize}px`);

  const results: ColumnDetectionResult[] = [];
  let lastColX = -Infinity;

  // 从左到右扫描
  for (let x = panelX; x <= panelX + panelWidth - windowWidth; x += stepSize) {
    // 计算当前窗口与相邻窗口的颜色差异
    const diffValue = calculateRegionDiff(
      pixelData,
      imageWidth,
      x,                       // X：当前扫描位置
      panelY,                  // Y：从面板顶部开始
      windowWidth,             // 窗口宽度：M列
      panelHeight,             // 窗口高度：整个面板高度
      'horizontal',            // 方向：水平（左右滑动）
      stepSize
    );

    // 触发条件：颜色差异超过阈值
    if (diffValue > diffThreshold) {
      const centerX = x + Math.floor(windowWidth / 2);

      // 检查是否与上一列足够远（避免重复检测）
      if (centerX - lastColX >= minGap) {
        results.push({
          centerX,
          colIndex: results.length,
          diffValue
        });

        lastColX = centerX;
        console.log(`  检测到第 ${results.length} 列: X=${centerX}, 差异值=${diffValue.toFixed(2)}`);

        // 跳过窗口大小的区域，避免重复检测
        x += windowWidth;
      }
    }
  }

  console.log(`[滑动窗口检测-列] 完成，共检测到 ${results.length} 列`);
  return results;
}

// 综合检测：生成所有图标的位置
export interface IconPosition {
  centerX: number;
  centerY: number;
  row: number;
  col: number;
  diffValue: number;
}

export function detectIconPositionsBySlidingWindow(
  pixelData: Buffer,
  imageWidth: number,
  panelX: number,
  panelY: number,
  panelWidth: number,
  panelHeight: number,
  windowHeight: number,     // N行：窗口高度
  windowWidth: number,      // M列：窗口宽度
  diffThreshold: number,    // 颜色差异阈值
  stepSize: number = 1
): IconPosition[] {
  // 检测多行
  const rows = detectRowsBySlidingWindow(
    pixelData,
    imageWidth,
    panelX,
    panelY,
    panelWidth,
    panelHeight,
    windowHeight,
    diffThreshold,
    stepSize
  );

  // 检测多列
  const cols = detectColumnsBySlidingWindow(
    pixelData,
    imageWidth,
    panelX,
    panelY,
    panelWidth,
    panelHeight,
    windowWidth,
    diffThreshold,
    stepSize
  );

  // 生成所有图标的位置
  const icons: IconPosition[] = [];
  for (const row of rows) {
    for (const col of cols) {
      icons.push({
        centerX: col.centerX,
        centerY: row.centerY,
        row: row.rowIndex,
        col: col.colIndex,
        diffValue: Math.max(row.diffValue, col.diffValue)
      });
    }
  }

  console.log(`[滑动窗口检测] 综合检测完成，共生成 ${icons.length} 个图标位置`);
  return icons;
}
