/**
 * 面板检测工具函数（A 计划切图方案）
 * 用于在后端实现与调试台相同的检测逻辑
 */

import sharp from 'sharp';

// 默认检测参数
export const DEFAULT_DETECTION_PARAMS = {
  panelLeftOffset: -28,
  panelTopOffset: 0,
  gridStartX: 69,
  gridStartY: 107,
  iconSize: 132,
  iconCenterOffsetX: 66,
  iconCenterOffsetY: 66,
  centerGapX: 146,
  centerGapY: 144,
  scanLineX: 49,
  scanStartY: 200,
  colorTolerance: 30,
  sustainedPixels: 5,
  panelWidth: 876,
  greenBoxWidth: 876,
  colorToleranceX: 30,
  sustainedPixelsX: 5,
  iconLineOffset: 107,
  iconLineGap: 144,
  minIconsPerLine: 5,
};

// 面板垂直范围
export interface PanelVerticalRange {
  startY: number;
  endY: number;
}

// 面板水平范围
export interface PanelHorizontalRange {
  startX: number;
  endX: number;
  icons: Array<{
    startX: number;
    endX: number;
    centerX: number;
  }>;
}

// 图标位置
export interface IconPosition {
  x: number;
  y: number;
  width: number;
  height: number;
  row: number;
  col: number;
}

// 检测到的面板
export interface DetectedPanel {
  title: string;
  blueBox: { x: number; y: number; width: number; height: number };
  greenBox: { x: number; y: number; width: number; height: number };
  redBoxes: IconPosition[];
}

// 计算颜色差异
function colorDiff(color1: [number, number, number], color2: [number, number, number]): number {
  return Math.max(
    Math.abs(color1[0] - color2[0]),
    Math.abs(color1[1] - color2[1]),
    Math.abs(color1[2] - color2[2])
  );
}

// 垂直像素扫描（Y轴检测）
export async function scanVerticalLine(
  image: sharp.Sharp,
  params: typeof DEFAULT_DETECTION_PARAMS
): Promise<PanelVerticalRange[]> {
  const metadata = await image.metadata();
  const width = metadata.width!;
  const height = metadata.height!;

  const rawBuffer = await image.raw().toBuffer();
  const data = rawBuffer; // Buffer 本身就可以作为 Uint8Array 访问
  const panels: PanelVerticalRange[] = [];

  console.log(`[Y轴检测] 开始扫描，输入参数：`);
  console.log(`  scanLineX=${params.scanLineX}, scanStartY=${params.scanStartY}`);
  console.log(`  colorTolerance=${params.colorTolerance}, sustainedPixels=${params.sustainedPixels}`);
  console.log(`  image size: ${width}x${height}`);

  // 边界检查
  if (params.scanLineX < 0 || params.scanLineX >= width) {
    console.warn(`[Y轴检测] ❌ Scan line X (${params.scanLineX}) is out of image bounds (${width})`);
    return panels;
  }

  if (params.scanStartY < 0 || params.scanStartY >= height) {
    console.warn(`[Y轴检测] ❌ Scan start Y (${params.scanStartY}) is out of image bounds (${height})`);
    return panels;
  }

  console.log(`[Y轴检测] ✓ 边界检查通过`);

  // 获取像素颜色
  const getPixelColor = (x: number, y: number): [number, number, number] => {
    const index = (y * width + x) * 4;
    return [data[index], data[index + 1], data[index + 2]];
  };

  const backgroundColor = getPixelColor(params.scanLineX, params.scanStartY);
  console.log(`[Y轴检测] 背景色: (${backgroundColor.join(', ')})`);

  // 滑动窗口算法
  let inPanel = false;
  let consecutiveBg = 0;
  let consecutivePanel = 0;
  let currentStartY = 0;

  // 从 Y=scanStartY 扫描到底部
  for (let y = params.scanStartY; y < height; y++) {
    const currentColor = getPixelColor(params.scanLineX, y);
    const diff = colorDiff(currentColor, backgroundColor);

    if (diff > params.colorTolerance) {
      // 进入panel区域（背景→面板）
      consecutivePanel++;
      consecutiveBg = 0;

      if (!inPanel && consecutivePanel >= params.sustainedPixels) {
        inPanel = true;
        currentStartY = y - params.sustainedPixels + 1;
        console.log(`[Y轴检测] Panel ${panels.length + 1} 上Y轴: ${currentStartY} (检测于 Y=${y})`);
      }
    } else {
      // 离开panel区域（面板→背景）
      consecutiveBg++;
      consecutivePanel = 0;

      if (inPanel && consecutiveBg >= params.sustainedPixels) {
        inPanel = false;
        const endY = y - params.sustainedPixels + 1;
        console.log(`[Y轴检测] Panel ${panels.length + 1} 下Y轴: ${endY}, 高度: ${endY - currentStartY}`);
        panels.push({ startY: currentStartY, endY: endY });
      }
    }
  }

  console.log(`[Y轴检测] 共检测到 ${panels.length} 个panel`);
  return panels;
}

// 水平像素扫描（X轴检测）
export async function scanHorizontalLine(
  image: sharp.Sharp,
  scanY: number,
  params: typeof DEFAULT_DETECTION_PARAMS
): Promise<PanelHorizontalRange | null> {
  const metadata = await image.metadata();
  const width = metadata.width!;

  const rawBuffer = await image.raw().toBuffer();
  const data = rawBuffer;

  // 获取背景色
  const getPixelColor = (x: number, y: number): [number, number, number] => {
    const index = (y * width + x) * 4;
    return [data[index], data[index + 1], data[index + 2]];
  };

  const backgroundColor = getPixelColor(0, scanY);
  console.log(`[X轴检测] 扫描线 Y: ${scanY}, 背景色: (${backgroundColor.join(', ')})`);

  // 滑动窗口算法
  let inPanel = false;
  let consecutiveBg = 0;
  let consecutivePanel = 0;
  let panelStartX = 0;
  let panelEndX = 0;
  let currentIconStart = 0;
  const icons: any[] = [];

  for (let x = 0; x < width; x++) {
    const currentColor = getPixelColor(x, scanY);
    const diff = colorDiff(currentColor, backgroundColor);

    if (diff > params.colorToleranceX) {
      // 进入panel区域（背景→面板）
      consecutivePanel++;
      consecutiveBg = 0;

      if (!inPanel && consecutivePanel >= params.sustainedPixelsX) {
        inPanel = true;
        const iconStartX = x - params.sustainedPixelsX + 1;
        currentIconStart = iconStartX;

        // 第一次进入时，记录大panel的起始X
        if (icons.length === 0) {
          panelStartX = iconStartX;
          console.log(`[X轴检测] 大panel左边界: ${panelStartX}`);
        } else {
          // 不是第一次进入，说明是一个新的小panel
          console.log(`[X轴检测] Icon ${icons.length + 1} 左边界: ${iconStartX}`);
        }
      }
    } else {
      // 离开panel区域（面板→背景）
      consecutiveBg++;
      consecutivePanel = 0;

      if (inPanel && consecutiveBg >= params.sustainedPixelsX) {
        inPanel = false;
        const iconEndX = x - params.sustainedPixelsX + 1;

        // 计算当前icon的边界信息
        const iconCenterX = (currentIconStart + iconEndX) / 2;
        icons.push({
          startX: currentIconStart,
          endX: iconEndX,
          centerX: iconCenterX
        });
        console.log(`[X轴检测] Icon ${icons.length} 右边界: ${iconEndX}, 中心点: ${iconCenterX.toFixed(1)}`);
      }
    }
  }

  // 如果扫描到右边还没有回到背景色
  if (inPanel) {
    panelEndX = width;
    const iconCenterX = (currentIconStart + panelEndX) / 2;
    icons.push({
      startX: currentIconStart,
      endX: panelEndX,
      centerX: iconCenterX
    });
    console.log(`[X轴检测] 大panel右边界: ${panelEndX} (到图片边界), 最后一个Icon中心点: ${iconCenterX.toFixed(1)}`);
  } else {
    // 使用最后一个icon的右边界
    if (icons.length > 0) {
      const lastIcon = icons[icons.length - 1];
      panelEndX = lastIcon.endX;
      console.log(`[X轴检测] 大panel右边界: ${panelEndX} (基于最后一个icon计算)`);
    }
  }

  if (icons.length === 0) {
    console.warn(`[X轴检测] 未检测到任何icon`);
    return null;
  }

  console.log(`[X轴检测] 检测到 ${icons.length} 个icon, 宽度: ${panelEndX - panelStartX}`);

  return { startX: panelStartX, endX: panelEndX, icons };
}

// 计算图标位置（使用中心点间距）
export function calculateIconPositions(
  panel: any,
  panelY: number,
  params: typeof DEFAULT_DETECTION_PARAMS,
  width: number,
  height: number
): IconPosition[] {
  const { gridStartX, gridStartY, iconSize, centerGapX, centerGapY, panelLeftOffset, iconCenterOffsetX, iconCenterOffsetY } = params;

  // 计算面板的左上角坐标
  const panelX = panel.x + panelLeftOffset;

  // 首个中心点坐标
  const firstCenterX = panelX + gridStartX + iconCenterOffsetX;
  const firstCenterY = panelY + gridStartY + iconCenterOffsetY;

  const positions: IconPosition[] = [];
  let count = 0;
  const maxCount = panel.total ?? (panel.rows * panel.cols);
  const coreSize = 30;
  const varianceThreshold = 50;

  console.log(`[图标定位] 开始计算图标位置`);
  console.log(`  panel.x=${panel.x}, panel.y=${panel.y}`);
  console.log(`  panelX=${panelX}, panelY=${panelY}`);
  console.log(`  firstCenterX=${firstCenterX}, firstCenterY=${firstCenterY}`);
  console.log(`  centerGapX=${centerGapX}, centerGapY=${centerGapY}`);

  for (let row = 0; row < panel.rows; row++) {
    for (let col = 0; col < panel.cols; col++) {
      if (count >= maxCount) {
        break;
      }

      // 计算中心点坐标
      const centerX = Math.round(firstCenterX + col * centerGapX);
      const centerY = Math.round(firstCenterY + row * centerGapY);

      // 从中心点计算左上角坐标
      const x = centerX - Math.round(iconSize / 2);
      const y = centerY - Math.round(iconSize / 2);

      // 边界检查
      if (x >= 0 && y >= 0 && x + iconSize <= width && y + iconSize <= height) {
        positions.push({
          x,
          y,
          width: iconSize,
          height: iconSize,
          row,
          col,
        });
        count++;
      } else {
        console.warn(`[图标定位] 图标 [${row}, ${col}] 超出边界，跳过`);
      }
    }

    if (count >= maxCount) {
      break;
    }
  }

  console.log(`[图标定位] 计算完成，共 ${positions.length} 个图标`);

  return positions;
}

// 完整的面板检测流程
export async function detectPanels(
  image: sharp.Sharp,
  debugPanels: any[],
  params: typeof DEFAULT_DETECTION_PARAMS
): Promise<DetectedPanel[]> {
  console.log('\n========== 开始 A 计划面板检测 ==========');

  const metadata = await image.metadata();
  const width = metadata.width!;
  const height = metadata.height!;

  console.log(`图片尺寸: ${width}x${height}`);
  console.log(`参数: scanLineX=${params.scanLineX}, scanStartY=${params.scanStartY}`);

  // 1. Y轴检测
  const panelVerticalRanges = await scanVerticalLine(image, params);

  if (panelVerticalRanges.length === 0) {
    throw new Error('Y轴检测失败：未检测到任何面板');
  }

  console.log(`Y轴检测完成，检测到 ${panelVerticalRanges.length} 个panel`);

  // 2. X轴检测
  const panelRanges: any[] = [];
  for (let i = 0; i < panelVerticalRanges.length; i++) {
    const vRange = panelVerticalRanges[i];
    // 使用安全访问，如果面板不存在则使用默认值
    const panel = debugPanels[i];
    if (!panel) {
      console.warn(`[Panel ${i + 1}] 警告：LLM 未返回此面板的元数据，使用默认值`);
    }

    const safePanel = panel || {
      title: `Panel_${i + 1}`,
      rows: 1,
      cols: 5,
      total: 5,
      x: 0,
      y: 0,
      width: 815,
      height: 200,
    };

    const midY = Math.round((vRange.startY + vRange.endY) / 2);

    console.log(`\n[Panel ${i + 1}] ${safePanel.title}`);
    console.log(`中间检测线 Y: ${midY}`);

    // 在Panel中间横线上扫描
    const hRange = await scanHorizontalLine(
      image,
      midY,
      params
    );

    panelRanges.push({
      startY: vRange.startY,
      endY: vRange.endY,
      startX: hRange?.startX ?? 0,
      endX: hRange?.endX ?? 0,
      width: hRange ? hRange.endX - hRange.startX : 0,
      height: vRange.endY - vRange.startY,
    });
  }

  console.log(`X轴检测完成`);

  // 3. 计算图标位置
  const detectedPanels: DetectedPanel[] = [];

  for (let i = 0; i < panelRanges.length; i++) {
    // 使用安全访问，如果面板不存在则使用默认值
    const panel = debugPanels[i];
    if (!panel) {
      console.warn(`[Panel ${i + 1}] 警告：LLM 未返回此面板的元数据，使用默认值`);
    }

    const safePanel = panel || {
      title: `Panel_${i + 1}`,
      rows: 1,
      cols: 5,
      total: 5,
      x: 0,
      y: 0,
      width: 815,
      height: 200,
    };

    const range = panelRanges[i];

    console.log(`\n[Panel ${i + 1}] ${safePanel.title}`);
    console.log(`  BlueBox: x=${range.startX}, y=${range.startY}, width=${range.width}, height=${range.height}`);

    // 蓝框坐标
    const blueBox = {
      x: range.startX,
      y: range.startY,
      width: range.width,
      height: range.height,
    };

    // 绿框坐标
    const greenBox = {
      x: range.startX,
      y: range.startY,
      width: range.width,
      height: params.gridStartY,
    };

    // 红框坐标
    const redBoxes = calculateIconPositions(
      safePanel,
      range.startY,
      params,
      width,
      height
    );

    console.log(`  GreenBox: x=${greenBox.x}, y=${greenBox.y}, width=${greenBox.width}, height=${greenBox.height}`);
    console.log(`  RedBox Count: ${redBoxes.length}`);

    detectedPanels.push({
      title: safePanel.title,
      blueBox,
      greenBox,
      redBoxes,
    });
  }

  console.log(`\n========== A 计划面板检测完成，共 ${detectedPanels.length} 个面板 ==========`);

  return detectedPanels;
}
