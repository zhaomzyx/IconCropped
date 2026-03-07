/**
 * Wiki 图片检测器（纯前端模式）
 * 不依赖 LLM，直接在浏览器中检测图片中的面板和图标
 * 适用于工作台等不需要 LLM 元数据的场景
 */

import { Buffer } from "buffer";
import {
  detectAllBounds,
  calculateIconPositionsFromBounds,
} from "@/lib/sliding-window-detection";

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
  redBoxes: Array<{
    x: number;
    y: number;
    width: number;
    height: number;
    iconIndex?: number;
    row?: number;
    col?: number;
  }>;
}

export interface DetectionParams {
  // 合成链板宽度（统一覆盖所有大 panel 的宽度）
  chainBoardWidth: number;

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

  // 多行图标检测参数（与 debug 页面保持一致，当前核心流程未使用）
  iconLineOffset?: number;
  iconLineGap?: number;
  minIconsPerLine?: number;

  // 滑动窗口历史参数（与 debug 页面保持一致，当前核心流程未使用）
  slidingWindowRows?: number;
  slidingWindowCols?: number;
  slidingWindowDiffThreshold?: number;
  slidingWindowStepSize?: number;
  slidingWindowMinGap?: number;

  // 保留与 debug 页面一致的开关参数
  useBoundsDetection?: boolean;

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

  // 视觉识别兜底（当边界检测结果不足时启用）
  useVisionFallback?: boolean;
}

// 默认检测参数（基于调试台验证的最优参数）
export const DEFAULT_DETECTION_PARAMS: DetectionParams = {
  // 合成链板宽度
  chainBoardWidth: 904,

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

  // 多行图标检测参数（与 debug 页面同默认值）
  iconLineOffset: 107,
  iconLineGap: 144,
  minIconsPerLine: 5,

  // 滑动窗口历史参数（与 debug 页面同默认值）
  slidingWindowRows: 20,
  slidingWindowCols: 20,
  slidingWindowDiffThreshold: 30,
  slidingWindowStepSize: 5,
  slidingWindowMinGap: 50,

  // 与 debug 页面保持一致（固定使用边界检测）
  useBoundsDetection: true,

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
  forceSquareOffsetY: 2,

  // 空图标过滤
  filterEmptyIcons: true,
  emptyIconVarianceThreshold: 20,

  // 视觉识别兜底
  useVisionFallback: true,
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
  height: number,
): number {
  const { data } = imageData;
  let rSum = 0,
    gSum = 0,
    bSum = 0;
  let count = 0;

  // 计算平均值
  for (let py = y; py < y + height; py++) {
    for (let px = x; px < x + width; px++) {
      if (px < 0 || py < 0 || px >= imageData.width || py >= imageData.height)
        continue;
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
      if (px < 0 || py < 0 || px >= imageData.width || py >= imageData.height)
        continue;
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
  color2: [number, number, number],
): number {
  return Math.max(
    Math.abs(color1[0] - color2[0]),
    Math.abs(color1[1] - color2[1]),
    Math.abs(color1[2] - color2[2]),
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function percentile(values: number[], ratio: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = clamp(
    Math.floor((sorted.length - 1) * ratio),
    0,
    sorted.length - 1,
  );
  return sorted[index];
}

function median(values: number[]): number {
  return percentile(values, 0.5);
}

function estimateAdaptiveTolerance(
  diffs: number[],
  baseTolerance: number,
): number {
  if (diffs.length === 0) return baseTolerance;

  // Use robust quantiles so highlights/shadows do not dominate.
  const p50 = percentile(diffs, 0.5);
  const p75 = percentile(diffs, 0.75);

  // Keep adaptive mode conservative: allow slight increase, avoid swallowing panel edges.
  const dynamicTolerance = Math.round(p50 + (p75 - p50) * 0.8 + 2);
  const maxAdaptive = baseTolerance + 10;
  return clamp(Math.max(baseTolerance, dynamicTolerance), 8, maxAdaptive);
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
): PanelVerticalRange[] {
  const { data } = imageData;
  const panels: PanelVerticalRange[] = [];

  // 边界检查
  if (
    scanLineX < 0 ||
    scanLineX >= width ||
    scanStartY < 0 ||
    scanStartY >= height
  ) {
    return panels;
  }

  const getPixelColor = (x: number, y: number): [number, number, number] => {
    const index = (y * width + x) * 4;
    return [data[index], data[index + 1], data[index + 2]];
  };

  const backgroundColor = getPixelColor(scanLineX, scanStartY);
  const verticalDiffs: number[] = [];
  const localSampleEndY = Math.min(height, scanStartY + 220);
  for (let y = scanStartY; y < localSampleEndY; y += 2) {
    verticalDiffs.push(colorDiff(getPixelColor(scanLineX, y), backgroundColor));
  }
  let effectiveTolerance = estimateAdaptiveTolerance(
    verticalDiffs,
    colorTolerance,
  );
  console.log(
    `[scanVerticalLine] baseTolerance=${colorTolerance}, adaptiveTolerance=${effectiveTolerance}`,
  );

  let inPanel = false;
  let consecutiveBg = 0;
  let consecutivePanel = 0;
  let currentStartY = 0;

  for (let y = scanStartY; y < height; y++) {
    const currentColor = getPixelColor(scanLineX, y);
    const diff = colorDiff(currentColor, backgroundColor);

    if (diff > effectiveTolerance) {
      consecutivePanel++;
      consecutiveBg = 0;

      if (!inPanel && consecutivePanel >= sustainedPixels) {
        inPanel = true;
        currentStartY = y - sustainedPixels + 1;
      }
    } else {
      consecutiveBg++;
      consecutivePanel = 0;

      if (inPanel && consecutiveBg >= sustainedPixels) {
        inPanel = false;
        const endY = y - sustainedPixels + 1;
        panels.push({ startY: currentStartY, endY });
      }
    }
  }

  // Fallback: if adaptive threshold finds nothing, retry once with base tolerance.
  if (panels.length === 0 && effectiveTolerance !== colorTolerance) {
    console.log("[scanVerticalLine] fallback to base tolerance scan");
    effectiveTolerance = colorTolerance;
    inPanel = false;
    consecutiveBg = 0;
    consecutivePanel = 0;
    currentStartY = 0;

    for (let y = scanStartY; y < height; y++) {
      const currentColor = getPixelColor(scanLineX, y);
      const diff = colorDiff(currentColor, backgroundColor);

      if (diff > effectiveTolerance) {
        consecutivePanel++;
        consecutiveBg = 0;

        if (!inPanel && consecutivePanel >= sustainedPixels) {
          inPanel = true;
          currentStartY = y - sustainedPixels + 1;
        }
      } else {
        consecutiveBg++;
        consecutivePanel = 0;

        if (inPanel && consecutiveBg >= sustainedPixels) {
          inPanel = false;
          const endY = y - sustainedPixels + 1;
          panels.push({ startY: currentStartY, endY });
        }
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

interface IconBox {
  leftX: number;
  topY: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
  row: number;
  col: number;
}

function dedupeIconBoxes<
  T extends { leftX: number; topY: number; width: number; height: number },
>(boxes: T[]): T[] {
  if (boxes.length <= 1) return boxes;

  const sorted = [...boxes].sort(
    (a, b) => a.topY - b.topY || a.leftX - b.leftX,
  );
  const kept: T[] = [];

  const iou = (a: T, b: T): number => {
    const ax2 = a.leftX + a.width;
    const ay2 = a.topY + a.height;
    const bx2 = b.leftX + b.width;
    const by2 = b.topY + b.height;

    const ix1 = Math.max(a.leftX, b.leftX);
    const iy1 = Math.max(a.topY, b.topY);
    const ix2 = Math.min(ax2, bx2);
    const iy2 = Math.min(ay2, by2);

    const iw = Math.max(0, ix2 - ix1);
    const ih = Math.max(0, iy2 - iy1);
    const inter = iw * ih;
    if (inter <= 0) return 0;

    const areaA = a.width * a.height;
    const areaB = b.width * b.height;
    const union = areaA + areaB - inter;
    return union > 0 ? inter / union : 0;
  };

  for (const box of sorted) {
    const duplicateIndex = kept.findIndex((k) => {
      const overlap = iou(k, box);
      const cxA = k.leftX + k.width / 2;
      const cyA = k.topY + k.height / 2;
      const cxB = box.leftX + box.width / 2;
      const cyB = box.topY + box.height / 2;
      const centerDist = Math.hypot(cxA - cxB, cyA - cyB);
      const avgSize =
        (Math.max(k.width, k.height) + Math.max(box.width, box.height)) / 2;
      return overlap > 0.45 || centerDist < avgSize * 0.28;
    });

    if (duplicateIndex === -1) {
      kept.push(box);
      continue;
    }

    const prev = kept[duplicateIndex];
    const prevArea = prev.width * prev.height;
    const nextArea = box.width * box.height;
    if (nextArea > prevArea) {
      kept[duplicateIndex] = box;
    }
  }

  return kept;
}

interface HorizontalRangeRecord {
  startX: number;
  endX: number;
  lineIdx: number;
  scanY: number;
}

function scanHorizontalLine(
  imageData: ImageData,
  scanY: number,
  colorTolerance: number,
  sustainedPixels: number,
  width: number,
): PanelHorizontalRange | null {
  const { data } = imageData;

  const getPixelColor = (x: number, y: number): [number, number, number] => {
    const index = (y * width + x) * 4;
    return [data[index], data[index + 1], data[index + 2]];
  };

  // Use median background from left region to reduce decoration noise.
  const bgSampleEndX = Math.max(20, Math.floor(width * 0.15));
  const sampleR: number[] = [];
  const sampleG: number[] = [];
  const sampleB: number[] = [];
  for (let x = 0; x < bgSampleEndX; x += 2) {
    const [r, g, b] = getPixelColor(x, scanY);
    sampleR.push(r);
    sampleG.push(g);
    sampleB.push(b);
  }
  const backgroundColor: [number, number, number] = [
    Math.round(median(sampleR)),
    Math.round(median(sampleG)),
    Math.round(median(sampleB)),
  ];
  const horizontalDiffs: number[] = [];
  const localSampleEndX = Math.min(width, 260);
  for (let x = 0; x < localSampleEndX; x += 2) {
    horizontalDiffs.push(colorDiff(getPixelColor(x, scanY), backgroundColor));
  }
  const effectiveTolerance = estimateAdaptiveTolerance(
    horizontalDiffs,
    colorTolerance,
  );

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

    if (diff > effectiveTolerance) {
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
        icons.push({
          startX: currentIconStart,
          endX: iconEndX,
          centerX: iconCenterX,
        });
      }
    }
  }

  if (inPanel) {
    panelEndX = width;
    const iconCenterX = (currentIconStart + panelEndX) / 2;
    icons.push({
      startX: currentIconStart,
      endX: panelEndX,
      centerX: iconCenterX,
    });
  } else {
    if (icons.length > 0) {
      const lastIcon = icons[icons.length - 1];
      panelEndX = lastIcon.endX;
    }
  }

  if (icons.length === 0) return null;

  return { startX: panelStartX, endX: panelEndX, icons };
}

function mergeHorizontalRangesWithVotes(
  rangeRecords: HorizontalRangeRecord[],
): Array<{
  startX: number;
  endX: number;
  votes: Set<number>;
  starts: number[];
  ends: number[];
  scanYs: number[];
}> {
  const sorted = [...rangeRecords].sort((a, b) => a.startX - b.startX);
  const merged: Array<{
    startX: number;
    endX: number;
    votes: Set<number>;
    starts: number[];
    ends: number[];
    scanYs: number[];
  }> = [];

  for (const item of sorted) {
    const target = merged.find(
      (m) => item.startX <= m.endX + 30 && item.endX >= m.startX - 30,
    );

    if (target) {
      target.startX = Math.min(target.startX, item.startX);
      target.endX = Math.max(target.endX, item.endX);
      target.votes.add(item.lineIdx);
      target.starts.push(item.startX);
      target.ends.push(item.endX);
      target.scanYs.push(item.scanY);
    } else {
      merged.push({
        startX: item.startX,
        endX: item.endX,
        votes: new Set([item.lineIdx]),
        starts: [item.startX],
        ends: [item.endX],
        scanYs: [item.scanY],
      });
    }
  }

  return merged;
}

function detectHorizontalRangeByVoting(
  imageData: ImageData,
  panelRange: PanelVerticalRange,
  gridStartY: number,
  colorTolerance: number,
  sustainedPixels: number,
  width: number,
  height: number,
): PanelHorizontalRange | null {
  const votingInnerMargin = 6;
  const outerOffset = 30;
  const titleBottomOffset = 5;

  const panelTop = clamp(panelRange.startY, 0, height - 1);
  const panelBottom = clamp(panelRange.endY, panelTop + 1, height - 1);
  const titleBottomY = clamp(
    panelTop + gridStartY,
    panelTop + 1,
    panelBottom - 1,
  );

  // 用户指定的4根横线：上下外线 + 标题底线附近两根线。
  const candidateYs = [
    clamp(panelTop + outerOffset, panelTop + 1, panelBottom - 1),
    clamp(panelBottom - outerOffset, panelTop + 1, panelBottom - 1),
    clamp(titleBottomY - titleBottomOffset, panelTop + 1, panelBottom - 1),
    clamp(titleBottomY + titleBottomOffset, panelTop + 1, panelBottom - 1),
  ].filter((y, idx, arr) => arr.indexOf(y) === idx);

  const allRanges: HorizontalRangeRecord[] = [];
  let widestRange: PanelHorizontalRange | null = null;

  candidateYs.forEach((scanY, lineIdx) => {
    const rawRange = scanHorizontalLine(
      imageData,
      scanY,
      colorTolerance,
      sustainedPixels,
      width,
    );

    if (!rawRange) return;

    const shrinkStart = clamp(
      rawRange.startX + votingInnerMargin,
      0,
      width - 1,
    );
    const shrinkEnd = clamp(rawRange.endX - votingInnerMargin, 0, width - 1);
    if (shrinkEnd - shrinkStart < 60) {
      return;
    }

    const range: PanelHorizontalRange = {
      ...rawRange,
      startX: shrinkStart,
      endX: shrinkEnd,
    };

    allRanges.push({
      startX: range.startX,
      endX: range.endX,
      lineIdx,
      scanY,
    });

    if (
      !widestRange ||
      range.endX - range.startX > widestRange.endX - widestRange.startX
    ) {
      widestRange = range;
    }
  });

  if (allRanges.length === 0) {
    return null;
  }

  const merged = mergeHorizontalRangesWithVotes(allRanges);
  const requiredVotes = Math.max(2, Math.ceil(candidateYs.length * 0.5));
  const voted = merged
    .filter((m) => m.votes.size >= requiredVotes)
    .sort(
      (a, b) =>
        b.votes.size - a.votes.size ||
        Math.abs(b.endX - b.startX - (a.endX - a.startX)),
    );

  if (voted.length > 0) {
    const top = voted[0];
    const startMid = median(top.starts);
    const endMid = median(top.ends);

    // 仅保留接近中位边界的线，取“左右最统一”的结果。
    const inlierStarts = top.starts.filter((s) => Math.abs(s - startMid) <= 16);
    const inlierEnds = top.ends.filter((e) => Math.abs(e - endMid) <= 16);

    const robustStart = Math.round(
      median(inlierStarts.length > 0 ? inlierStarts : top.starts),
    );
    const robustEnd = Math.round(
      median(inlierEnds.length > 0 ? inlierEnds : top.ends),
    );

    const medianScanY = median(top.scanYs);
    const nearestLine = [...allRanges].sort(
      (a, b) =>
        Math.abs(a.scanY - medianScanY) - Math.abs(b.scanY - medianScanY),
    )[0];

    const iconsSource = nearestLine
      ? scanHorizontalLine(
          imageData,
          nearestLine.scanY,
          colorTolerance,
          sustainedPixels,
          width,
        )
      : widestRange;

    return {
      startX: robustStart,
      endX: robustEnd,
      icons: iconsSource?.icons || [],
    };
  }

  return widestRange;
}

function mergeVerticalRangesWithVotes(
  rangeRecords: Array<{ startY: number; endY: number; lineIdx: number }>,
  requiredVotes: number,
): PanelVerticalRange[] {
  if (rangeRecords.length === 0) return [];

  const sorted = [...rangeRecords].sort((a, b) => a.startY - b.startY);
  const merged: Array<{
    startY: number;
    endY: number;
    votes: Set<number>;
  }> = [];

  for (const item of sorted) {
    const target = merged.find(
      (m) => item.startY <= m.endY + 20 && item.endY >= m.startY - 20,
    );

    if (target) {
      target.startY = Math.min(target.startY, item.startY);
      target.endY = Math.max(target.endY, item.endY);
      target.votes.add(item.lineIdx);
    } else {
      merged.push({
        startY: item.startY,
        endY: item.endY,
        votes: new Set([item.lineIdx]),
      });
    }
  }

  return merged
    .filter((m) => m.votes.size >= requiredVotes)
    .map((m) => ({ startY: m.startY, endY: m.endY }));
}

function detectVerticalRangesByVoting(
  imageData: ImageData,
  scanLineX: number,
  scanStartY: number,
  colorTolerance: number,
  sustainedPixels: number,
  width: number,
  height: number,
): PanelVerticalRange[] {
  const offsets = [-24, -12, 0, 12, 24];
  const scanLines = offsets
    .map((offset) => clamp(scanLineX + offset, 0, width - 1))
    .filter((x, idx, arr) => arr.indexOf(x) === idx);

  const allRanges: Array<{ startY: number; endY: number; lineIdx: number }> =
    [];

  scanLines.forEach((x, lineIdx) => {
    const ranges = scanVerticalLine(
      imageData,
      x,
      scanStartY,
      colorTolerance,
      sustainedPixels,
      width,
      height,
    );
    ranges.forEach((r) => allRanges.push({ ...r, lineIdx }));
  });

  const requiredVotes = Math.max(2, Math.ceil(scanLines.length * 0.4));
  const voted = mergeVerticalRangesWithVotes(allRanges, requiredVotes);

  if (voted.length > 0) {
    console.log(
      `[detectVerticalRangesByVoting] 投票线=${scanLines.length}, requiredVotes=${requiredVotes}, panels=${voted.length}`,
    );
    return voted;
  }

  // Fallback to center line if voting is too strict on some images.
  return scanVerticalLine(
    imageData,
    scanLineX,
    scanStartY,
    colorTolerance,
    sustainedPixels,
    width,
    height,
  );
}

function detectIconBoxesByVision(
  imageData: ImageData,
  region: { x: number; y: number; width: number; height: number },
  baseTolerance: number,
): IconBox[] {
  const data = imageData.data;
  const imgW = imageData.width;
  const imgH = imageData.height;

  const x0 = clamp(Math.round(region.x), 0, imgW - 1);
  const y0 = clamp(Math.round(region.y), 0, imgH - 1);
  const w = clamp(Math.round(region.width), 1, imgW - x0);
  const h = clamp(Math.round(region.height), 1, imgH - y0);

  const samplePoints = [
    [x0 + 2, y0 + 2],
    [x0 + w - 3, y0 + 2],
    [x0 + 2, y0 + h - 3],
    [x0 + w - 3, y0 + h - 3],
  ];

  let br = 0;
  let bg = 0;
  let bb = 0;
  samplePoints.forEach(([sx, sy]) => {
    const idx = (Math.max(0, sy) * imgW + Math.max(0, sx)) * 4;
    br += data[idx];
    bg += data[idx + 1];
    bb += data[idx + 2];
  });
  const background: [number, number, number] = [
    Math.round(br / samplePoints.length),
    Math.round(bg / samplePoints.length),
    Math.round(bb / samplePoints.length),
  ];

  const mask = new Uint8Array(w * h);
  const threshold = clamp(baseTolerance + 10, 16, 70);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = ((y0 + y) * imgW + (x0 + x)) * 4;
      const rgb: [number, number, number] = [
        data[idx],
        data[idx + 1],
        data[idx + 2],
      ];
      const diff = colorDiff(rgb, background);
      if (diff > threshold) {
        mask[y * w + x] = 1;
      }
    }
  }

  const visited = new Uint8Array(w * h);
  const components: Array<{
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
    area: number;
  }> = [];
  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      if (!mask[p] || visited[p]) continue;

      let minX = x;
      let maxX = x;
      let minY = y;
      let maxY = y;
      let area = 0;
      const queue: Array<[number, number]> = [[x, y]];
      visited[p] = 1;

      while (queue.length > 0) {
        const [cx, cy] = queue.pop() as [number, number];
        area++;
        if (cx < minX) minX = cx;
        if (cx > maxX) maxX = cx;
        if (cy < minY) minY = cy;
        if (cy > maxY) maxY = cy;

        for (const [dx, dy] of dirs) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const np = ny * w + nx;
          if (!mask[np] || visited[np]) continue;
          visited[np] = 1;
          queue.push([nx, ny]);
        }
      }

      components.push({ minX, minY, maxX, maxY, area });
    }
  }

  const regionArea = w * h;
  const minArea = Math.max(80, Math.floor(regionArea * 0.00025));
  const maxArea = Math.max(minArea + 1, Math.floor(regionArea * 0.08));

  const filtered = components
    .map((c) => ({
      leftX: x0 + c.minX,
      topY: y0 + c.minY,
      width: c.maxX - c.minX + 1,
      height: c.maxY - c.minY + 1,
      area: c.area,
    }))
    .filter((c) => c.area >= minArea && c.area <= maxArea)
    .filter(
      (c) =>
        c.width >= 12 && c.height >= 12 && c.width <= 120 && c.height <= 120,
    )
    .filter((c) => {
      const ratio = c.width / Math.max(1, c.height);
      return ratio > 0.55 && ratio < 1.8;
    })
    .sort((a, b) => a.topY - b.topY || a.leftX - b.leftX);

  if (filtered.length === 0) return [];

  const avgHeight =
    filtered.reduce((sum, b) => sum + b.height, 0) / filtered.length;
  const rowThreshold = Math.max(10, avgHeight * 0.7);

  const rows: Array<typeof filtered> = [];
  filtered.forEach((box) => {
    const row = rows.find(
      (r) =>
        Math.abs(r[0].topY + r[0].height / 2 - (box.topY + box.height / 2)) <=
        rowThreshold,
    );
    if (row) {
      row.push(box);
      row.sort((a, b) => a.leftX - b.leftX);
    } else {
      rows.push([box]);
    }
  });

  rows.sort(
    (a, b) => a[0].topY + a[0].height / 2 - (b[0].topY + b[0].height / 2),
  );

  const result: IconBox[] = [];
  rows.forEach((row, rowIndex) => {
    row.forEach((box, colIndex) => {
      result.push({
        leftX: box.leftX,
        topY: box.topY,
        width: box.width,
        height: box.height,
        centerX: box.leftX + box.width / 2,
        centerY: box.topY + box.height / 2,
        row: rowIndex,
        col: colIndex,
      });
    });
  });

  return result;
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
  metaPanels?: MetaPanel[], // 🌟 新增：传入从 LLM 拿到的面板数据
): Promise<DetectedPanel[]> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";

    img.onload = () => {
      try {
        // 🌟 修复脱节 1：自动读取你在调试台调好的 LocalStorage 参数！
        let storageParams = {};
        if (typeof window !== "undefined") {
          const saved = localStorage.getItem("wiki_slice_config");
          if (saved) {
            storageParams = JSON.parse(saved);
            console.log(
              "[WikiImageDetector] 成功加载调试台参数:",
              storageParams,
            );
          }
        }

        // 优先级：传入 params > LocalStorage参数 > 默认参数
        const finalParams = {
          ...DEFAULT_DETECTION_PARAMS,
          ...storageParams,
          ...params,
        };

        // 1. 在内存中创建一个隐形的 Canvas
        const canvas = document.createElement("canvas");
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext("2d");

        if (!ctx) {
          return reject(new Error("无法创建 Canvas 上下文"));
        }

        // 2. 将图片绘制到内存 Canvas 并提取像素数据
        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const pixelBuffer = Buffer.from(imageData.data);

        // 3. 执行 Y 轴扫描，找大框
        let panelVerticalRanges = detectVerticalRangesByVoting(
          imageData,
          finalParams.scanLineX,
          finalParams.scanStartY,
          finalParams.colorTolerance,
          finalParams.sustainedPixels,
          canvas.width,
          canvas.height,
        );

        if (panelVerticalRanges.length === 0) {
          const fallbackStartY = Math.max(
            40,
            Math.min(Math.floor(canvas.height * 0.12), finalParams.scanStartY),
          );

          if (fallbackStartY !== finalParams.scanStartY) {
            console.log(
              `[WikiImageDetector] 首次Y轴扫描无结果，使用 fallbackStartY=${fallbackStartY} 重试`,
            );
            panelVerticalRanges = detectVerticalRangesByVoting(
              imageData,
              finalParams.scanLineX,
              fallbackStartY,
              finalParams.colorTolerance,
              finalParams.sustainedPixels,
              canvas.width,
              canvas.height,
            );
          }
        }

        if (panelVerticalRanges.length === 0) {
          console.warn("[WikiImageDetector] 未检测到任何 panel");
          resolve([]);
          return;
        }

        console.log(
          `[WikiImageDetector] Y轴扫描检测到 ${panelVerticalRanges.length} 个潜在区域`,
        );

        // 4. 遍历处理每个 Panel
        const detectedPanels: DetectedPanel[] = [];

        for (let i = 0; i < panelVerticalRanges.length; i++) {
          const vRange = panelVerticalRanges[i];
          // 🌟 获取当前面板的"上帝视角"信息
          const meta = metaPanels && metaPanels[i] ? metaPanels[i] : null;

          // 执行 X 轴投票扫描（提高 panel 宽度稳定性）
          const hRange = detectHorizontalRangeByVoting(
            imageData,
            vRange,
            finalParams.gridStartY,
            finalParams.colorToleranceX,
            finalParams.sustainedPixelsX,
            canvas.width,
            canvas.height,
          );

          const rawStartX = hRange?.startX ?? 0;
          const rawEndX = hRange?.endX ?? rawStartX;
          const rawWidth = Math.max(0, rawEndX - rawStartX);

          let startX = rawStartX;
          let width = rawWidth;

          const unifiedWidth = Math.max(
            40,
            Math.round(finalParams.chainBoardWidth),
          );
          if (Number.isFinite(unifiedWidth) && unifiedWidth > 0) {
            const centerX =
              rawWidth > 0
                ? rawStartX + rawWidth / 2
                : rawStartX + unifiedWidth / 2;
            width = Math.min(canvas.width, unifiedWidth);
            startX = clamp(
              Math.round(centerX - width / 2),
              0,
              Math.max(0, canvas.width - width),
            );
          }

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
            },
          );

          // 计算坐标
          let boundsIcons = calculateIconPositionsFromBounds(bounds);

          if (
            finalParams.useVisionFallback !== false &&
            boundsIcons.length === 0
          ) {
            const fallbackIcons = detectIconBoxesByVision(
              imageData,
              {
                x: scanX,
                y: scanY,
                width: scanWidth,
                height: scanHeight,
              },
              finalParams.colorTolerance,
            );

            if (fallbackIcons.length > boundsIcons.length) {
              console.log(
                `[WikiImageDetector] 视觉兜底生效: bounds=${boundsIcons.length}, vision=${fallbackIcons.length}`,
              );
              boundsIcons = fallbackIcons;
            }
          }

          boundsIcons = dedupeIconBoxes(boundsIcons);

          // 过滤空图标
          if (finalParams.filterEmptyIcons) {
            boundsIcons = boundsIcons.filter((icon) => {
              const variance = calculateColorVariance(
                imageData,
                icon.leftX,
                icon.topY,
                icon.width,
                icon.height,
              );
              return variance >= finalParams.emptyIconVarianceThreshold;
            });
          }

          // 🌟 修复脱节 2：应用我们在调试台使用的"总数截断"终极必杀技
          if (meta && meta.total && meta.total < boundsIcons.length) {
            console.log(
              `[WikiImageDetector] 根据 total=${meta.total} 截断多余框体`,
            );
            boundsIcons = boundsIcons.slice(0, meta.total);
          }

          // 计算 rows 和 cols
          const rows = meta?.rows ?? bounds.rows.length;
          const cols = meta?.cols ?? bounds.cols.length;
          const total = meta?.total ?? boundsIcons.length;

          // 应用 1:1 强制正方形
          const redBoxes = boundsIcons.map((icon, iconIndex) => {
            const { leftX, topY, width, height, row, col } = icon;

            let drawLeftX = leftX;
            let drawTopY = topY;
            let drawWidth = width;
            let drawHeight = height;

            // 先去掉图标右侧的小三角连接区域：仅对非最后一列应用右侧裁剪。
            const isLastCol = typeof col === "number" && col >= cols - 1;
            if (!isLastCol) {
              const trimRight = Math.max(
                6,
                Math.min(18, Math.round(drawWidth * 0.1)),
              );
              drawWidth = Math.max(8, drawWidth - trimRight);
            }

            // 再做偏移校准与正方形，确保基于“去小三角后”的框体结果。
            if (finalParams.forceSquareIcons) {
              const squareSize = Math.max(8, Math.min(drawWidth, drawHeight));
              const adjustedCenterX = drawLeftX + drawWidth / 2;
              const adjustedCenterY = drawTopY + drawHeight / 2;
              drawWidth = squareSize;
              drawHeight = squareSize;
              drawLeftX =
                adjustedCenterX -
                squareSize / 2 +
                finalParams.forceSquareOffsetX;
              drawTopY =
                adjustedCenterY -
                squareSize / 2 +
                finalParams.forceSquareOffsetY;
            }

            // 🌟 修复脱节 3：保留真实的行列号和序号，防止后端算错
            return {
              x: drawLeftX,
              y: drawTopY,
              width: drawWidth,
              height: drawHeight,
              iconIndex: iconIndex,
              row: row,
              col: col,
            };
          });

          // 🌟 打点1 - 检测器内部
          console.log(`[打点1 - 检测器内部] Panel ${i + 1} 准备输出:`, {
            title: meta?.title,
            metaTotal: meta?.total,
            calculatedRows: rows,
            calculatedCols: cols,
            finalRedBoxesCount: redBoxes.length, // 最关键！看看算出来了几个红框
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

          console.log(
            `[WikiImageDetector] Panel ${i + 1} (${meta?.title || "未知"}): ${redBoxes.length} 个合成物 (${rows}行 × ${cols}列)`,
          );
        }

        resolve(detectedPanels);
      } catch (error) {
        reject(error);
      }
    };

    img.onerror = () => {
      reject(new Error("图片加载失败"));
    };

    img.src = imageUrl;
  });
}
