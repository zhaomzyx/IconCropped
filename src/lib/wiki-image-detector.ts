/**
 * Wiki 图片检测器（纯前端模式）
 * 不依赖 LLM，直接在浏览器中检测图片中的面板和图标
 * 适用于工作台等不需要 LLM 元数据的场景
 */

import { Buffer } from 'buffer';
import {
  detectAllBounds,
  calculateIconPositionsFromBounds
} from '@/lib/sliding-window-detection';

// ===== 类型定义 =====

export interface DetectedPanel {
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rows: number;
  cols: number;
  total?: number;
  imageUrl: string;
  blueBox: { x: number; y: number; width: number; height: number };
  greenBox: { x: number; y: number; width: number; height: number };
  redBoxes: Array<{ x: number; y: number; width: number; height: number }>;
}

export interface DetectionParams {
  // 绿框相关（标题区域）
  gridStartY: number;

  // 扫描线相关参数
  scanLineX: number;
  scanStartY: number;
  colorTolerance: number;
  sustainedPixels: number;

  // X轴检测参数
  colorToleranceX: number;
  sustainedPixelsX: number;

  // 边界检测参数
  boundsWindowHeight: number;
  boundsWindowWidth: number;
  boundsVarianceThresholdRow: number;
  boundsVarianceThresholdCol: number;
  boundsStepSize: number;
  boundsMinRowHeight: number;
  boundsMinColWidth: number;

  // 1:1强制正方形
  forceSquareIcons: boolean;
  forceSquareOffsetX: number;
  forceSquareOffsetY: number;

  // 空图标过滤
  filterEmptyIcons: boolean;
  emptyIconVarianceThreshold: number;
}

// 默认检测参数（基于调试台验证的最优参数）
export const DEFAULT_DETECTION_PARAMS: DetectionParams = {
  // 绿框相关（标题区域）
  gridStartY: 107,

  // 扫描线相关参数
  scanLineX: 49,
  scanStartY: 200,
  colorTolerance: 30,
  sustainedPixels: 5,

  // X轴检测参数
  colorToleranceX: 30,
  sustainedPixelsX: 5,

  // 边界检测参数
  boundsWindowHeight: 5,
  boundsWindowWidth: 5,
  boundsVarianceThresholdRow: 30,
  boundsVarianceThresholdCol: 30,
  boundsStepSize: 1,
  boundsMinRowHeight: 20,
  boundsMinColWidth: 20,

  // 1:1强制正方形
  forceSquareIcons: true,
  forceSquareOffsetX: 0,
  forceSquareOffsetY: 0,

  // 空图标过滤
  filterEmptyIcons: true,
  emptyIconVarianceThreshold: 20,
};

// ===== 核心算法函数 =====

/**
 * 计算颜色方差（用于判断是否为空图标）
 */
function calculateColorVariance(
  imageData: ImageData,
  x: number,
  y: number,
  width: number,
  height: number
): number {
  const { data } = imageData;
  let rSum = 0, gSum = 0, bSum = 0;
  let count = 0;

  // 计算平均值
  for (let py = y; py < y + height; py++) {
    for (let px = x; px < x + width; px++) {
      if (px < 0 || py < 0 || px >= imageData.width || py >= imageData.height) continue;
      const idx = (py * imageData.width + px) * 4;
      rSum += data[idx];
      gSum += data[idx + 1];
      bSum += data[idx + 2];
      count++;
    }
  }

  if (count === 0) return 0;

  const rAvg = rSum / count;
  const gAvg = gSum / count;
  const bAvg = bSum / count;

  // 计算方差
  let variance = 0;
  for (let py = y; py < y + height; py++) {
    for (let px = x; px < x + width; px++) {
      if (px < 0 || py < 0 || px >= imageData.width || py >= imageData.height) continue;
      const idx = (py * imageData.width + px) * 4;
      variance += Math.pow(data[idx] - rAvg, 2);
      variance += Math.pow(data[idx + 1] - gAvg, 2);
      variance += Math.pow(data[idx + 2] - bAvg, 2);
    }
  }

  return variance / (count * 3);
}

/**
 * 计算颜色差异（欧几里得距离）
 */
function colorDiff(
  color1: [number, number, number],
  color2: [number, number, number]
): number {
  return Math.max(
    Math.abs(color1[0] - color2[0]),
    Math.abs(color1[1] - color2[1]),
    Math.abs(color1[2] - color2[2])
  );
}

/**
 * Y轴检测（滑动窗口算法）
 * 找出所有面板的 Y 坐标范围
 */
interface PanelVerticalRange {
  startY: number;
  endY: number;
}

function scanVerticalLine(
  imageData: ImageData,
  scanLineX: number,
  scanStartY: number,
  colorTolerance: number,
  sustainedPixels: number,
  width: number,
  height: number
): PanelVerticalRange[] {
  const { data } = imageData;
  const panels: PanelVerticalRange[] = [];

  // 边界检查
  if (scanLineX < 0 || scanLineX >= width || scanStartY < 0 || scanStartY >= height) {
    return panels;
  }

  const getPixelColor = (x: number, y: number): [number, number, number] => {
    const index = (y * width + x) * 4;
    return [data[index], data[index + 1], data[index + 2]};
  };

  const backgroundColor = getPixelColor(scanLineX, scanStartY);
  console.log(`[WikiImageDetector] Y轴扫描开始：scanLineX=${scanLineX}, scanStartY=${scanStartY}, 背景色=(${backgroundColor.join(', ')})`);

  let inPanel = false;
  let consecutiveBg = 0;
  let consecutivePanel = 0;
  let currentStartY = 0;

  for (let y = scanStartY; y < height; y++) {
    const currentColor = getPixelColor(scanLineX, y);
    const diff = colorDiff(currentColor, backgroundColor);

    if (diff > colorTolerance) {
      consecutivePanel++;
      consecutiveBg = 0;

      if (!inPanel && consecutivePanel >= sustainedPixels) {
        inPanel = true;
        currentStartY = y - sustainedPixels + 1;
        console.log(`[WikiImageDetector] Panel ${panels.length + 1} 上边界: Y=${currentStartY} (检测于Y=${y})`);
      }
    } else {
      consecutiveBg++;
      consecutivePanel = 0;

      if (inPanel && consecutiveBg >= sustainedPixels) {
        inPanel = false;
        const endY = y - sustainedPixels + 1;
        const panelHeight = endY - currentStartY;
        console.log(`[WikiImageDetector] Panel ${panels.length + 1} 下边界: Y=${endY}, 高度=${panelHeight}`);
        panels.push({ startY: currentStartY, endY });
      }
    }
  }

  console.log(`[WikiImageDetector] Y轴扫描完成，共检测到 ${panels.length} 个Panel`);
  return panels;
}

/**
 * X轴检测（滑动窗口算法）
 * 检测panel宽度和小panel位置
 */
interface IconBoundary {
  startX: number;
  endX: number;
  centerX: number;
}

interface PanelHorizontalRange {
  startX: number;
  endX: number;
  icons: IconBoundary[];
}

function scanHorizontalLine(
  imageData: ImageData,
  scanY: number,
  colorTolerance: number,
  sustainedPixels: number,
  width: number
): PanelHorizontalRange | null {
  const { data } = imageData;

  const getPixelColor = (x: number, y: number): [number, number, number] => {
    const index = (y * width + x) * 4;
    return [data[index], data[index + 1], data[index + 2]];
  };

  const backgroundColor = getPixelColor(0, scanY);

  let inPanel = false;
  let consecutiveBg = 0;
  let consecutivePanel = 0;
  let panelStartX = 0;
  let panelEndX = 0;
  let currentIconStart = 0;
  const icons: IconBoundary[] = [];

  for (let x = 0; x < width; x++) {
    const currentColor = getPixelColor(x, scanY);
    const diff = colorDiff(currentColor, backgroundColor);

    if (diff > colorTolerance) {
      consecutivePanel++;
      consecutiveBg = 0;

      if (!inPanel && consecutivePanel >= sustainedPixels) {
        inPanel = true;
        const iconStartX = x - sustainedPixels + 1;
        currentIconStart = iconStartX;

        if (icons.length === 0) {
          panelStartX = iconStartX;
        }
      }
    } else {
      consecutiveBg++;
      consecutivePanel = 0;

      if (inPanel && consecutiveBg >= sustainedPixels) {
        inPanel = false;
        const iconEndX = x - sustainedPixels + 1;
        const iconCenterX = (currentIconStart + iconEndX) / 2;
        icons.push({ startX: currentIconStart, endX: iconEndX, centerX: iconCenterX });
      }
    }
  }

  if (inPanel) {
    panelEndX = width;
    const iconCenterX = (currentIconStart + panelEndX) / 2;
    icons.push({ startX: currentIconStart, endX: panelEndX, centerX: iconCenterX });
  } else {
    if (icons.length > 0) {
      const lastIcon = icons[icons.length - 1];
      panelEndX = lastIcon.endX;
    }
  }

  if (icons.length === 0) return null;

  return { startX: panelStartX, endX: panelEndX, icons };
}

// ===== 主处理函数 =====

/**
 * 检测 Wiki 图片，返回精确的裁切坐标（纯前端模式）
 *
 * @param imageUrl - 图片 URL
 * @param params - 可选的检测参数覆盖
 * @returns 检测到的面板及其裁切坐标
 */
export async function detectWikiImage(
  imageUrl: string,
  params?: Partial<DetectionParams>
): Promise<DetectedPanel[]> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';

    img.onload = () => {
      try {
        // 合并参数
        const finalParams = { ...DEFAULT_DETECTION_PARAMS, ...params };

        // 1. 在内存中创建一个隐形的 Canvas
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');

        if (!ctx) {
          return reject(new Error('无法创建 Canvas 上下文'));
        }

        // 2. 将图片绘制到内存 Canvas 并提取像素数据
        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const pixelBuffer = Buffer.from(imageData.data);

        // 3. 执行 Y 轴扫描，找大框
        const panelVerticalRanges = scanVerticalLine(
          imageData,
          finalParams.scanLineX,
          finalParams.scanStartY,
          finalParams.colorTolerance,
          finalParams.sustainedPixels,
          canvas.width,
          canvas.height
        );

        if (panelVerticalRanges.length === 0) {
          console.warn('[WikiImageDetector] 未检测到任何 panel');
          resolve([]);
          return;
        }

        console.log(`[WikiImageDetector] Y轴扫描检测到 ${panelVerticalRanges.length} 个潜在区域`);

        // 4. 遍历处理每个 Panel
        const detectedPanels: DetectedPanel[] = [];

        for (let i = 0; i < panelVerticalRanges.length; i++) {
          const vRange = panelVerticalRanges[i];
          const midY = Math.round((vRange.startY + vRange.endY) / 2);

          // 执行 X 轴扫描
          const hRange = scanHorizontalLine(
            imageData,
            midY,
            finalParams.colorToleranceX,
            finalParams.sustainedPixelsX,
            canvas.width
          );

          const startX = hRange?.startX ?? 0;
          const width = hRange ? hRange.endX - hRange.startX : 0;
          const height = vRange.endY - vRange.startY;

          // 跳过标题逻辑：缩小扫描范围并直接挖掉绿框高度
          const padding = 10;
          const scanX = startX + padding;
          const scanY = vRange.startY + finalParams.gridStartY + padding;
          const scanWidth = width - padding * 2;
          const scanHeight = height - finalParams.gridStartY - padding * 2;

          // 边界检测
          const bounds = detectAllBounds(
            pixelBuffer,
            canvas.width,
            scanX,
            scanY,
            scanWidth,
            scanHeight,
            {
              windowHeight: finalParams.boundsWindowHeight,
              windowWidth: finalParams.boundsWindowWidth,
              varianceThresholdRow: finalParams.boundsVarianceThresholdRow,
              varianceThresholdCol: finalParams.boundsVarianceThresholdCol,
              stepSize: finalParams.boundsStepSize,
              minRowHeight: finalParams.boundsMinRowHeight,
              minColWidth: finalParams.boundsMinColWidth,
            }
          );

          // 计算坐标
          let boundsIcons = calculateIconPositionsFromBounds(bounds);

          // 过滤空图标
          if (finalParams.filterEmptyIcons) {
            boundsIcons = boundsIcons.filter((icon) => {
              const variance = calculateColorVariance(
                imageData,
                icon.leftX,
                icon.topY,
                icon.width,
                icon.height
              );
              return variance >= finalParams.emptyIconVarianceThreshold;
            });
          }

          // 计算 rows 和 cols
          const rows = bounds.rows.length;
          const cols = bounds.cols.length;
          const total = boundsIcons.length;

          // 应用 1:1 强制正方形
          const redBoxes = boundsIcons.map((icon) => {
            const { leftX, topY, width, height, centerX, centerY } = icon;

            let drawLeftX = leftX;
            let drawTopY = topY;
            let drawWidth = width;
            let drawHeight = height;

            if (finalParams.forceSquareIcons) {
              const squareSize = height;
              drawWidth = squareSize;
              drawHeight = squareSize;
              drawLeftX = centerX - squareSize / 2;
              drawTopY = centerY - squareSize / 2;
              drawLeftX += finalParams.forceSquareOffsetX;
              drawTopY += finalParams.forceSquareOffsetY;
            }

            return {
              x: drawLeftX,
              y: drawTopY,
              width: drawWidth,
              height: drawHeight,
            };
          });

          // 组装最终数据
          detectedPanels.push({
            title: `Panel_${i + 1}`,  // 纯前端模式无法识别标题，使用默认名称
            x: startX,
            y: vRange.startY,
            width: width,
            height: height,
            rows,
            cols,
            total,
            imageUrl: imageUrl,
            blueBox: {
              x: startX,
              y: vRange.startY,
              width: width,
              height: height,
            },
            greenBox: {
              x: startX,
              y: vRange.startY,
              width: width,
              height: finalParams.gridStartY,
            },
            redBoxes,
          });

          console.log(`[WikiImageDetector] Panel ${i + 1}: ${redBoxes.length} 个合成物 (${rows}行 × ${cols}列)`);
        }

        resolve(detectedPanels);
      } catch (error) {
        reject(error);
      }
    };

    img.onerror = () => {
      reject(new Error('图片加载失败'));
    };

    img.src = imageUrl;
  });
}
