/**
 * Wiki 图片检测器（纯前端模式）
 * 不依赖 LLM，直接在浏览器中检测图片中的面板和图标
 * 适用于工作台等不需要 LLM 元数据的场景
 */

import { Buffer } from "buffer";
import {
  detectAllBounds,
  calculateIconPositionsFromBounds,
  type IconBoundsPosition,
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
  horizontalVoteDebug?: {
    initial?: PanelHorizontalVoteDebug;
    refined?: PanelHorizontalVoteDebug;
  };
}

export interface DetectionParams {
  // 合成链板宽度（统一覆盖所有大 panel 的宽度）
  chainBoardWidth: number;
  autoDetectPanelWidth?: boolean;

  // 绿框相关（标题区域）
  gridStartY: number;
  autoDetectTitleHeight?: boolean;
  localDividerRefineRange?: number;
  localDividerMinCoverageRatio?: number;
  localDividerDarkDeltaMin?: number;

  // 扫描线相关参数
  scanLineX: number;
  scanStartY: number;
  autoRefineScanStartY?: boolean;
  localScanStartRefineRange?: number;
  localScanStartSampleRadius?: number;
  scanStableVarianceThresholdFactor?: number;
  colorTolerance: number;
  sustainedPixels: number;

  // X轴检测参数
  colorToleranceX: number;
  sustainedPixelsX: number;
  panelWidthScanStep?: number;
  panelWidthVoteTolerance?: number;

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
  autoDetectPanelWidth: true,

  // 绿框相关（标题区域）
  gridStartY: 107,
  autoDetectTitleHeight: true,
  localDividerRefineRange: 10,
  localDividerMinCoverageRatio: 0.5,
  localDividerDarkDeltaMin: 2.1,

  // 扫描线相关参数
  scanLineX: 49,
  scanStartY: 200,
  autoRefineScanStartY: true,
  localScanStartRefineRange: 60,
  localScanStartSampleRadius: 3,
  scanStableVarianceThresholdFactor: 1,
  colorTolerance: 30,
  sustainedPixels: 5,

  // X轴检测参数
  colorToleranceX: 30,
  sustainedPixelsX: 5,
  panelWidthScanStep: 8,
  panelWidthVoteTolerance: 18,

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

// =============================================================================
// 核心算法分区（定位规则总览）
// A. 基础像素统计：方差/亮度/分位数等基础数学工具
// B. 标题区与扫描起点估计：用于 greenBox 顶部区域和稳定起扫点
// C. 大 panel 检测：Y 轴分段 + X 轴投票定宽
// D. 小 panel 候选框后处理：去重、行优先、尺寸主峰过滤、排序
// E. 小 panel 视觉兜底：边界检测失败时的连通域候选
// F. 主流程编排：整图 -> 大 panel -> 标题区 -> 小 panel -> 输出 blue/green/red 框
// =============================================================================

// ----- A. 基础像素统计工具 -----

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

function toLuma(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
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

// ----- B. 标题区与扫描起点估计（greenBox / 稳定扫描线） -----

function estimatePanelGridStartY(
  imageData: ImageData,
  panelX: number,
  panelY: number,
  panelWidth: number,
  panelHeight: number,
  params: DetectionParams,
): number {
  const fallback = Math.max(1, Math.round(params.gridStartY));
  if (params.autoDetectTitleHeight === false) return fallback;

  const imageWidth = imageData.width;
  const imageHeight = imageData.height;
  if (panelWidth < 120 || panelHeight < 120) return fallback;

  const expectedDividerY = panelY + fallback;
  const refineRange = Math.max(
    3,
    Math.round(params.localDividerRefineRange ?? 10),
  );
  const panelTop = clamp(panelY, 1, imageHeight - 2);
  const panelBottom = clamp(
    panelY + panelHeight - 1,
    panelTop + 1,
    imageHeight - 2,
  );
  const searchTop = clamp(
    expectedDividerY - refineRange,
    panelTop + 1,
    panelBottom - 1,
  );
  const searchBottom = clamp(
    expectedDividerY + refineRange,
    searchTop,
    panelBottom - 1,
  );

  const xStart = clamp(
    Math.round(panelX + panelWidth * 0.12),
    1,
    imageWidth - 2,
  );
  const xEnd = clamp(
    Math.round(panelX + panelWidth * 0.88),
    xStart + 2,
    imageWidth - 2,
  );
  const { data } = imageData;

  let bestY: number | null = null;
  let bestScore = -Infinity;
  const darkMin = params.localDividerDarkDeltaMin ?? 2.1;
  const minCoverage = params.localDividerMinCoverageRatio ?? 0.5;

  for (let y = searchTop; y <= searchBottom; y++) {
    let hit = 0;
    let count = 0;
    let darkSum = 0;

    for (let x = xStart; x <= xEnd; x += 2) {
      const idx = (y * imageWidth + x) * 4;
      const upIdx = ((y - 1) * imageWidth + x) * 4;
      const downIdx = ((y + 1) * imageWidth + x) * 4;

      const cur = toLuma(data[idx], data[idx + 1], data[idx + 2]);
      const up = toLuma(data[upIdx], data[upIdx + 1], data[upIdx + 2]);
      const down = toLuma(data[downIdx], data[downIdx + 1], data[downIdx + 2]);
      const darkDelta = (up + down) / 2 - cur;

      if (darkDelta > darkMin) hit++;
      darkSum += darkDelta;
      count++;
    }

    if (count === 0) continue;
    const coverage = hit / count;
    if (coverage < minCoverage) continue;

    const avgDark = darkSum / count;
    const distancePenalty = Math.abs(y - expectedDividerY) * 0.2;
    const score = coverage * 10 + avgDark - distancePenalty;
    if (score > bestScore) {
      bestScore = score;
      bestY = y;
    }
  }

  if (bestY === null) {
    return fallback;
  }

  const delta = bestY - expectedDividerY;
  const candidate = fallback + delta;
  const minGridStartY = Math.max(50, Math.round(132 * 0.38));
  const maxGridStartY = Math.max(
    minGridStartY,
    panelHeight - Math.round(132 * 0.45),
  );
  return clamp(candidate, minGridStartY, maxGridStartY);
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

function estimateLocalStableScanStartY(
  imageData: ImageData,
  scanLineX: number,
  requestedScanStartY: number,
  params: DetectionParams,
): number {
  void scanLineX;
  const width = imageData.width;
  const height = imageData.height;
  const fallbackY = clamp(Math.round(requestedScanStartY), 0, height - 1);

  if (params.autoRefineScanStartY === false) {
    return fallbackY;
  }

  if (height < 6 || width < 6) {
    return fallbackY;
  }

  const refineRange = Math.max(
    2,
    Math.round(params.localScanStartRefineRange ?? 60),
  );
  const sampleRadius = Math.max(
    1,
    Math.round(params.localScanStartSampleRadius ?? 3),
  );

  const searchTop = clamp(fallbackY - refineRange, 0, height - 1);
  const searchBottom = clamp(fallbackY + refineRange, searchTop, height - 1);
  const minStableHeight = 4;

  const xStart = 0;
  const xEnd = width - 1;
  const xStep = Math.max(1, sampleRadius);

  const { data } = imageData;

  const samples: Array<{ y: number; score: number }> = [];

  for (let y = searchTop; y <= searchBottom; y++) {
    let lumaSum = 0;
    let lumaSquareSum = 0;
    let count = 0;

    for (let x = xStart; x <= xEnd; x += xStep) {
      const idx = (y * width + x) * 4;
      const luma = toLuma(data[idx], data[idx + 1], data[idx + 2]);
      lumaSum += luma;
      lumaSquareSum += luma * luma;
      count++;
    }

    if (count === 0) continue;
    const mean = lumaSum / count;
    const variance = Math.max(0, lumaSquareSum / count - mean * mean);
    samples.push({ y, score: variance });
  }

  if (samples.length === 0) return fallbackY;

  const sortedScores = samples.map((s) => s.score).sort((a, b) => a - b);
  const bestScore = sortedScores[0];
  const p35 = percentile(sortedScores, 0.35);
  const thresholdFactor = clamp(
    params.scanStableVarianceThresholdFactor ?? 1,
    0.2,
    3,
  );
  const stableThreshold =
    bestScore + Math.max(0.6, (p35 - bestScore) * 1.15) * thresholdFactor;

  type Segment = {
    startY: number;
    endY: number;
    avgScore: number;
    len: number;
  };
  const segments: Segment[] = [];
  let segStart = -1;
  let segEnd = -1;
  let segScoreSum = 0;
  let segCount = 0;

  const flushSegment = () => {
    if (segStart < 0 || segCount === 0) return;
    const len = segEnd - segStart + 1;
    segments.push({
      startY: segStart,
      endY: segEnd,
      avgScore: segScoreSum / segCount,
      len,
    });
    segStart = -1;
    segEnd = -1;
    segScoreSum = 0;
    segCount = 0;
  };

  for (const sample of samples) {
    const isStable = sample.score <= stableThreshold;
    if (!isStable) {
      flushSegment();
      continue;
    }
    if (segStart < 0) {
      segStart = sample.y;
      segEnd = sample.y;
    } else {
      segEnd = sample.y;
    }
    segScoreSum += sample.score;
    segCount++;
  }
  flushSegment();

  if (segments.length === 0) {
    const bestSingle = samples.reduce((best, cur) =>
      cur.score < best.score ? cur : best,
    );
    const mid = bestSingle.y;
    const startY = clamp(
      mid - Math.floor(minStableHeight / 2),
      searchTop,
      Math.max(searchTop, searchBottom - minStableHeight + 1),
    );
    const endY = clamp(startY + minStableHeight - 1, startY, searchBottom);
    return Math.round((startY + endY) / 2);
  }

  const chosen = segments.sort((a, b) => {
    if (a.avgScore !== b.avgScore) return a.avgScore - b.avgScore;
    if (a.len !== b.len) return b.len - a.len;
    const aMid = (a.startY + a.endY) / 2;
    const bMid = (b.startY + b.endY) / 2;
    return Math.abs(aMid - fallbackY) - Math.abs(bMid - fallbackY);
  })[0];

  const normalizedStartY =
    chosen.len >= minStableHeight
      ? chosen.startY
      : clamp(
          Math.round((chosen.startY + chosen.endY) / 2) -
            Math.floor(minStableHeight / 2),
          searchTop,
          Math.max(searchTop, searchBottom - minStableHeight + 1),
        );
  const normalizedEndY =
    chosen.len >= minStableHeight
      ? chosen.endY
      : clamp(
          normalizedStartY + minStableHeight - 1,
          normalizedStartY,
          searchBottom,
        );

  const bestY = Math.round((normalizedStartY + normalizedEndY) / 2);

  return bestY;
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

// ----- C1. 大 panel：Y 轴范围检测（垂直分段） -----

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
  voteDebug?: PanelHorizontalVoteDebug;
}

interface PanelHorizontalVotePoint {
  lineIdx: number;
  scanY: number;
  rawStartX: number;
  rawEndX: number;
  startX: number;
  endX: number;
  startInlier: boolean;
  endInlier: boolean;
}

interface PanelHorizontalVoteDebug {
  candidateYs: number[];
  voteTolerance: number;
  startMedian: number;
  endMedian: number;
  robustStart: number;
  robustEnd: number;
  usedRobustResult: boolean;
  points: PanelHorizontalVotePoint[];
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

// ----- D. 小 panel 候选框后处理（去噪/聚类/排序） -----

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

function filterIconBoxesByMainRows<
  T extends {
    leftX: number;
    topY: number;
    width: number;
    height: number;
    row?: number;
    col?: number;
  },
>(boxes: T[], expectedTotal?: number): T[] {
  if (boxes.length <= 2) return boxes;

  const sortedByY = [...boxes].sort((a, b) => a.topY - b.topY);
  const avgHeight =
    sortedByY.reduce((sum, b) => sum + b.height, 0) / sortedByY.length;
  const rowThreshold = Math.max(10, avgHeight * 0.7);

  const rows: T[][] = [];
  sortedByY.forEach((box) => {
    const centerY = box.topY + box.height / 2;
    const targetRow = rows.find((row) => {
      const rowCenterY =
        row.reduce((sum, item) => sum + item.topY + item.height / 2, 0) /
        row.length;
      return Math.abs(centerY - rowCenterY) <= rowThreshold;
    });

    if (targetRow) {
      targetRow.push(box);
    } else {
      rows.push([box]);
    }
  });

  if (rows.length <= 1) return boxes;

  rows.forEach((row) => row.sort((a, b) => a.leftX - b.leftX));
  rows.sort((a, b) => {
    const aCenter =
      a.reduce((sum, item) => sum + item.topY + item.height / 2, 0) / a.length;
    const bCenter =
      b.reduce((sum, item) => sum + item.topY + item.height / 2, 0) / b.length;
    return aCenter - bCenter;
  });

  // 行优先：数量更多的行优先；数量相同则更靠上的行优先。
  const prioritizedRows = [...rows].sort((a, b) => {
    if (b.length !== a.length) return b.length - a.length;
    const aTop = Math.min(...a.map((x) => x.topY));
    const bTop = Math.min(...b.map((x) => x.topY));
    return aTop - bTop;
  });

  const keepRows: T[][] = [];
  let kept = 0;
  for (const row of prioritizedRows) {
    keepRows.push(row);
    kept += row.length;
    if (expectedTotal && expectedTotal > 0 && kept >= expectedTotal) {
      break;
    }
  }

  const selected = keepRows.flat();
  const selectedSet = new Set(selected);
  const filtered = boxes.filter((box) => selectedSet.has(box));
  return filtered.length > 0 ? filtered : boxes;
}

function filterIconBoxesByMainSize<
  T extends {
    width: number;
    height: number;
  },
>(boxes: T[]): T[] {
  if (boxes.length <= 3) return boxes;

  const pickMedian = (values: number[]): number => {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
      ? (sorted[mid - 1] + sorted[mid]) / 2
      : sorted[mid];
  };

  const widths = boxes.map((b) => Math.max(1, b.width));
  const heights = boxes.map((b) => Math.max(1, b.height));
  const areas = boxes.map((b) => Math.max(1, b.width * b.height));

  const medianW = pickMedian(widths);
  const medianH = pickMedian(heights);
  const medianA = pickMedian(areas);

  const minW = Math.max(20, medianW * 0.55);
  const minH = Math.max(20, medianH * 0.55);
  const minA = Math.max(400, medianA * 0.35);
  const maxW = Math.max(minW + 1, medianW * 1.9);
  const maxH = Math.max(minH + 1, medianH * 1.9);

  const filtered = boxes.filter((b) => {
    const area = b.width * b.height;
    return (
      b.width >= minW &&
      b.height >= minH &&
      area >= minA &&
      b.width <= maxW &&
      b.height <= maxH
    );
  });

  // 如果过滤过猛，回退原始结果，避免误删真实框。
  const minKeep = Math.max(2, Math.ceil(boxes.length * 0.5));
  return filtered.length >= minKeep ? filtered : boxes;
}

function sortIconBoxesStable<
  T extends { leftX: number; topY: number; width: number; height: number },
>(boxes: T[]): T[] {
  return [...boxes].sort((a, b) => {
    const ay = a.topY + a.height / 2;
    const by = b.topY + b.height / 2;
    if (Math.abs(ay - by) > Math.max(a.height, b.height) * 0.45) {
      return ay - by;
    }
    return a.leftX - b.leftX;
  });
}

interface HorizontalRangeRecord {
  startX: number;
  endX: number;
  lineIdx: number;
  scanY: number;
  rawStartX: number;
  rawEndX: number;
}

// ----- C2. 大 panel：X 轴单线扫描与投票定宽 -----

function scanHorizontalLine(
  imageData: ImageData,
  scanY: number,
  colorTolerance: number,
  sustainedPixels: number,
  width: number,
): PanelHorizontalRange | null {
  const { data } = imageData;
  void colorTolerance;
  void sustainedPixels;

  const getPixelColor = (x: number, y: number): [number, number, number] => {
    const index = (y * width + x) * 4;
    return [data[index], data[index + 1], data[index + 2]];
  };

  // 仅使用 10x1 滑动窗口方差峰值来确定左右边界。
  const varianceWindow = 10;
  const varianceStep = 1;
  const minSpan = 80;
  const luma = new Array<number>(width).fill(0);
  for (let x = 0; x < width; x++) {
    const [r, g, b] = getPixelColor(x, scanY);
    luma[x] = 0.299 * r + 0.587 * g + 0.114 * b;
  }

  if (width < varianceWindow + 2) {
    return null;
  }

  const varianceByX = new Array<number>(width).fill(0);
  let sum = 0;
  let sumSq = 0;
  for (let i = 0; i < varianceWindow; i++) {
    const v = luma[i];
    sum += v;
    sumSq += v * v;
  }

  const writeVariance = (startX: number, s: number, ss: number) => {
    const mean = s / varianceWindow;
    const variance = Math.max(0, ss / varianceWindow - mean * mean);
    const centerX = startX + Math.floor(varianceWindow / 2);
    varianceByX[centerX] = variance;
  };

  writeVariance(0, sum, sumSq);

  for (
    let startX = varianceStep;
    startX <= width - varianceWindow;
    startX += varianceStep
  ) {
    const leftOut = luma[startX - 1];
    const rightIn = luma[startX + varianceWindow - 1];
    sum += rightIn - leftOut;
    sumSq += rightIn * rightIn - leftOut * leftOut;
    writeVariance(startX, sum, sumSq);
  }

  const validValues = varianceByX.filter((v) => Number.isFinite(v) && v > 0);
  if (validValues.length === 0) {
    return null;
  }

  const sortedVar = [...validValues].sort((a, b) => a - b);
  const p80 = sortedVar[Math.floor((sortedVar.length - 1) * 0.8)] || 0;
  const varianceThreshold = Math.max(0.5, p80);

  const peaks: Array<{ x: number; score: number }> = [];
  for (let x = 1; x < width - 1; x++) {
    const cur = varianceByX[x];
    if (cur < varianceThreshold) continue;
    if (cur >= varianceByX[x - 1] && cur >= varianceByX[x + 1]) {
      peaks.push({ x, score: cur });
    }
  }

  if (peaks.length < 2) {
    return null;
  }

  let bestStartX = -1;
  let bestEndX = -1;
  let bestPairScore = -Infinity;

  const ordered = [...peaks].sort((a, b) => a.x - b.x);
  for (let i = 0; i < ordered.length; i++) {
    const left = ordered[i];
    for (let j = i + 1; j < ordered.length; j++) {
      const right = ordered[j];
      const span = right.x - left.x;
      if (span < minSpan) continue;

      const pairScore = left.score + right.score + span * 0.015;
      if (pairScore > bestPairScore) {
        bestPairScore = pairScore;
        bestStartX = left.x;
        bestEndX = right.x;
      }
    }
  }

  if (bestStartX < 0 || bestEndX <= bestStartX) {
    return null;
  }

  return {
    startX: clamp(bestStartX, 0, width - 1),
    endX: clamp(bestEndX, 0, width - 1),
    icons: [],
  };
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
  options?: {
    scanStep?: number;
    voteTolerance?: number;
  },
): PanelHorizontalRange | null {
  const panelInnerMargin = 12;
  const maxScanLines = 80;

  const panelTop = clamp(panelRange.startY, 0, height - 1);
  const panelBottom = clamp(panelRange.endY, panelTop + 1, height - 1);
  const titleBottomY = clamp(
    panelTop + gridStartY,
    panelTop + 1,
    panelBottom - 1,
  );
  const bandTop = clamp(
    Math.min(panelTop + panelInnerMargin, titleBottomY),
    panelTop + 1,
    panelBottom - 1,
  );
  const bandBottom = clamp(
    panelBottom - panelInnerMargin,
    bandTop,
    panelBottom - 1,
  );

  const desiredStep = Math.max(3, Math.round(options?.scanStep ?? 8));
  const bandHeight = Math.max(1, bandBottom - bandTop + 1);
  const adaptiveStep = Math.max(
    desiredStep,
    Math.ceil(bandHeight / maxScanLines),
  );

  const candidateYs: number[] = [];
  for (let y = bandTop; y <= bandBottom; y += adaptiveStep) {
    candidateYs.push(y);
  }
  if (
    candidateYs.length === 0 ||
    candidateYs[candidateYs.length - 1] !== bandBottom
  ) {
    candidateYs.push(bandBottom);
  }

  const allRanges: HorizontalRangeRecord[] = [];

  candidateYs.forEach((scanY, lineIdx) => {
    const rawRange = scanHorizontalLine(
      imageData,
      scanY,
      colorTolerance,
      sustainedPixels,
      width,
    );

    if (!rawRange) return;

    if (rawRange.endX - rawRange.startX < 60) {
      return;
    }

    allRanges.push({
      startX: rawRange.startX,
      endX: rawRange.endX,
      lineIdx,
      scanY,
      rawStartX: rawRange.startX,
      rawEndX: rawRange.endX,
    });
  });

  if (allRanges.length === 0) {
    return null;
  }

  // 左右端点密度投票：每条线在端点附近按核函数投 N 票，最终在 X 轴找两个主峰。
  const starts = allRanges.map((r) => r.startX);
  const ends = allRanges.map((r) => r.endX);
  const voteTolerance = Math.max(6, Math.round(options?.voteTolerance ?? 18));

  const startVotes = new Array<number>(width).fill(0);
  const endVotes = new Array<number>(width).fill(0);
  // N=5 票核：每条线在端点附近投 5 个位置，中心权重更高。
  const voteKernel: Array<{ offset: number; weight: number }> = [
    { offset: -4, weight: 1 },
    { offset: -2, weight: 2 },
    { offset: 0, weight: 3 },
    { offset: 2, weight: 2 },
    { offset: 4, weight: 1 },
  ];

  const addVotes = (bucket: number[], x: number) => {
    for (const item of voteKernel) {
      const idx = clamp(Math.round(x + item.offset), 0, width - 1);
      bucket[idx] += item.weight;
    }
  };

  allRanges.forEach((r) => {
    addVotes(startVotes, r.startX);
    addVotes(endVotes, r.endX);
  });

  const smoothVotes = (input: number[], radius: number): number[] => {
    const output = new Array<number>(input.length).fill(0);
    for (let x = 0; x < input.length; x++) {
      let sum = 0;
      let count = 0;
      for (let k = -radius; k <= radius; k++) {
        const idx = x + k;
        if (idx < 0 || idx >= input.length) continue;
        sum += input[idx];
        count++;
      }
      output[x] = count > 0 ? sum / count : 0;
    }
    return output;
  };

  const startVotesSmooth = smoothVotes(startVotes, 3);
  const endVotesSmooth = smoothVotes(endVotes, 3);

  const argmax = (arr: number[]) => {
    let bestIdx = 0;
    let bestVal = -Infinity;
    for (let i = 0; i < arr.length; i++) {
      if (arr[i] > bestVal) {
        bestVal = arr[i];
        bestIdx = i;
      }
    }
    return bestIdx;
  };

  const robustStart = argmax(startVotesSmooth);
  const robustEnd = argmax(endVotesSmooth);
  const inlierStarts = starts.filter(
    (s) => Math.abs(s - robustStart) <= voteTolerance,
  );
  const inlierEnds = ends.filter(
    (e) => Math.abs(e - robustEnd) <= voteTolerance,
  );

  const voteDebug: PanelHorizontalVoteDebug = {
    candidateYs,
    voteTolerance,
    startMedian: robustStart,
    endMedian: robustEnd,
    robustStart,
    robustEnd,
    usedRobustResult: robustEnd - robustStart >= 120,
    points: allRanges.map((r) => ({
      lineIdx: r.lineIdx,
      scanY: r.scanY,
      rawStartX: r.rawStartX,
      rawEndX: r.rawEndX,
      startX: r.startX,
      endX: r.endX,
      startInlier: Math.abs(r.startX - robustStart) <= voteTolerance,
      endInlier: Math.abs(r.endX - robustEnd) <= voteTolerance,
    })),
  };

  if (robustEnd - robustStart >= 120) {
    const panelMidY = Math.round((panelTop + panelBottom) / 2);
    const nearestLine = [...allRanges].sort(
      (a, b) => Math.abs(a.scanY - panelMidY) - Math.abs(b.scanY - panelMidY),
    )[0];

    const iconsSource = nearestLine
      ? scanHorizontalLine(
          imageData,
          nearestLine.scanY,
          colorTolerance,
          sustainedPixels,
          width,
        )
      : null;

    return {
      startX: robustStart,
      endX: robustEnd,
      icons: iconsSource?.icons || [],
      voteDebug,
    };
  }

  const fallbackLine = [...allRanges].sort(
    (a, b) => b.endX - b.startX - (a.endX - a.startX),
  )[0];
  if (!fallbackLine) return null;

  const fallbackSource = scanHorizontalLine(
    imageData,
    fallbackLine.scanY,
    colorTolerance,
    sustainedPixels,
    width,
  );

  return {
    startX: fallbackLine.startX,
    endX: fallbackLine.endX,
    icons: fallbackSource?.icons || [],
    voteDebug,
  };
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
  secondaryScanLineX: number | null,
  scanStartY: number,
  colorTolerance: number,
  sustainedPixels: number,
  width: number,
  height: number,
): PanelVerticalRange[] {
  const offsets = [-24, -12, 0, 12, 24];
  const baseLines =
    secondaryScanLineX !== null ? [scanLineX, secondaryScanLineX] : [scanLineX];
  const scanLines = baseLines
    .flatMap((baseX) =>
      offsets.map((offset) => clamp(baseX + offset, 0, width - 1)),
    )
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

// ----- E. 小 panel 视觉兜底（连通域法） -----

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

// ----- F. 主处理流程编排（最终输出 blueBox / greenBox / redBoxes） -----

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

        const scanInset = 42;
        const secondaryScanLineX = clamp(
          Math.round(
            finalParams.scanLineX + finalParams.chainBoardWidth - scanInset * 2,
          ),
          0,
          img.width - 1,
        );
        const useSecondaryScanLine =
          Math.abs(secondaryScanLineX - finalParams.scanLineX) >= 24;

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
        const effectiveScanStartY = estimateLocalStableScanStartY(
          imageData,
          finalParams.scanLineX,
          finalParams.scanStartY,
          finalParams,
        );

        if (effectiveScanStartY !== finalParams.scanStartY) {
          console.log(
            `[WikiImageDetector] scanStartY 局部锁定搜索: ${finalParams.scanStartY} -> ${effectiveScanStartY}`,
          );
        }

        // 3. 执行 Y 轴扫描，找大框
        let panelVerticalRanges = detectVerticalRangesByVoting(
          imageData,
          finalParams.scanLineX,
          useSecondaryScanLine ? secondaryScanLineX : null,
          effectiveScanStartY,
          finalParams.colorTolerance,
          finalParams.sustainedPixels,
          canvas.width,
          canvas.height,
        );

        if (panelVerticalRanges.length === 0) {
          const fallbackStartY = Math.max(
            40,
            Math.min(Math.floor(canvas.height * 0.12), effectiveScanStartY),
          );

          if (fallbackStartY !== effectiveScanStartY) {
            console.log(
              `[WikiImageDetector] 首次Y轴扫描无结果，使用 fallbackStartY=${fallbackStartY} 重试`,
            );
            panelVerticalRanges = detectVerticalRangesByVoting(
              imageData,
              finalParams.scanLineX,
              useSecondaryScanLine ? secondaryScanLineX : null,
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

        const baseGridStartYGlobal = Math.max(
          1,
          Math.round(finalParams.gridStartY),
        );

        const initialHorizontalByIndex = new Map<
          number,
          PanelHorizontalRange | null
        >();

        panelVerticalRanges.forEach((vRange, idx) => {
          const probe = detectHorizontalRangeByVoting(
            imageData,
            vRange,
            baseGridStartYGlobal,
            finalParams.colorToleranceX,
            finalParams.sustainedPixelsX,
            canvas.width,
            canvas.height,
            {
              scanStep: finalParams.panelWidthScanStep,
              voteTolerance: finalParams.panelWidthVoteTolerance,
            },
          );
          initialHorizontalByIndex.set(idx, probe);
        });

        // 4. 遍历处理每个 Panel
        const detectedPanels: DetectedPanel[] = [];

        for (let i = 0; i < panelVerticalRanges.length; i++) {
          const vRange = panelVerticalRanges[i];
          // 🌟 获取当前面板的"上帝视角"信息
          const meta = metaPanels && metaPanels[i] ? metaPanels[i] : null;
          const baseGridStartY = baseGridStartYGlobal;

          // 执行 X 轴投票扫描（提高 panel 宽度稳定性）
          let hRange =
            initialHorizontalByIndex.get(i) ??
            detectHorizontalRangeByVoting(
              imageData,
              vRange,
              baseGridStartY,
              finalParams.colorToleranceX,
              finalParams.sustainedPixelsX,
              canvas.width,
              canvas.height,
              {
                scanStep: finalParams.panelWidthScanStep,
                voteTolerance: finalParams.panelWidthVoteTolerance,
              },
            );
          const initialVoteDebug = hRange?.voteDebug;

          const rawStartX = hRange?.startX ?? 0;
          const rawEndX = hRange?.endX ?? rawStartX;
          const rawWidth = Math.max(0, rawEndX - rawStartX);

          let startX = rawStartX;
          let width = rawWidth;

          const fallbackWidth = clamp(
            Math.round(finalParams.chainBoardWidth),
            120,
            canvas.width,
          );

          const applyWidthPolicy = (
            detectedStartX: number,
            detectedWidth: number,
            fallbackCenterX: number,
          ) => {
            const autoEnabled = finalParams.autoDetectPanelWidth !== false;

            if (!autoEnabled) {
              const centerX =
                detectedWidth > 0
                  ? detectedStartX + detectedWidth / 2
                  : fallbackCenterX;
              const safeWidth = Math.min(canvas.width, fallbackWidth);
              return {
                nextStartX: clamp(
                  Math.round(centerX - safeWidth / 2),
                  0,
                  Math.max(0, canvas.width - safeWidth),
                ),
                nextWidth: safeWidth,
              };
            }

            const safeDetectedWidth = Math.max(0, detectedWidth);
            if (safeDetectedWidth > 0) {
              const safeWidth = clamp(safeDetectedWidth, 120, canvas.width);
              return {
                nextStartX: clamp(
                  Math.round(detectedStartX),
                  0,
                  Math.max(0, canvas.width - safeWidth),
                ),
                nextWidth: safeWidth,
              };
            }

            const centerX =
              safeDetectedWidth > 0
                ? detectedStartX + safeDetectedWidth / 2
                : fallbackCenterX;
            const safeWidth = Math.min(canvas.width, fallbackWidth);
            return {
              nextStartX: clamp(
                Math.round(centerX - safeWidth / 2),
                0,
                Math.max(0, canvas.width - safeWidth),
              ),
              nextWidth: safeWidth,
            };
          };

          {
            const fallbackCenterX =
              rawWidth > 0 ? rawStartX + rawWidth / 2 : canvas.width / 2;
            const applied = applyWidthPolicy(
              rawStartX,
              rawWidth,
              fallbackCenterX,
            );
            startX = applied.nextStartX;
            width = applied.nextWidth;
          }

          const height = vRange.endY - vRange.startY;
          const panelGridStartY = estimatePanelGridStartY(
            imageData,
            startX,
            vRange.startY,
            width,
            height,
            finalParams,
          );

          // 使用自动标题高度再跑一次 X 轴投票，减少标题高度变化带来的宽度抖动。
          hRange = detectHorizontalRangeByVoting(
            imageData,
            vRange,
            panelGridStartY,
            finalParams.colorToleranceX,
            finalParams.sustainedPixelsX,
            canvas.width,
            canvas.height,
            {
              scanStep: finalParams.panelWidthScanStep,
              voteTolerance: finalParams.panelWidthVoteTolerance,
            },
          );
          const refinedVoteDebug = hRange?.voteDebug;

          const refinedStartX = hRange?.startX ?? startX;
          const refinedEndX = hRange?.endX ?? refinedStartX;
          const refinedWidth = Math.max(0, refinedEndX - refinedStartX);

          {
            const fallbackCenterX = startX + width / 2;
            const applied = applyWidthPolicy(
              refinedStartX,
              refinedWidth,
              fallbackCenterX,
            );
            startX = applied.nextStartX;
            width = applied.nextWidth;
          }

          const padding = 10;
          const scanX = startX + padding;
          const scanWidth = width - padding * 2;

          const scoreCandidate = (icons: IconBoundsPosition[]): number => {
            if (icons.length === 0) return -100000;

            let score = icons.length * 6;

            if (meta?.total && meta.total > 0) {
              score -= Math.abs(icons.length - meta.total) * 14;
            }

            const rowSet = new Set(
              icons
                .map((icon) => icon.row)
                .filter((v): v is number => typeof v === "number"),
            );
            if (meta?.rows && meta.rows > 0 && rowSet.size > 0) {
              score -= Math.abs(rowSet.size - meta.rows) * 18;
            }

            return score;
          };

          const runCandidate = (extraStartOffset: number) => {
            const scanY =
              vRange.startY +
              panelGridStartY +
              padding +
              Math.max(0, extraStartOffset);
            const scanHeight =
              height -
              panelGridStartY -
              padding * 2 -
              Math.max(0, extraStartOffset);

            if (scanWidth <= 16 || scanHeight <= 16) {
              return {
                bounds: { rows: [], cols: [] },
                icons: [] as IconBoundsPosition[],
                score: -100000,
                scanY,
                scanHeight,
              };
            }

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

            let icons = calculateIconPositionsFromBounds(bounds);

            if (finalParams.useVisionFallback !== false && icons.length === 0) {
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

              if (fallbackIcons.length > icons.length) {
                console.log(
                  `[WikiImageDetector] 视觉兜底生效: bounds=${icons.length}, vision=${fallbackIcons.length}`,
                );
                icons = fallbackIcons.map(
                  (icon): IconBoundsPosition => ({
                    ...icon,
                    rightX: icon.leftX + icon.width,
                    bottomY: icon.topY + icon.height,
                  }),
                );
              }
            }

            icons = dedupeIconBoxes(icons);
            icons = filterIconBoxesByMainRows(icons, meta?.total);
            icons = filterIconBoxesByMainSize(icons);
            icons = sortIconBoxesStable(icons);

            if (finalParams.filterEmptyIcons) {
              icons = icons.filter((icon) => {
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

            return {
              bounds,
              icons,
              score: scoreCandidate(icons),
              scanY,
              scanHeight,
            };
          };

          const primaryCandidate = runCandidate(0);
          const shouldRetryWithLowerStart =
            primaryCandidate.icons.length === 0 ||
            (meta?.total
              ? Math.abs(primaryCandidate.icons.length - meta.total) >
                Math.max(2, Math.ceil(meta.total * 0.35))
              : false);

          let chosenCandidate = primaryCandidate;
          if (shouldRetryWithLowerStart) {
            const lowerStartOffset = Math.max(
              14,
              Math.min(34, Math.round(panelGridStartY * 0.28)),
            );
            const secondaryCandidate = runCandidate(lowerStartOffset);
            if (secondaryCandidate.score > primaryCandidate.score) {
              console.log(
                `[WikiImageDetector] 小panel检测重试采用下移起点: panel=${i + 1}, offset=${lowerStartOffset}, score ${primaryCandidate.score} -> ${secondaryCandidate.score}`,
              );
              chosenCandidate = secondaryCandidate;
            }
          }

          console.log(
            `[WikiImageDetector] Panel ${i + 1} titleHeight=${panelGridStartY} (fallback=${baseGridStartY})`,
          );

          let boundsIcons = chosenCandidate.icons;
          const bounds = chosenCandidate.bounds;

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

            // 简化裁边逻辑：同一大panel内仅“最后一个”不裁，其他都裁右侧。
            const isLastIcon = iconIndex === boundsIcons.length - 1;
            if (!isLastIcon) {
              const trimRight = Math.max(
                6,
                Math.min(18, Math.round(drawWidth * 0.1)),
              );
              drawWidth = Math.max(8, drawWidth - trimRight);
            }

            // 再做偏移校准与正方形：以左上角为锚点，按短边统一为 1:1。
            if (finalParams.forceSquareIcons) {
              const squareSize = Math.max(8, Math.min(drawWidth, drawHeight));
              drawWidth = squareSize;
              drawHeight = squareSize;
              drawLeftX = drawLeftX + finalParams.forceSquareOffsetX;
              drawTopY = drawTopY + finalParams.forceSquareOffsetY;
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
              height: panelGridStartY,
            },
            redBoxes,
            horizontalVoteDebug: {
              initial: initialVoteDebug,
              refined: refinedVoteDebug,
            },
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
