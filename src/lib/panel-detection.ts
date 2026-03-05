/**
 * 面板检测工具函数（A 计划切图方案）
 * 用于在后端实现与调试台相同的检测逻辑
 */

import sharp from 'sharp';

// 默认检测参数（与调试台一致）
export const DEFAULT_DETECTION_PARAMS = {
  panelLeftOffset: 49,
  panelTopOffset: 0,
  gridStartX: 100,
  gridStartY: 80,
  iconSize: 130,
  iconCenterOffsetX: 20,
  iconCenterOffsetY: 93,
  centerGapX: 145,
  centerGapY: 145,
  scanLineX: 90,
  scanStartY: 200,
  colorTolerance: 50,
  sustainedPixels: 10,
  panelWidth: 820,
  greenBoxWidth: 790,
  colorToleranceX: 40,
  sustainedPixelsX: 10,
  iconLineOffset: 137,
  iconLineGap: 113,
  minIconsPerLine: 5,
  gapX: 10,
  gapY: 0,
  varianceThreshold: 50,  // 空位探测器的方差阈值（与调试台一致）
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

// 后端空位探测器：基于方差检测空底座
function checkIconExists(
  pixelData: Buffer,
  imageWidth: number,
  imageHeight: number,
  x: number,
  y: number,
  width: number,
  height: number,
  varianceThreshold: number = 50  // 与调试台一致，默认 50
): boolean {
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
      const idx = (py * imageWidth + px) * 4; // RGBA 4通道
      const r = pixelData[idx];
      const g = pixelData[idx + 1];
      const b = pixelData[idx + 2];
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

// 计算图标位置（基于颜色差异的智能扫描）
export function calculateIconPositions(
  panel: any,
  panelY: number,
  params: typeof DEFAULT_DETECTION_PARAMS,
  pixelData: Buffer,
  imageWidth: number,
  imageHeight: number
): IconPosition[] {
  const { panelLeftOffset, gridStartX, gridStartY, iconSize, colorTolerance, sustainedPixels, varianceThreshold } = params;

  // 计算面板的左上角坐标
  const panelX = panel.x + panelLeftOffset;
  const panelWidth = panel.width;
  const panelHeight = panel.height;

  console.log(`[图标定位] 开始智能扫描图标位置`);
  console.log(`  panel: x=${panelX}, y=${panelY}, width=${panelWidth}, height=${panelHeight}`);

  // 获取像素颜色的辅助函数
  const getPixelColor = (x: number, y: number): [number, number, number] => {
    if (x < 0 || x >= imageWidth || y < 0 || y >= imageHeight) {
      return [255, 255, 255]; // 边界外返回白色
    }
    const index = (y * imageWidth + x) * 4;
    return [pixelData[index], pixelData[index + 1], pixelData[index + 2]];
  };

  const colorDiff = (c1: [number, number, number], c2: [number, number, number]): number => {
    return Math.max(
      Math.abs(c1[0] - c2[0]),
      Math.abs(c1[1] - c2[1]),
      Math.abs(c1[2] - c2[2])
    );
  };

  // 获取面板背景色（从面板左上角开始）
  const backgroundColor = getPixelColor(panelX, panelY);
  console.log(`  背景色: (${backgroundColor.join(', ')})`);

  // Y轴扫描：检测行边界
  const rowBoundaries: number[] = [];
  const scanLineX = panelX + Math.floor(panelWidth / 2); // 扫描面板中心线

  console.log(`  Y轴扫描: scanLineX=${scanLineX}, scanStartY=${panelY + gridStartY}, scanEndY=${panelY + panelHeight}`);

  let inIconRow = false;
  let consecutiveBg = 0;
  let consecutiveIcon = 0;
  let currentRowStart = 0;

  for (let y = panelY + gridStartY; y < panelY + panelHeight; y++) {
    const currentColor = getPixelColor(scanLineX, y);
    const diff = colorDiff(currentColor, backgroundColor);

    if (diff > colorTolerance) {
      // 进入图标区域（背景→图标）
      consecutiveIcon++;
      consecutiveBg = 0;

      if (!inIconRow && consecutiveIcon >= sustainedPixels) {
        inIconRow = true;
        currentRowStart = y - sustainedPixels + 1;
        console.log(`  检测到行边界: startY=${currentRowStart} (Y=${y})`);
      }
    } else {
      // 离开图标区域（图标→背景）
      consecutiveBg++;
      consecutiveIcon = 0;

      if (inIconRow && consecutiveBg >= sustainedPixels) {
        inIconRow = false;
        const rowEndY = y - sustainedPixels + 1;
        const rowHeight = rowEndY - currentRowStart;
        console.log(`  检测到行结束: endY=${rowEndY}, height=${rowHeight}`);
        
        if (rowHeight >= iconSize * 0.8) { // 过滤掉太小的行
          rowBoundaries.push(currentRowStart);
        }
      }
    }
  }

  // 如果最后还在图标区域，添加最后一个行
  if (inIconRow) {
    rowBoundaries.push(currentRowStart);
  }

  console.log(`  检测到 ${rowBoundaries.length} 行`);

  const positions: IconPosition[] = [];

  // 对每一行进行X轴扫描
  for (let rowIndex = 0; rowIndex < rowBoundaries.length; rowIndex++) {
    const rowY = rowBoundaries[rowIndex];
    console.log(`\n  处理第 ${rowIndex + 1} 行: Y=${rowY}`);

    // X轴扫描：检测列边界
    const colBoundaries: number[] = [];
    const scanLineY = rowY + Math.floor(iconSize / 2); // 扫描行中心线

    inIconRow = false;
    consecutiveBg = 0;
    consecutiveIcon = 0;
    let currentIconStart = 0;

    for (let x = panelX + gridStartX; x < panelX + panelWidth; x++) {
      const currentColor = getPixelColor(x, scanLineY);
      const diff = colorDiff(currentColor, backgroundColor);

      if (diff > colorTolerance) {
        // 进入图标区域（背景→图标）
        consecutiveIcon++;
        consecutiveBg = 0;

        if (!inIconRow && consecutiveIcon >= sustainedPixels) {
          inIconRow = true;
          currentIconStart = x - sustainedPixels + 1;
        }
      } else {
        // 离开图标区域（图标→背景）
        consecutiveBg++;
        consecutiveIcon = 0;

        if (inIconRow && consecutiveBg >= sustainedPixels) {
          inIconRow = false;
          const iconEndX = x - sustainedPixels + 1;
          const iconWidth = iconEndX - currentIconStart;

          console.log(`    检测到图标: startX=${currentIconStart}, endX=${iconEndX}, width=${iconWidth}`);

          if (iconWidth >= iconSize * 0.8) { // 过滤掉太小的图标
            colBoundaries.push(currentIconStart);
          }
        }
      }
    }

    // 如果最后还在图标区域，添加最后一个图标
    if (inIconRow) {
      colBoundaries.push(currentIconStart);
    }

    console.log(`    检测到 ${colBoundaries.length} 个图标`);

    // 为每个检测到的图标创建位置
    for (let colIndex = 0; colIndex < colBoundaries.length; colIndex++) {
      const iconX = colBoundaries[colIndex];
      
      // 尝试向右查找图标边界
      const nextIconX = colIndex < colBoundaries.length - 1 ? colBoundaries[colIndex + 1] : panelX + panelWidth;
      const estimatedIconWidth = Math.min(iconSize, nextIconX - iconX);

      // 使用空位探测器过滤
      const centerX = iconX + Math.floor(estimatedIconWidth / 2);
      const centerY = rowY + Math.floor(iconSize / 2);
      const coreX = centerX - Math.floor(iconSize / 2);
      const coreY = centerY - Math.floor(iconSize / 2);

      const hasIcon = checkIconExists(
        pixelData,
        imageWidth,
        imageHeight,
        coreX,
        coreY,
        iconSize,
        iconSize,
        varianceThreshold || 50
      );

      console.log(`      [${rowIndex}, ${colIndex}] x=${iconX}, y=${rowY}, ${hasIcon ? '✓' : '✗'}`);

      if (hasIcon) {
        positions.push({
          x: iconX,
          y: rowY,
          width: estimatedIconWidth,
          height: iconSize,
          row: rowIndex,
          col: colIndex,
        });
      }
    }
  }

  console.log(`\n[图标定位] 完成，共检测到 ${positions.length} 个图标`);

  return positions;
}

// 完整的面板检测流程
export async function detectPanels(
  imageBuffer: Buffer,
  debugPanels: any[],
  customParams?: any
): Promise<DetectedPanel[]> {
  // 合并前端传来的完美参数和默认参数
  const params = { ...DEFAULT_DETECTION_PARAMS, ...(customParams || {}) };

  console.log('\n========== 开始 A 计划面板检测 ==========');

  // 重点：让 sharp 吐出带有 RGBA 像素数据的 raw buffer，给后续的方差检测用
  const image = sharp(imageBuffer).ensureAlpha();
  const { data: pixelData, info } = await image.raw().toBuffer({ resolveWithObject: true });
  const imageWidth = info.width;
  const imageHeight = info.height;

  console.log(`图片尺寸: ${imageWidth}x${imageHeight}`);
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
      pixelData,
      imageWidth,
      imageHeight
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
