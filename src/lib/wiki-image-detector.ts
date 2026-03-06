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

// ===== 图像增强函数 =====

/**
 * 🌟 图像边缘增强函数
 * 使用 Sobel 算子增强图像边缘，提高检测精度
 *
 * @param imageData - 原始 ImageData
 * @returns 增强后的 ImageData
 */
function enhanceImageEdges(imageData: ImageData): ImageData {
  const { data, width, height } = imageData;
  const enhanced = new ImageData(width, height);
  const enhancedData = enhanced.data;

  // 复制原始数据
  for (let i = 0; i < data.length; i++) {
    enhancedData[i] = data[i];
  }

  // Sobel 算子卷积核
  const sobelX = [
    -1, 0, 1,
    -2, 0, 2,
    -1, 0, 1
  ];

  const sobelY = [
    -1, -2, -1,
    0,  0,  0,
    1,  2,  1
  ];

  // 对每个像素应用 Sobel 算子
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      let gx = 0, gy = 0;

      // 3x3 窗口卷积
      for (let ky = -1; ky <= 1; ky++) {
        for (let kx = -1; kx <= 1; kx++) {
          const idx = ((y + ky) * width + (x + kx)) * 4;
          const gray = (data[idx] + data[idx + 1] + data[idx + 2]) / 3;
          const kernelIdx = (ky + 1) * 3 + (kx + 1);

          gx += gray * sobelX[kernelIdx];
          gy += gray * sobelY[kernelIdx];
        }
      }

      // 计算边缘强度
      const magnitude = Math.sqrt(gx * gx + gy * gy);

      // 应用边缘增强（只增强边缘，保留原始颜色）
      const idx = (y * width + x) * 4;
      const edgeFactor = Math.min(magnitude / 100, 1.5); // 限制增强倍数

      enhancedData[idx] = Math.min(255, data[idx] * (1 + edgeFactor * 0.3));
      enhancedData[idx + 1] = Math.min(255, data[idx + 1] * (1 + edgeFactor * 0.3));
      enhancedData[idx + 2] = Math.min(255, data[idx + 2] * (1 + edgeFactor * 0.3));
    }
  }

  console.log(`[图像增强] Sobel 边缘增强完成`);
  return enhanced;
}

/**
 * 🌟 对比度增强函数
 * 简单的对比度增强，使颜色差异更明显
 *
 * @param imageData - 原始 ImageData
 * @param contrast - 对比度系数（1.0 = 原始，>1.0 = 增强）
 * @returns 增强后的 ImageData
 */
function enhanceContrast(imageData: ImageData, contrast: number = 1.3): ImageData {
  const { data, width, height } = imageData;
  const enhanced = new ImageData(width, height);
  const factor = (259 * (contrast * 255 + 255)) / (255 * (259 - contrast * 255));

  for (let i = 0; i < data.length; i += 4) {
    // 只处理 RGB 通道
    enhanced.data[i] = Math.min(255, Math.max(0, factor * (data[i] - 128) + 128));
    enhanced.data[i + 1] = Math.min(255, Math.max(0, factor * (data[i + 1] - 128) + 128));
    enhanced.data[i + 2] = Math.min(255, Math.max(0, factor * (data[i + 2] - 128) + 128));
    enhanced.data[i + 3] = data[i + 3]; // Alpha 通道保持不变
  }

  console.log(`[图像增强] 对比度增强完成 (系数: ${contrast})`);
  return enhanced;
}

// ===== 类型定义 =====

// 🌟 新增：面板元数据接口，让算法知道期待的目标
export interface MetaPanel {
  title?: string;
  total?: number;
  rows?: number;
  cols?: number;
}

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
  redBoxes: Array<{ x: number; y: number; width: number; height: number; iconIndex?: number; row?: number; col?: number }>;
  originalWidth?: number;  // 🌟 新增：归一化前的原始宽度（可选）
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

  // 🌟 图像增强
  enableImageEnhancement: boolean;  // 是否启用图像增强（边缘增强 + 对比度增强）
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
  boundsMinRowHeight: 10,  // 降低阈值，支持单行布局
  boundsMinColWidth: 20,

  // 1:1强制正方形
  forceSquareIcons: true,
  forceSquareOffsetX: 0,
  forceSquareOffsetY: 12,  // 🌟 调整：将首行检测位置向下移动10px（从2调整为12）

  // 空图标过滤
  filterEmptyIcons: true,
  emptyIconVarianceThreshold: 20,

  // 🌟 图像增强
  enableImageEnhancement: true,  // 默认启用图像增强
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
 *
 * 改进：支持大步长扫描，提高超大图片的扫描效率
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
  height: number,
  stepSize: number = 1  // 🌟 新增：扫描步长，默认为1（逐像素扫描）
): PanelVerticalRange[] {
  const { data } = imageData;
  const panels: PanelVerticalRange[] = [];

  // 边界检查
  if (scanLineX < 0 || scanLineX >= width || scanStartY < 0 || scanStartY >= height) {
    return panels;
  }

  // 🌟 自动优化步长：对于超大图片（高度 > 5000），使用更大的步长
  const autoStepSize = height > 5000 ? Math.max(stepSize, 5) : stepSize;
  console.log(`[scanVerticalLine] 图片高度: ${height}px, 使用步长: ${autoStepSize}px`);

  const getPixelColor = (x: number, y: number): [number, number, number] => {
    const index = (y * width + x) * 4;
    return [data[index], data[index + 1], data[index + 2]];
  };

  const backgroundColor = getPixelColor(scanLineX, scanStartY);

  let inPanel = false;
  let consecutiveBg = 0;
  let consecutivePanel = 0;
  let currentStartY = 0;

  // 🌟 使用优化后的步长扫描
  for (let y = scanStartY; y < height; y += autoStepSize) {
    const currentColor = getPixelColor(scanLineX, y);
    const diff = colorDiff(currentColor, backgroundColor);

    if (diff > colorTolerance) {
      consecutivePanel += autoStepSize;
      consecutiveBg = 0;

      if (!inPanel && consecutivePanel >= sustainedPixels) {
        inPanel = true;
        currentStartY = y - consecutivePanel + autoStepSize;
      }
    } else {
      consecutiveBg += autoStepSize;
      consecutivePanel = 0;

      if (inPanel && consecutiveBg >= sustainedPixels) {
        inPanel = false;
        const endY = y - consecutiveBg + autoStepSize;
        panels.push({ startY: currentStartY, endY });
      }
    }
  }

  console.log(`[scanVerticalLine] 扫描完成，检测到 ${panels.length} 个面板`);
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
 * @param metaPanels - LLM 识别的面板元数据（用于对齐和截断）
 * @returns 检测到的面板及其裁切坐标
 */
export async function detectWikiImage(
  imageUrl: string,
  params?: Partial<DetectionParams>,
  metaPanels?: MetaPanel[] // 🌟 新增：传入从 LLM 拿到的面板数据
): Promise<DetectedPanel[]> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';

    img.onload = () => {
      try {
        // 🌟 修复脱节 1：自动读取你在调试台调好的 LocalStorage 参数！
        let storageParams = {};
        if (typeof window !== 'undefined') {
          const saved = localStorage.getItem('wiki_slice_config');
          if (saved) {
            storageParams = JSON.parse(saved);
            console.log('[WikiImageDetector] 成功加载调试台参数:', storageParams);
          }
        }

        // 优先级：传入 params > LocalStorage参数 > 默认参数
        const finalParams = { ...DEFAULT_DETECTION_PARAMS, ...storageParams, ...params };

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
        let imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

        // 🌟 2.5：图像增强（边缘增强 + 对比度增强）- 可选功能
        if (finalParams.enableImageEnhancement) {
          console.log(`[WikiImageDetector] 开始图像增强...`);
          imageData = enhanceContrast(imageData, 1.3);  // 对比度增强 30%
          imageData = enhanceImageEdges(imageData);     // Sobel 边缘增强
        } else {
          console.log(`[WikiImageDetector] 跳过图像增强（已禁用）`);
        }

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

          // 🌟 获取当前面板的"上帝视角"信息
          const meta = metaPanels && metaPanels[i] ? metaPanels[i] : null;

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

          // 🌟 修复脱节 2：应用我们在调试台使用的"总数截断"终极必杀技
          if (meta && meta.total && meta.total < boundsIcons.length) {
            console.log(`[WikiImageDetector] 根据 total=${meta.total} 截断多余框体`);
            boundsIcons = boundsIcons.slice(0, meta.total);
          }

          // 计算 rows 和 cols
          const rows = meta?.rows ?? bounds.rows.length;
          const cols = meta?.cols ?? bounds.cols.length;
          const total = meta?.total ?? boundsIcons.length;

          // 应用 1:1 强制正方形
          const redBoxes = boundsIcons.map((icon, iconIndex) => {
            const { leftX, topY, width, height, centerX, centerY, row, col } = icon;

            let drawLeftX = leftX;
            let drawTopY = topY;
            let drawWidth = width;
            let drawHeight = height;

            if (finalParams.forceSquareIcons) {
              const squareSize = height;
              drawWidth = squareSize;
              drawHeight = squareSize;
              drawLeftX = centerX - squareSize / 2 + finalParams.forceSquareOffsetX;
              drawTopY = centerY - squareSize / 2 + finalParams.forceSquareOffsetY;
            }

            // 🌟 修复脱节 3：保留真实的行列号和序号，防止后端算错
            return {
              x: drawLeftX,
              y: drawTopY,
              width: drawWidth,
              height: drawHeight,
              iconIndex: iconIndex,
              row: row,
              col: col
            };
          });

          // 🌟 打点1 - 检测器内部
          console.log(`[打点1 - 检测器内部] Panel ${i + 1} 准备输出:`, {
            title: meta?.title,
            metaTotal: meta?.total,
            calculatedRows: rows,
            calculatedCols: cols,
            finalRedBoxesCount: redBoxes.length // 最关键！看看算出来了几个红框
          });

          // 组装最终数据
          detectedPanels.push({
            title: meta?.title || `Panel_${i + 1}`, // 优先使用后端识别的名字
            x: startX,
            y: vRange.startY,
            width: width,
            height: height,
            rows: rows,
            cols: cols,
            total: total,
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

          console.log(`[WikiImageDetector] Panel ${i + 1} (${meta?.title || '未知'}): ${redBoxes.length} 个合成物 (${rows}行 × ${cols}列)`);
        }

        // 🌟 新增：宽度归一化逻辑
        // 如果超过半数的大panel宽度在某个数值±10之间波动，自动将所有大panel宽度设置为这个数值
        if (detectedPanels.length > 0) {
          const widthStats = normalizePanelWidths(detectedPanels);
          if (widthStats.applied) {
            console.log(`[WikiImageDetector] ✅ 宽度归一化已应用：目标宽度 ${widthStats.targetWidth}px，影响 ${widthStats.affectedCount} 个面板`);
          }
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

/**
 * 🌟 宽度归一化函数
 * 如果超过半数的大panel宽度在某个数值±10之间波动，自动将所有大panel宽度设置为这个数值
 *
 * @param panels - 检测到的所有面板
 * @returns 归一化结果（是否应用、目标宽度、影响数量、归一化详情）
 */
interface NormalizedPanelInfo {
  panelIndex: number;
  oldWidth: number;
  newWidth: number;
  title: string;
}

function normalizePanelWidths(panels: DetectedPanel[]): {
  applied: boolean;
  targetWidth: number | null;
  affectedCount: number;
  normalizedPanels: NormalizedPanelInfo[];  // 🌟 新增：归一化的详细列表
} {
  console.log('='.repeat(60));
  console.log('[normalizePanelWidths] 🎯 开始宽度归一化分析');
  console.log('='.repeat(60));

  if (panels.length === 0) {
    console.log('[normalizePanelWidths] ❌ 没有面板需要归一化');
    return {
      applied: false,
      targetWidth: null,
      affectedCount: 0,
      normalizedPanels: []  // 🌟 空数组
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

  // 3. 找出出现频率最高的宽度分组
  let maxCount = 0;
  let targetWidth: number | null = null;

  console.log(`[normalizePanelWidths] 📈 宽度频率统计结果（容差±${tolerance}px）:`);
  for (const [baseWidth, count] of Array.from(widthFrequency.entries()).sort((a, b) => b[1] - a[1])) {
    const percentage = (count / panels.length * 100).toFixed(1);
    console.log(`  ${baseWidth}px: ${count} 个面板 (${percentage}%) ${count === maxCount ? '🔥' : ''}`);
  }

  for (const [baseWidth, count] of widthFrequency) {
    if (count > maxCount) {
      maxCount = count;
      targetWidth = baseWidth;
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
      normalizedPanels: []  // 🌟 空数组
    };
  }

  // 5. 应用归一化：将所有面板宽度设置为目标宽度（强制归一化所有面板）
  console.log(`[normalizePanelWidths] 🔧 开始应用归一化（强制归一化所有面板）...`);
  console.log(`  目标宽度: ${targetWidth}px`);
  console.log(`  归一化范围: 所有 ${panels.length} 个面板`);

  let affectedCount = 0;
  const normalizedPanels: NormalizedPanelInfo[] = [];  // 🌟 记录归一化详情

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

  console.log(`[normalizePanelWidths] ✅ 归一化完成！`);
  console.log(`  目标宽度: ${targetWidth}px`);
  console.log(`  影响面板: ${affectedCount} / ${panels.length} 个 (${(affectedCount / panels.length * 100).toFixed(1)}%)`);
  console.log(`  归一化详情: [${normalizedPanels.map(p => `Panel${p.panelIndex + 1}:${p.oldWidth}→${p.newWidth}`).join(', ')}]`);
  console.log('='.repeat(60));

  return {
    applied: true,
    targetWidth,
    affectedCount,
    normalizedPanels  // 🌟 返回归一化详情
  };
}
