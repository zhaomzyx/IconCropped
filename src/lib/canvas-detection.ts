/**
 * Canvas 面板检测工具函数
 * 用于在前端实现 A 计划切图方案的检测逻辑
 */

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
  redBoxes: IconPosition[];
}

// 默认检测参数
export const DEFAULT_PARAMS = {
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
  varianceThreshold: 300,
};

// 计算颜色差异
export function colorDiff(color1: [number, number, number], color2: [number, number, number]): number {
  return Math.max(
    Math.abs(color1[0] - color2[0]),
    Math.abs(color1[1] - color2[1]),
    Math.abs(color1[2] - color2[2])
  );
}

// 垂直像素扫描（滑动窗口算法），找出所有面板的 Y 坐标范围
export function scanVerticalLine(
  imageData: ImageData,
  scanLineX: number,
  scanStartY: number,
  colorTolerance: number,
  sustainedPixels: number
): PanelVerticalRange[] {
  const { data, width, height } = imageData;
  const panels: PanelVerticalRange[] = [];

  console.log(`[Y轴检测] 开始扫描，输入参数：`);
  console.log(`  scanLineX=${scanLineX}, scanStartY=${scanStartY}`);
  console.log(`  colorTolerance=${colorTolerance}, sustainedPixels=${sustainedPixels}`);
  console.log(`  image size: ${width}x${height}`);

  // 边界检查
  if (scanLineX < 0 || scanLineX >= width) {
    console.warn(`[Y轴检测] ❌ Scan line X (${scanLineX}) is out of image bounds (${width})`);
    return panels;
  }

  if (scanStartY < 0 || scanStartY >= height) {
    console.warn(`[Y轴检测] ❌ Scan start Y (${scanStartY}) is out of image bounds (${height})`);
    return panels;
  }

  console.log(`[Y轴检测] ✓ 边界检查通过`);

  // 获取主背景色（从起始坐标开始）
  const getPixelColor = (x: number, y: number): [number, number, number] => {
    const index = (y * width + x) * 4;
    return [data[index], data[index + 1], data[index + 2]];
  };

  const backgroundColor = getPixelColor(scanLineX, scanStartY);
  console.log(`[Y轴检测] 背景色: (${backgroundColor.join(', ')})`);

  // 滑动窗口算法
  let inPanel = false;
  let consecutiveBg = 0;
  let consecutivePanel = 0;
  let currentStartY = 0;

  // 从 Y=scanStartY 扫描到底部（跳过顶部杂乱区域）
  for (let y = scanStartY; y < height; y++) {
    const currentColor = getPixelColor(scanLineX, y);
    const diff = colorDiff(currentColor, backgroundColor);

    if (diff > colorTolerance) {
      // 进入panel区域（背景→面板）
      consecutivePanel++;
      consecutiveBg = 0;

      if (!inPanel && consecutivePanel >= sustainedPixels) {
        inPanel = true;
        currentStartY = y - sustainedPixels + 1;
        console.log(`[Y轴检测] Panel ${panels.length + 1} 上Y轴: ${currentStartY} (检测于 Y=${y})`);
      }
    } else {
      // 离开panel区域（面板→背景）
      consecutiveBg++;
      consecutivePanel = 0;

      if (inPanel && consecutiveBg >= sustainedPixels) {
        inPanel = false;
        const endY = y - sustainedPixels + 1;
        console.log(`[Y轴检测] Panel ${panels.length + 1} 下Y轴: ${endY}, 高度: ${endY - currentStartY}`);
        panels.push({ startY: currentStartY, endY: endY });
      }
    }
  }

  console.log(`[Y轴检测] 共检测到 ${panels.length} 个panel`);
  return panels;
}

// 水平像素扫描（滑动窗口算法），检测panel宽度和小panel位置
export function scanHorizontalLine(
  imageData: ImageData,
  scanY: number,
  colorTolerance: number,
  sustainedPixels: number
): PanelHorizontalRange | null {
  const { data, width } = imageData;

  // 获取背景色（从左边开始）
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

    if (diff > colorTolerance) {
      // 进入panel区域（背景→面板）
      consecutivePanel++;
      consecutiveBg = 0;

      if (!inPanel && consecutivePanel >= sustainedPixels) {
        inPanel = true;
        const iconStartX = x - sustainedPixels + 1;
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

      if (inPanel && consecutiveBg >= sustainedPixels) {
        inPanel = false;
        const iconEndX = x - sustainedPixels + 1;

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

// 空位探测器：基于方差检测空底座
function checkIconExists(
  imageData: ImageData,
  x: number,
  y: number,
  width: number,
  height: number,
  varianceThreshold: number = 300
): boolean {
  const { data, width: imageWidth, height: imageHeight } = imageData;

  // 只取中心 30% 到 70% 的核心区域
  const startX = Math.floor(x + width * 0.3);
  const startY = Math.floor(y + height * 0.3);
  const endX = Math.floor(x + width * 0.7);
  const endY = Math.floor(y + height * 0.7);

  // 边界保护
  if (startX < 0 || startY < 0 || endX >= imageWidth || endY >= imageHeight) return true;

  let rSum = 0, gSum = 0, bSum = 0;
  let count = 0;
  const pixels = [];

  for (let py = startY; py < endY; py++) {
    for (let px = startX; px < endX; px++) {
      const idx = (py * imageWidth + px) * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      pixels.push({ r, g, b });
      rSum += r;
      gSum += g;
      bSum += b;
      count++;
    }
  }

  if (count === 0) return true;

  const rAvg = rSum / count;
  const gAvg = gSum / count;
  const bAvg = bSum / count;

  let variance = 0;
  for (const p of pixels) {
    variance += Math.pow(p.r - rAvg, 2) + Math.pow(p.g - gAvg, 2) + Math.pow(p.b - bAvg, 2);
  }
  variance = variance / count;

  return variance > varianceThreshold;
}

// 计算图标位置（使用中心点间距 + 空位探测器）
export function calculateIconPositions(
  panel: any,
  panelY: number,
  params: typeof DEFAULT_PARAMS,
  imageData: ImageData,
  panelRange: PanelHorizontalRange
): IconPosition[] {
  const { gridStartX, gridStartY, iconSize, centerGapX, centerGapY, panelLeftOffset, varianceThreshold } = params;

  // 终极解法：给一个允许的最大行数，让空位探测器自动停止
  const rows = panel.rows || 10;
  const cols = panel.cols || 5;
  const maxCount = panel.total || (rows * cols);

  const startX = panel.x + panelLeftOffset + gridStartX;
  const startY = panelY + gridStartY;

  const positions = [];
  let count = 0;

  console.log(`[图标定位] 开始计算图标位置（带空位探测器）`);
  console.log(`  panel.x=${panel.x}, panel.y=${panel.y}`);
  console.log(`  startX=${startX}, startY=${startY}`);
  console.log(`  rows=${rows}, cols=${cols}, maxCount=${maxCount}`);
  console.log(`  centerGapX=${centerGapX}, centerGapY=${centerGapY}`);

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      if (count >= maxCount) break;

      const rectX = Math.round(startX + col * centerGapX);
      const rectY = Math.round(startY + row * centerGapY);

      // 呼叫空位探测器！
      const hasIcon = checkIconExists(
        imageData,
        rectX,
        rectY,
        iconSize,
        iconSize,
        varianceThreshold || 300
      );

      if (!hasIcon) {
        console.log(`[A计划前端] 探测到位置 [${row}, ${col}] 为空底座，终止当前面板识别！`);
        return positions; // 探测到空的，直接停止识别该面板！
      }

      positions.push({
        x: rectX,
        y: rectY,
        width: iconSize,
        height: iconSize,
        row,
        col,
      });
      count++;
    }
    if (count >= maxCount) break;
  }

  console.log(`[图标定位] 计算完成，共 ${positions.length} 个图标`);

  return positions;
}

// 完整的面板检测流程（前端 Canvas 版本）
export async function detectPanelsWithCanvas(
  imageElement: HTMLImageElement,
  debugPanels: any[],
  customParams?: Partial<typeof DEFAULT_PARAMS>
): Promise<DetectedPanel[]> {
  // 合并自定义参数和默认参数
  const params = { ...DEFAULT_PARAMS, ...(customParams || {}) };

  console.log('\n========== 开始 A 计划面板检测（Canvas 版本） ==========');

  // 创建 Canvas 并绘制图片
  const canvas = document.createElement('canvas');
  canvas.width = imageElement.naturalWidth;
  canvas.height = imageElement.naturalHeight;
  const ctx = canvas.getContext('2d')!;

  ctx.drawImage(imageElement, 0, 0);
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

  console.log(`图片尺寸: ${canvas.width}x${canvas.height}`);
  console.log(`参数: scanLineX=${params.scanLineX}, scanStartY=${params.scanStartY}`);

  // 1. Y轴检测
  const panelVerticalRanges = scanVerticalLine(
    imageData,
    params.scanLineX,
    params.scanStartY,
    params.colorTolerance,
    params.sustainedPixels
  );

  if (panelVerticalRanges.length === 0) {
    throw new Error('Y轴检测失败：未检测到任何面板');
  }

  console.log(`Y轴检测完成，检测到 ${panelVerticalRanges.length} 个panel`);

  // 2. X轴检测
  const panelRanges: any[] = [];
  for (let i = 0; i < panelVerticalRanges.length; i++) {
    const vRange = panelVerticalRanges[i];
    const panel = debugPanels[i];
    const midY = Math.round((vRange.startY + vRange.endY) / 2);

    console.log(`\n[Panel ${i + 1}] ${panel?.title || `Panel_${i + 1}`}`);
    console.log(`中间检测线 Y: ${midY}`);

    // 在Panel中间横线上扫描
    const hRange = scanHorizontalLine(
      imageData,
      midY,
      params.colorToleranceX,
      params.sustainedPixelsX
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
    const panel = debugPanels[i];
    if (!panel) {
      console.warn(`[Panel ${i + 1}] 警告：LLM 未返回此面板的元数据，跳过`);
      continue;
    }

    const range = panelRanges[i];

    console.log(`\n[Panel ${i + 1}] ${panel.title}`);
    console.log(`  BlueBox: x=${range.startX}, y=${range.startY}, width=${range.width}, height=${range.height}`);

    // 红框坐标
    const redBoxes = calculateIconPositions(
      panel,
      range.startY,
      params,
      imageData,
      range
    );

    console.log(`  RedBox Count: ${redBoxes.length}`);

    detectedPanels.push({
      title: panel.title,
      redBoxes: redBoxes,
    });
  }

  console.log(`\n========== A 计划面板检测完成，共 ${detectedPanels.length} 个面板 ==========`);

  return detectedPanels;
}
