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
  minGap: number = 50,      // 最小列间距（像素）
  rowY?: number,            // 🌟 新增：行的起始Y坐标（限制检测范围）
  rowHeight?: number        // 🌟 新增：行的高度（限制检测范围）
): ColumnDetectionResult[] {
  console.log(`[滑动窗口检测-列] 开始扫描...`);
  
  // 🌟 优化：如果指定了行范围，使用行范围，否则使用整个面板范围
  const scanY = rowY !== undefined ? rowY : panelY;
  const scanHeight = rowHeight !== undefined ? rowHeight : panelHeight;
  
  console.log(`  面板位置: (${panelX}, ${panelY}), 尺寸: ${panelWidth}x${panelHeight}`);
  console.log(`  检测范围: Y=${scanY}, 高度=${scanHeight}`);
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
      scanY,                   // 🌟 使用行范围的起始Y坐标
      windowWidth,             // 窗口宽度：M列
      scanHeight,              // 🌟 使用行的高度
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

  console.log(`[滑动窗口检测] 检测到 ${rows.length} 行，开始对每一行单独检测列...`);

  // 🌟 修改：对每一行单独检测列，而不是在整个面板范围内检测列
  const icons: IconPosition[] = [];
  for (const row of rows) {
    // 计算行的范围
    const rowY = Math.max(panelY, row.centerY - Math.floor(windowHeight / 2));
    const rowHeight = windowHeight;

    // 在当前行的高度范围内检测列
    const cols = detectColumnsBySlidingWindow(
      pixelData,
      imageWidth,
      panelX,
      panelY,
      panelWidth,
      panelHeight,
      windowWidth,
      diffThreshold,
      stepSize,
      rowY,      // 🌟 传递行的起始Y坐标
      rowHeight  // 🌟 传递行的高度
    );

    console.log(`[滑动窗口检测] 行 ${row.rowIndex} (Y=${row.centerY}) 检测到 ${cols.length} 列`);

    // 生成当前行的所有图标位置
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

// ========== 边界检测方法（新） ==========

// 计算区域的颜色方差（用于检测内容与背景）
export function calculateVariance(
  pixelData: Buffer,
  width: number,
  startX: number,
  startY: number,
  windowWidth: number,
  windowHeight: number
): number {
  let rSum = 0, gSum = 0, bSum = 0;
  let count = 0;
  const pixels = [];

  // 计算平均值
  for (let y = startY; y < startY + windowHeight; y++) {
    for (let x = startX; x < startX + windowWidth; x++) {
      const index = (y * width + x) * 4;
      const r = pixelData[index];
      const g = pixelData[index + 1];
      const b = pixelData[index + 2];
      pixels.push({ r, g, b });
      rSum += r;
      gSum += g;
      bSum += b;
      count++;
    }
  }

  if (count === 0) return 0;

  const rAvg = rSum / count;
  const gAvg = gSum / count;
  const bAvg = bSum / count;

  // 计算方差
  let variance = 0;
  for (const p of pixels) {
    variance += Math.pow(p.r - rAvg, 2) + Math.pow(p.g - gAvg, 2) + Math.pow(p.b - bAvg, 2);
  }
  variance = variance / count;

  return variance;
}

// 行边界检测结果
export interface RowBounds {
  topY: number;        // 行顶点的Y坐标
  bottomY: number;     // 行底点的Y坐标
  rowIndex: number;    // 行索引（从0开始）
  height: number;      // 行高度
}

/**
 * 纵向边界检测 - 检测行的边界
 * 
 * 算法说明：
 * 1. 使用滑动窗口在Y轴上扫描
 * 2. 计算每个窗口内的颜色方差（波动）
 * 3. 检测临界点：
 *    - 方差小 → 方差大：行顶点（进入行区域）
 *    - 方差大 → 方差小：行底点（离开行区域）
 * 4. 过滤噪声（最小行高）
 */
export function detectRowBounds(
  pixelData: Buffer,
  imageWidth: number,
  panelX: number,
  panelY: number,
  panelWidth: number,
  panelHeight: number,
  windowHeight: number = 5,        // 检测窗口高度（较小，用于检测单行）
  varianceThreshold: number = 50,  // 颜色方差阈值，判断是否为行区域
  stepSize: number = 1,            // 扫描步长（像素）
  minRowHeight: number = 20        // 最小行高（过滤噪声）
): RowBounds[] {
  console.log(`[边界检测-纵向] 开始扫描...`);
  console.log(`  面板位置: (${panelX}, ${panelY}), 尺寸: ${panelWidth}x${panelHeight}`);
  console.log(`  窗口高度: ${windowHeight}px, 方差阈值: ${varianceThreshold}, 步长: ${stepSize}px`);
  console.log(`  最小行高: ${minRowHeight}px`);

  const rows: RowBounds[] = [];
  let inRow = false;
  let currentTopY = 0;

  // 从上到下扫描
  for (let y = panelY; y <= panelY + panelHeight; y += stepSize) {
    // 计算当前Y位置的方差
    const variance = calculateVariance(
      pixelData,
      imageWidth,
      panelX,
      y,
      panelWidth,
      windowHeight
    );

    // 检测临界点
    if (variance > varianceThreshold) {
      // 进入行区域（波动大）
      if (!inRow) {
        inRow = true;
        currentTopY = y;  // 记录顶点
        console.log(`  检测到行顶点: Y=${currentTopY}, 方差=${variance.toFixed(2)}`);
      }
    } else {
      // 离开行区域（波动小）
      if (inRow) {
        inRow = false;
        const rowHeight = y - currentTopY;

        // 过滤噪声：只有行高足够才记录
        if (rowHeight >= minRowHeight) {
          rows.push({
            topY: currentTopY,
            bottomY: y,
            rowIndex: rows.length,
            height: rowHeight
          });
          console.log(`  检测到行底点: Y=${y}, 行高=${rowHeight}px`);
        } else {
          console.log(`  忽略噪声行: 行高=${rowHeight}px < 最小行高=${minRowHeight}px`);
        }
      }
    }
  }

  console.log(`[边界检测-纵向] 完成，共检测到 ${rows.length} 行`);
  return rows;
}
// 列边界检测结果
export interface ColumnBounds {
  leftX: number;        // 列左边界的X坐标
  rightX: number;       // 列右边界的X坐标
  colIndex: number;     // 列索引（从0开始）
  width: number;        // 列宽度
}

/**
 * 横向边界检测 - 检测列的边界
 *
 * 算法说明：
 * 1. 使用滑动窗口在X轴上扫描
 * 2. 计算每个窗口内的颜色方差（波动）
 * 3. 检测临界点：
 *    - 方差小 → 方差大：列左边界（进入列区域）
 *    - 方差大 → 方差小：列右边界（离开列区域）
 * 4. 过滤噪声（最小列宽）
 *
 * 关键改进：
 * - 使用 scanHeight 参数指定扫描高度（通常为单行高度）
 * - 避免多行颜色变化的影响，提高列检测准确性
 */
export function detectColumnBounds(
  pixelData: Buffer,
  imageWidth: number,
  panelX: number,
  panelY: number,
  panelWidth: number,
  panelHeight: number,
  windowWidth: number = 5,        // 检测窗口宽度（较小，用于检测单列）
  varianceThreshold: number = 50, // 颜色方差阈值，判断是否为列区域
  stepSize: number = 1,           // 扫描步长（像素）
  minColWidth: number = 20,       // 最小列宽（过滤噪声）
  scanHeight?: number             // 扫描高度（可选，如果不指定则使用整个panel高度）
): ColumnBounds[] {
  console.log(`[边界检测-横向] 开始扫描...`);
  console.log(`  面板位置: (${panelX}, ${panelY}), 尺寸: ${panelWidth}x${panelHeight}`);
  console.log(`  窗口宽度: ${windowWidth}px, 方差阈值: ${varianceThreshold}, 步长: ${stepSize}px`);
  console.log(`  最小列宽: ${minColWidth}px`);
  console.log(`  扫描高度: ${scanHeight || panelHeight}px ${scanHeight ? '(基于单行高度)' : '(整个panel高度)'}`);

  const cols: ColumnBounds[] = [];
  let inCol = false;
  let currentLeftX = 0;

  // 使用扫描高度（如果指定），否则使用整个panel高度
  const effectiveScanHeight = scanHeight || panelHeight;

  // 从左到右扫描
  for (let x = panelX; x <= panelX + panelWidth; x += stepSize) {
    // 计算当前X位置的方差（只在扫描高度范围内）
    const variance = calculateVariance(
      pixelData,
      imageWidth,
      x,
      panelY,
      windowWidth,
      effectiveScanHeight
    );

    // 检测临界点
    if (variance > varianceThreshold) {
      // 进入列区域（波动大）
      if (!inCol) {
        inCol = true;
        currentLeftX = x;  // 记录左边界
        console.log(`  检测到列左边界: X=${currentLeftX}, 方差=${variance.toFixed(2)}`);
      }
    } else {
      // 离开列区域（波动小）
      if (inCol) {
        inCol = false;
        const colWidth = x - currentLeftX;

        // 过滤噪声：只有列宽足够才记录
        if (colWidth >= minColWidth) {
          cols.push({
            leftX: currentLeftX,
            rightX: x,
            colIndex: cols.length,
            width: colWidth
          });
          console.log(`  检测到列右边界: X=${x}, 列宽=${colWidth}px`);
        } else {
          console.log(`  忽略噪声列: 列宽=${colWidth}px < 最小列宽=${minColWidth}px`);
        }
      }
    }
  }

  console.log(`[边界检测-横向] 完成，共检测到 ${cols.length} 列`);
  return cols;
}
// 边界检测结果
export interface BoundsResult {
  rows: RowBounds[];
  cols: ColumnBounds[];
}

/**
 * 综合检测 - 检测所有行和列的边界
 *
 * 结合纵向和横向检测结果，提供完整的边界信息
 *
 * 关键改进：
 * - 先检测行
 * - 使用第一行的高度作为列检测的扫描高度
 * - 这样列检测只在单行的高度范围内进行，避免多行颜色变化的影响
 */
export function detectAllBounds(
  pixelData: Buffer,
  imageWidth: number,
  panelX: number,
  panelY: number,
  panelWidth: number,
  panelHeight: number,
  params?: {
    windowHeight?: number;
    windowWidth?: number;
    varianceThresholdRow?: number;  // 行检测的方差阈值
    varianceThresholdCol?: number;  // 列检测的方差阈值
    stepSize?: number;
    minRowHeight?: number;
    minColWidth?: number;
  }
): BoundsResult {
  const {
    windowHeight = 5,
    windowWidth = 5,
    varianceThresholdRow = 50,  // 默认行检测阈值
    varianceThresholdCol = 50,  // 默认列检测阈值
    stepSize = 1,
    minRowHeight = 20,
    minColWidth = 20
  } = params || {};

  console.log(`[边界检测-综合] 开始综合检测...`);
  console.log(`  行检测方差阈值: ${varianceThresholdRow}, 列检测方差阈值: ${varianceThresholdCol}`);

  // 纵向检测（行）
  const rows = detectRowBounds(
    pixelData,
    imageWidth,
    panelX,
    panelY,
    panelWidth,
    panelHeight,
    windowHeight,
    varianceThresholdRow,  // 使用行检测专用阈值
    stepSize,
    minRowHeight
  );

  // 🌟 单行布局兜底逻辑：如果行检测失败，尝试假设只有 1 行
  let effectiveRows = rows;
  let scanHeight: number | undefined;
  
  if (rows.length === 0) {
    console.warn(`[边界检测-综合] 未检测到行，尝试单行布局兜底逻辑`);
    // 假设整个 panel 为 1 行
    effectiveRows = [{
      topY: panelY,
      bottomY: panelY + panelHeight,
      rowIndex: 0,
      height: panelHeight
    }];
    scanHeight = panelHeight;
    console.log(`[边界检测-综合] 单行布局兜底：假设 1 行，行高=${panelHeight}px`);
  } else {
    // 确定列检测的扫描高度
    // 优先使用第一行的高度
    scanHeight = rows[0].height;
    console.log(`[边界检测-综合] 使用第一行高度作为列扫描高度: ${scanHeight}px`);
  }

  // 横向检测（列）
  const cols = detectColumnBounds(
    pixelData,
    imageWidth,
    panelX,
    panelY,
    panelWidth,
    panelHeight,
    windowWidth,
    varianceThresholdCol,  // 使用列检测专用阈值
    stepSize,
    minColWidth,
    scanHeight  // 使用扫描高度
  );

  const result = { rows: effectiveRows, cols };
  console.log(`[边界检测-综合] 完成，共检测到 ${effectiveRows.length} 行 × ${cols.length} 列`);

  return result;
}

/**
 * 基于边界检测计算图标位置
 * 
 * 使用边界检测结果（rowBounds + colBounds）计算图标的位置
 */
export interface IconBoundsPosition {
  leftX: number;         // 图标左边界
  topY: number;          // 图标顶边界
  rightX: number;        // 图标右边界
  bottomY: number;       // 图标底边界
  centerX: number;       // 图标中心X
  centerY: number;       // 图标中心Y
  width: number;         // 图标宽度
  height: number;        // 图标高度
  row: number;           // 行索引
  col: number;           // 列索引
}

export function calculateIconPositionsFromBounds(
  bounds: BoundsResult
): IconBoundsPosition[] {
  const icons: IconBoundsPosition[] = [];

  for (const row of bounds.rows) {
    for (const col of bounds.cols) {
      const width = col.width;
      const height = row.height;
      const centerX = col.leftX + Math.floor(width / 2);
      const centerY = row.topY + Math.floor(height / 2);

      icons.push({
        leftX: col.leftX,
        topY: row.topY,
        rightX: col.rightX,
        bottomY: row.bottomY,
        centerX,
        centerY,
        width,
        height,
        row: row.rowIndex,
        col: col.colIndex
      });
    }
  }

  console.log(`[边界检测-计算] 从边界生成 ${icons.length} 个图标位置`);
  return icons;
}

// ========== 宽度归一化 ==========

/**
 * 归一化的面板信息
 */
export interface NormalizedPanelInfo {
  panelIndex: number;
  oldWidth: number;
  newWidth: number;
  title: string;
}

/**
 * 检测到的面板接口（用于归一化）
 */
export interface NormalizablePanel {
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
  blueBox: { x: number; y: number; width: number; height: number };
  greenBox: { x: number; y: number; width: number; height: number };
  originalWidth?: number; // 归一化前的原始宽度（可选）
}

/**
 * 宽度归一化结果
 */
export interface NormalizationResult {
  applied: boolean;
  targetWidth: number | null;
  affectedCount: number;
  normalizedPanels: NormalizedPanelInfo[];
}

/**
 * 🌟 宽度归一化函数（强制归一化所有面板）
 * 统计所有面板的宽度，找出出现频率最高的宽度，然后将所有面板归一化为该宽度
 *
 * 归一化逻辑：
 * 1. 统计所有面板的宽度分布
 * 2. 找出出现频率最高的宽度（容差±10）
 * 3. 强制将所有面板设置为目标宽度，不管原始宽度差异多少
 *
 * @param panels - 检测到的所有面板
 * @returns 归一化结果（是否应用、目标宽度、影响数量、归一化详情）
 */
export function normalizePanelWidths(
  panels: NormalizablePanel[],
  imageWidth?: number
): NormalizationResult {
  console.log('='.repeat(60));
  console.log('[normalizePanelWidths] 🎯 开始宽度归一化分析');
  if (imageWidth) {
    console.log(`[normalizePanelWidths] 📐 图片宽度: ${imageWidth}px`);
  }
  console.log('='.repeat(60));

  if (panels.length === 0) {
    console.log('[normalizePanelWidths] ❌ 没有面板需要归一化');
    return {
      applied: false,
      targetWidth: null,
      affectedCount: 0,
      normalizedPanels: []
    };
  }

  // 1. 提取所有面板的宽度
  const widths = panels.map(p => p.width);
  console.log(`[normalizePanelWidths] 📊 原始宽度分布 (${panels.length} 个面板):`);
  console.log(`  数值: [${widths.join(', ')}]`);
  console.log(`  范围: ${Math.min(...widths)}px ~ ${Math.max(...widths)}px`);
  console.log(`  平均: ${(widths.reduce((a, b) => a + b, 0) / widths.length).toFixed(1)}px`);

  // 2. 统计每个宽度的出现频率（容差±10）
  const widthFrequency = new Map<number, number>();
  const tolerance = 10; // 容差±10

  console.log(`[normalizePanelWidths] 🔍 统计宽度频率（容差±${tolerance}px）...`);

  for (let i = 0; i < widths.length; i++) {
    const width = widths[i];
    let found = false;

    // 检查是否已经在某个容差范围内
    for (const [baseWidth, count] of widthFrequency) {
      if (Math.abs(width - baseWidth) <= tolerance) {
        widthFrequency.set(baseWidth, count + 1);
        found = true;
        console.log(`  Panel ${i + 1}: ${width}px → 归入 ${baseWidth}px 分组（第 ${count + 1} 个）`);
        break;
      }
    }

    // 如果没有找到匹配的容差范围，创建新的分组
    if (!found) {
      widthFrequency.set(width, 1);
      console.log(`  Panel ${i + 1}: ${width}px → 创建新分组`);
    }
  }

  console.log(`[normalizePanelWidths] 📈 宽度频率统计结果（容差±${tolerance}px）:`);
  let maxCount = 0;
  for (const [baseWidth, count] of Array.from(widthFrequency.entries()).sort((a, b) => b[1] - a[1])) {
    const percentage = (count / panels.length * 100).toFixed(1);
    console.log(`  ${baseWidth}px: ${count} 个面板 (${percentage}%) ${count > maxCount ? '🔥' : ''}`);
    if (count > maxCount) {
      maxCount = count;
    }
  }

  // 3. 找出出现频率最高的宽度分组
  let targetWidth: number | null = null;
  for (const [baseWidth, count] of widthFrequency) {
    if (count === maxCount) {
      targetWidth = baseWidth;
      break;
    }
  }

  console.log(`[normalizePanelWidths] 🎯 目标宽度选择: ${targetWidth}px（出现 ${maxCount} 次）`);

  // 4. 判断是否需要归一化（超过半数）
  const threshold = Math.floor(panels.length / 2) + 1;
  const shouldNormalize = maxCount >= threshold;

  console.log(`[normalizePanelWidths] ⚖️ 归一化决策:`);
  console.log(`  规则: 出现频率 ≥ ${threshold} 次 (${threshold}/${panels.length} = ${(threshold / panels.length * 100).toFixed(1)}%)`);
  console.log(`  实际: ${maxCount} 次 (${maxCount}/${panels.length} = ${(maxCount / panels.length * 100).toFixed(1)}%)`);
  console.log(`  结论: ${shouldNormalize ? '✅ 需要归一化' : '❌ 不需要归一化'}`);

  if (!shouldNormalize || targetWidth === null) {
    console.log(`[normalizePanelWidths] ❌ 未满足归一化条件，跳过归一化`);
    console.log('='.repeat(60));
    return {
      applied: false,
      targetWidth: null,
      affectedCount: 0,
      normalizedPanels: []
    };
  }

  // 5. 应用归一化：将所有面板宽度设置为目标宽度（强制归一化所有面板）
  console.log(`[normalizePanelWidths] 🔧 开始应用归一化（强制归一化所有面板）...`);
  console.log(`  目标宽度: ${targetWidth}px`);
  console.log(`  归一化范围: 所有 ${panels.length} 个面板`);

  let affectedCount = 0;
  const normalizedPanels: NormalizedPanelInfo[] = [];

  for (let i = 0; i < panels.length; i++) {
    const panel = panels[i];
    const currentWidth = panel.width;
    const diff = Math.abs(currentWidth - targetWidth);

    // 🌟 强制归一化：不管容差范围，归一化所有面板
    const oldWidth = panel.width;

    // 🌟 保存原始宽度
    panel.originalWidth = oldWidth;

    // 归一化宽度
    panel.width = targetWidth;

    // 同步更新 blueBox 和 greenBox 的宽度
    panel.blueBox.width = targetWidth;
    panel.greenBox.width = targetWidth;

    // 🌟 记录归一化详情
    normalizedPanels.push({
      panelIndex: i,
      oldWidth,
      newWidth: targetWidth,
      title: panel.title
    });

    affectedCount++;

    const diffStr = oldWidth !== targetWidth ? ` (差 ${diff}px)` : '';
    console.log(`  ✅ Panel ${i + 1} [${panel.title}]: ${oldWidth}px → ${targetWidth}px${diffStr}`);
  }

  // 🌟 新增：居中逻辑（如果有 imageWidth 参数）
  if (imageWidth !== undefined && targetWidth !== null) {
    console.log(`[normalizePanelWidths] 🎯 检查是否需要居中...`);
    console.log(`  图片宽度: ${imageWidth}px`);
    console.log(`  目标宽度: ${targetWidth}px`);

    // 检查所有面板的原始 x 坐标是否都在一个小的范围内（比如都在左边）
    const allXCoords = panels.map(p => p.x);
    const minX = Math.min(...allXCoords);
    const maxX = Math.max(...allXCoords);
    const xRange = maxX - minX;

    console.log(`  X坐标范围: ${minX}px ~ ${maxX}px, 差距: ${xRange}px`);

    // 如果 x 坐标的差距很小（比如小于 100），则认为需要居中
    const shouldCenter = xRange < 100;

    if (shouldCenter) {
      // 计算左边距
      const leftMargin = Math.round((imageWidth - targetWidth) / 2);
      console.log(`  ✅ 需要居中，左边距: ${leftMargin}px`);

      // 调整所有面板的 x 坐标
      for (let i = 0; i < panels.length; i++) {
        const panel = panels[i];
        const oldX = panel.x;
        panel.x = leftMargin;
        panel.blueBox.x = leftMargin;
        panel.greenBox.x = leftMargin;

        console.log(`  ✅ Panel ${i + 1} [${panel.title}]: X坐标 ${oldX}px → ${leftMargin}px`);
      }

      console.log(`[normalizePanelWidths] ✅ 居中完成！`);
    } else {
      console.log(`  ⚠️ 不需要居中（X坐标差距较大），保持原始位置，只调整宽度`);
    }
  }

  console.log(`[normalizePanelWidths] ✅ 归一化完成！`);
  console.log(`  目标宽度: ${targetWidth}px`);
  console.log(`  影响面板: ${affectedCount} / ${panels.length} 个 (${(affectedCount / panels.length * 100).toFixed(1)}%)`);
  console.log(`  归一化详情: [${normalizedPanels.map(p => `Panel${p.panelIndex + 1}:${p.oldWidth}→${p.newWidth}`).join(', ')}]`);
  console.log('='.repeat(60));

  return {
    applied: true,
    targetWidth,
    affectedCount,
    normalizedPanels
  };
}
