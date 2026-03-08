/**
 * 面板检测工具函数（A 计划切图方案）
 * 用于在后端实现与调试台相同的检测逻辑
 */

import sharp from "sharp";

// 默认检测参数（与调试台一致）
export const DEFAULT_DETECTION_PARAMS = {
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
  colorToleranceX: 30,
  sustainedPixelsX: 5,
  iconLineOffset: 107,
  iconLineGap: 144,
  minIconsPerLine: 5,
  gapX: 10,
  gapY: 0,
  varianceThreshold: 50, // 空位探测器的方差阈值（与调试台一致）

  // 滑动窗口检测参数
  slidingWindowRows: 20, // 红色横向矩形窗口高度（N行）
  slidingWindowCols: 20, // 蓝色竖向矩形窗口宽度（M列）
  slidingWindowDiffThreshold: 30, // 滑动窗口颜色差异阈值
  slidingWindowStepSize: 5, // 滑动窗口步长（像素）
  slidingWindowMinGap: 50, // 最小行/列间距（像素）

  // 标题高度自动识别（弱对比分割线 + 图标纹理兜底）
  autoDetectTitleHeight: true,
  dividerEdgeTopOffset: 26,
  dividerEdgeBottomOffset: 220,
  dividerMinCoverageRatio: 0.58,
  dividerDarkDeltaMin: 2.4,
  dividerToIconTopGap: 16,
  iconTextureTopOffset: 68,
  iconTextureBottomOffset: 260,
  iconTextureRiseRatio: 1.45,
  iconTextureMinRise: 1.8,

  // 大 panel 宽度自动识别（多横线投票 + 回退）
  autoDetectPanelWidth: true,
  panelWidthScanInnerOffset: 36,
  panelWidthVoteTolerance: 24,
  panelWidthMinAcceptRatio: 0.89,
  panelWidthMaxAcceptRatio: 1.02,
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
  const idx = clamp(
    Math.floor((sorted.length - 1) * ratio),
    0,
    sorted.length - 1,
  );
  return sorted[idx];
}

function detectDividerYByEdgeCoverage(
  pixelData: Buffer,
  imageWidth: number,
  imageHeight: number,
  panelX: number,
  panelY: number,
  panelWidth: number,
  panelHeight: number,
  params: typeof DEFAULT_DETECTION_PARAMS,
): number | null {
  if (panelWidth < 120 || panelHeight < 120) return null;

  const xStart = clamp(
    Math.round(panelX + panelWidth * 0.1),
    0,
    imageWidth - 1,
  );
  const xEnd = clamp(
    Math.round(panelX + panelWidth * 0.9),
    xStart + 2,
    imageWidth - 1,
  );
  const searchTop = clamp(
    panelY + Math.round(params.dividerEdgeTopOffset),
    2,
    imageHeight - 3,
  );
  const searchBottom = clamp(
    panelY +
      Math.min(panelHeight - 20, Math.round(params.dividerEdgeBottomOffset)),
    searchTop + 2,
    imageHeight - 3,
  );

  let bestY = -1;
  let bestScore = -Infinity;

  for (let y = searchTop; y <= searchBottom; y++) {
    let hit = 0;
    let count = 0;
    let darkSum = 0;

    for (let x = xStart; x <= xEnd; x += 2) {
      const idx = (y * imageWidth + x) * 4;
      const upIdx = ((y - 1) * imageWidth + x) * 4;
      const downIdx = ((y + 1) * imageWidth + x) * 4;

      const cur = toLuma(
        pixelData[idx],
        pixelData[idx + 1],
        pixelData[idx + 2],
      );
      const up = toLuma(
        pixelData[upIdx],
        pixelData[upIdx + 1],
        pixelData[upIdx + 2],
      );
      const down = toLuma(
        pixelData[downIdx],
        pixelData[downIdx + 1],
        pixelData[downIdx + 2],
      );
      const around = (up + down) / 2;
      const darkDelta = around - cur;

      if (darkDelta > params.dividerDarkDeltaMin) hit++;
      darkSum += darkDelta;
      count++;
    }

    if (count === 0) continue;
    const coverage = hit / count;
    const avgDarkDelta = darkSum / count;
    if (coverage < params.dividerMinCoverageRatio) continue;

    const score = coverage * 10 + avgDarkDelta;
    if (score > bestScore) {
      bestScore = score;
      bestY = y;
    }
  }

  return bestY >= 0 ? bestY : null;
}

function detectIconTopYByTextureRise(
  pixelData: Buffer,
  imageWidth: number,
  imageHeight: number,
  panelX: number,
  panelY: number,
  panelWidth: number,
  panelHeight: number,
  params: typeof DEFAULT_DETECTION_PARAMS,
): number | null {
  if (panelWidth < 120 || panelHeight < 120) return null;

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
  const searchTop = clamp(
    panelY + Math.round(params.iconTextureTopOffset),
    1,
    imageHeight - 2,
  );
  const searchBottom = clamp(
    panelY +
      Math.min(panelHeight - 10, Math.round(params.iconTextureBottomOffset)),
    searchTop + 4,
    imageHeight - 2,
  );

  const texture: number[] = [];
  const ys: number[] = [];

  for (let y = searchTop; y <= searchBottom; y++) {
    let sum = 0;
    let count = 0;

    for (let x = xStart; x < xEnd; x += 2) {
      const idx1 = (y * imageWidth + x) * 4;
      const idx2 = (y * imageWidth + (x + 1)) * 4;
      const l1 = toLuma(
        pixelData[idx1],
        pixelData[idx1 + 1],
        pixelData[idx1 + 2],
      );
      const l2 = toLuma(
        pixelData[idx2],
        pixelData[idx2 + 1],
        pixelData[idx2 + 2],
      );
      sum += Math.abs(l2 - l1);
      count++;
    }

    if (count === 0) continue;
    ys.push(y);
    texture.push(sum / count);
  }

  if (texture.length < 12) return null;

  // 轻微平滑，避免单行噪声抖动
  const smooth: number[] = texture.map((_, i) => {
    const a = texture[Math.max(0, i - 1)];
    const b = texture[i];
    const c = texture[Math.min(texture.length - 1, i + 1)];
    return (a + b + c) / 3;
  });

  const baseline = percentile(smooth, 0.25);
  const threshold = Math.max(
    baseline + params.iconTextureMinRise,
    baseline * params.iconTextureRiseRatio,
  );

  for (let i = 2; i < smooth.length - 3; i++) {
    const rising =
      smooth[i] > threshold &&
      smooth[i + 1] > threshold &&
      smooth[i + 2] > threshold;
    const before = (smooth[i - 1] + smooth[i - 2]) / 2;
    if (rising && smooth[i] - before >= params.iconTextureMinRise) {
      return ys[i];
    }
  }

  return null;
}

function estimatePanelGridStartY(
  pixelData: Buffer,
  imageWidth: number,
  imageHeight: number,
  panelX: number,
  panelY: number,
  panelWidth: number,
  panelHeight: number,
  params: typeof DEFAULT_DETECTION_PARAMS,
): number {
  if (params.autoDetectTitleHeight === false) return params.gridStartY;

  const dividerY = detectDividerYByEdgeCoverage(
    pixelData,
    imageWidth,
    imageHeight,
    panelX,
    panelY,
    panelWidth,
    panelHeight,
    params,
  );

  const iconTopY = detectIconTopYByTextureRise(
    pixelData,
    imageWidth,
    imageHeight,
    panelX,
    panelY,
    panelWidth,
    panelHeight,
    params,
  );

  const dividerBased =
    dividerY !== null
      ? dividerY - panelY + Math.round(params.dividerToIconTopGap)
      : null;
  let candidate: number | null = null;

  if (dividerBased !== null && iconTopY !== null) {
    const iconBased = iconTopY - panelY;
    candidate =
      Math.abs(dividerBased - iconBased) <= 24
        ? Math.round(iconBased * 0.65 + dividerBased * 0.35)
        : iconBased;
  } else if (iconTopY !== null) {
    candidate = iconTopY - panelY;
  } else if (dividerBased !== null) {
    candidate = dividerBased;
  }

  if (candidate === null) return params.gridStartY;

  const minGridStartY = Math.max(50, Math.round(params.iconSize * 0.38));
  const maxGridStartY = Math.max(
    minGridStartY,
    panelHeight - Math.round(params.iconSize * 0.45),
  );
  return clamp(candidate, minGridStartY, maxGridStartY);
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
  varianceThreshold: number = 50, // 与调试台一致，默认 50
): boolean {
  // 只取中心 30% 到 70% 的核心区域
  const startX = Math.floor(x + width * 0.3);
  const startY = Math.floor(y + height * 0.3);
  const endX = Math.floor(x + width * 0.7);
  const endY = Math.floor(y + height * 0.7);

  // 边界保护
  if (startX < 0 || startY < 0 || endX >= imageWidth || endY >= imageHeight)
    return true;

  let rSum = 0,
    gSum = 0,
    bSum = 0;
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
    variance +=
      Math.pow(p.r - rAvg, 2) +
      Math.pow(p.g - gAvg, 2) +
      Math.pow(p.b - bAvg, 2);
  }
  variance = variance / count;

  return variance > varianceThreshold;
}

// 垂直像素扫描（Y轴检测）
export async function scanVerticalLine(
  image: sharp.Sharp,
  params: typeof DEFAULT_DETECTION_PARAMS,
): Promise<PanelVerticalRange[]> {
  const metadata = await image.metadata();
  const width = metadata.width!;
  const height = metadata.height!;

  const rawBuffer = await image.raw().toBuffer();
  const data = rawBuffer; // Buffer 本身就可以作为 Uint8Array 访问
  const panels: PanelVerticalRange[] = [];

  console.log(`[Y轴检测] 开始扫描，输入参数：`);
  console.log(
    `  scanLineX=${params.scanLineX}, scanStartY=${params.scanStartY}`,
  );
  console.log(
    `  colorTolerance=${params.colorTolerance}, sustainedPixels=${params.sustainedPixels}`,
  );
  console.log(`  image size: ${width}x${height}`);

  // 边界检查
  if (params.scanLineX < 0 || params.scanLineX >= width) {
    console.warn(
      `[Y轴检测] ❌ Scan line X (${params.scanLineX}) is out of image bounds (${width})`,
    );
    return panels;
  }

  if (params.scanStartY < 0 || params.scanStartY >= height) {
    console.warn(
      `[Y轴检测] ❌ Scan start Y (${params.scanStartY}) is out of image bounds (${height})`,
    );
    return panels;
  }

  console.log(`[Y轴检测] ✓ 边界检查通过`);

  // 获取像素颜色
  const getPixelColor = (x: number, y: number): [number, number, number] => {
    const index = (y * width + x) * 4;
    return [data[index], data[index + 1], data[index + 2]];
  };

  const backgroundColor = getPixelColor(params.scanLineX, params.scanStartY);
  console.log(`[Y轴检测] 背景色: (${backgroundColor.join(", ")})`);

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
        console.log(
          `[Y轴检测] Panel ${panels.length + 1} 上Y轴: ${currentStartY} (检测于 Y=${y})`,
        );
      }
    } else {
      // 离开panel区域（面板→背景）
      consecutiveBg++;
      consecutivePanel = 0;

      if (inPanel && consecutiveBg >= params.sustainedPixels) {
        inPanel = false;
        const endY = y - params.sustainedPixels + 1;
        console.log(
          `[Y轴检测] Panel ${panels.length + 1} 下Y轴: ${endY}, 高度: ${endY - currentStartY}`,
        );
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
  params: typeof DEFAULT_DETECTION_PARAMS,
): Promise<PanelHorizontalRange | null> {
  const metadata = await image.metadata();
  const width = metadata.width!;
  const height = metadata.height!;

  if (scanY < 0 || scanY >= height) {
    return null;
  }

  const rawBuffer = await image.raw().toBuffer();
  const data = rawBuffer;

  return scanHorizontalLineOnData(data, width, scanY, params);
}

/**
 * 单条横线检测（10px滑动窗口方差峰值算法）
 * 统一使用与前端链相同的检测逻辑
 */
function scanHorizontalLineOnData(
  data: Buffer,
  width: number,
  scanY: number,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _params: typeof DEFAULT_DETECTION_PARAMS,
): PanelHorizontalRange | null {
  const getPixelColor = (x: number, y: number): [number, number, number] => {
    const index = (y * width + x) * 4;
    return [data[index], data[index + 1], data[index + 2]];
  };

  // 使用 10x1 滑动窗口方差峰值来确定左右边界（与前端链一致）
  const varianceWindow = 10;
  const varianceStep = 1;
  const minSpan = 80;

  // 计算每个像素的亮度
  const luma = new Array<number>(width).fill(0);
  for (let x = 0; x < width; x++) {
    const [r, g, b] = getPixelColor(x, scanY);
    luma[x] = 0.299 * r + 0.587 * g + 0.114 * b;
  }

  if (width < varianceWindow + 2) {
    return null;
  }

  // 滑动窗口计算方差
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

  // 找方差峰值
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

  // 找最佳左右边界峰对
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

/**
 * 多横线投票检测大 panel 宽度（5点核投票 + 平滑 + argmax）
 * 统一使用与前端链相同的投票逻辑
 */
function detectHorizontalRangeByVoting(
  data: Buffer,
  imageWidth: number,
  imageHeight: number,
  panelRange: PanelVerticalRange,
  params: typeof DEFAULT_DETECTION_PARAMS,
): PanelHorizontalRange | null {
  const panelInnerMargin = 12;
  const maxScanLines = 80;

  const panelTop = clamp(panelRange.startY, 0, imageHeight - 1);
  const panelBottom = clamp(panelRange.endY, panelTop + 1, imageHeight - 1);
  const gridStartY = Math.max(1, Math.round(params.gridStartY));
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

  // 自适应步长：最多80条线
  const desiredStep = Math.max(
    3,
    Math.round(params.panelWidthScanInnerOffset / 4),
  );
  const bandHeight = Math.max(1, bandBottom - bandTop + 1);
  const adaptiveStep = Math.max(
    desiredStep,
    Math.ceil(bandHeight / maxScanLines),
  );

  // 生成候选扫描Y坐标
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

  // 收集每条横线的左右边界
  interface RangeRecord {
    startX: number;
    endX: number;
    lineIdx: number;
    scanY: number;
  }
  const allRanges: RangeRecord[] = [];

  candidateYs.forEach((scanY, lineIdx) => {
    const rawRange = scanHorizontalLineOnData(data, imageWidth, scanY, params);
    if (!rawRange) return;
    if (rawRange.endX - rawRange.startX < 60) return;

    allRanges.push({
      startX: rawRange.startX,
      endX: rawRange.endX,
      lineIdx,
      scanY,
    });
  });

  if (allRanges.length === 0) {
    return null;
  }

  // 5点核投票：每条线在端点附近投票，中心权重更高
  const starts = allRanges.map((r) => r.startX);
  const ends = allRanges.map((r) => r.endX);
  const voteTolerance = Math.max(6, Math.round(params.panelWidthVoteTolerance));

  const startVotes = new Array<number>(imageWidth).fill(0);
  const endVotes = new Array<number>(imageWidth).fill(0);

  // N=5 票核：offset: -4, -2, 0, +2, +4，权重: 1, 2, 3, 2, 1
  const voteKernel = [
    { offset: -4, weight: 1 },
    { offset: -2, weight: 2 },
    { offset: 0, weight: 3 },
    { offset: 2, weight: 2 },
    { offset: 4, weight: 1 },
  ];

  const addVotes = (bucket: number[], x: number) => {
    for (const item of voteKernel) {
      const idx = clamp(Math.round(x + item.offset), 0, imageWidth - 1);
      bucket[idx] += item.weight;
    }
  };

  allRanges.forEach((r) => {
    addVotes(startVotes, r.startX);
    addVotes(endVotes, r.endX);
  });

  // 平滑投票结果
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

  // argmax 找投票峰值
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

  console.log(
    `[宽度投票] robustStart=${robustStart}, robustEnd=${robustEnd}, 投票宽度=${robustEnd - robustStart}`,
  );
  console.log(
    `[宽度投票] 扫描线数=${allRanges.length}, 各线宽度=${allRanges.map((r) => r.endX - r.startX).join(",")}`,
  );

  // 如果投票结果有效（宽度>=120），使用投票结果
  if (robustEnd - robustStart >= 120) {
    const panelMidY = Math.round((panelTop + panelBottom) / 2);
    const nearestLine = [...allRanges].sort(
      (a, b) => Math.abs(a.scanY - panelMidY) - Math.abs(b.scanY - panelMidY),
    )[0];

    const iconsSource = nearestLine
      ? scanHorizontalLineOnData(data, imageWidth, nearestLine.scanY, params)
      : null;

    return {
      startX: robustStart,
      endX: robustEnd,
      icons: iconsSource?.icons || [],
    };
  }

  // 回退：使用最大跨度的那条线
  const fallbackLine = [...allRanges].sort(
    (a, b) => b.endX - b.startX - (a.endX - a.startX),
  )[0];
  if (!fallbackLine) return null;

  const fallbackSource = scanHorizontalLineOnData(
    data,
    imageWidth,
    fallbackLine.scanY,
    params,
  );

  return {
    startX: fallbackLine.startX,
    endX: fallbackLine.endX,
    icons: fallbackSource?.icons || [],
  };
}

// 计算图标位置（使用中心点间距 + 空位探测器）- 与调试台一致
export function calculateIconPositions(
  panel: any,
  panelY: number,
  params: typeof DEFAULT_DETECTION_PARAMS,
  pixelData: Buffer,
  imageWidth: number,
  imageHeight: number,
): IconPosition[] {
  const {
    gridStartX,
    gridStartY,
    iconSize,
    centerGapX,
    centerGapY,
    iconCenterOffsetX,
    iconCenterOffsetY,
    varianceThreshold,
  } = params;

  // 终极解法：我们不再死板相信 LLM 的 rows！
  // 给他一个允许的最大行数（比如 10 行），让我们的"空位探测器"自动去喊停！
  const rows = panel.rows || 10;
  const cols = panel.cols || 5;
  const maxCount = panel.total || rows * cols;

  // 计算面板的左上角坐标（直接使用扫描线检测的坐标）
  const panelX = panel.x;

  // 首个中心点坐标（与调试台一致）
  const firstCenterX = panelX + gridStartX + iconCenterOffsetX;
  const firstCenterY = panelY + gridStartY + iconCenterOffsetY;

  const coreSize = 30; // 核心区域大小（正方形）

  const positions = [];
  let count = 0;

  console.log(`[图标定位] 开始计算图标位置（带空位探测器）`);
  console.log(`  panel.x=${panel.x}, panel.y=${panel.y}`);
  console.log(`  panelX=${panelX}, panelY=${panelY}`);
  console.log(`  firstCenterX=${firstCenterX}, firstCenterY=${firstCenterY}`);
  console.log(`  rows=${rows}, cols=${cols}, maxCount=${maxCount}`);
  console.log(`  centerGapX=${centerGapX}, centerGapY=${centerGapY}`);
  console.log(`  varianceThreshold=${varianceThreshold}`);
  console.log(`  coreSize=${coreSize}`);

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      if (count >= maxCount) break;

      // 计算中心点坐标（与调试台一致）
      const centerX = Math.round(firstCenterX + col * centerGapX);
      const centerY = Math.round(firstCenterY + row * centerGapY);

      // 从中心点计算左上角坐标（用于红框绘制）
      const rectX = centerX - Math.round(iconSize / 2);
      const rectY = centerY - Math.round(iconSize / 2);

      // 计算中心区域的坐标（与调试台一致）
      const coreX = centerX - Math.floor(coreSize / 2);
      const coreY = centerY - Math.floor(coreSize / 2);

      console.log(`  [${row}, ${col}] 坐标计算:`);
      console.log(`    中心点: (${centerX}, ${centerY})`);
      console.log(`    左上角: (${rectX}, ${rectY})`);
      console.log(
        `    核心区域: (${coreX}, ${coreY}, ${coreSize}×${coreSize})`,
      );

      // 呼叫后端空位探测器！
      const hasIcon = checkIconExists(
        pixelData,
        imageWidth,
        imageHeight,
        coreX,
        coreY,
        coreSize,
        coreSize,
        varianceThreshold || 300,
      );

      console.log(`    空位检测结果: ${hasIcon ? "✓ 有图标" : "✗ 空底座"}`);

      if (!hasIcon) {
        console.log(
          `[A计划后端] 探测到位置 [${row}, ${col}] 为空底座，终止当前面板识别！`,
        );
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

// 完整的面板检测流程
export async function detectPanels(
  imageBuffer: Buffer,
  debugPanels: any[],
  customParams?: any,
): Promise<DetectedPanel[]> {
  // 合并前端传来的完美参数和默认参数
  const params = { ...DEFAULT_DETECTION_PARAMS, ...(customParams || {}) };

  console.log("\n========== 开始 A 计划面板检测 ==========");

  // 重点：让 sharp 吐出带有 RGBA 像素数据的 raw buffer，给后续的方差检测用
  const image = sharp(imageBuffer).ensureAlpha();
  const { data: pixelData, info } = await image
    .raw()
    .toBuffer({ resolveWithObject: true });
  const imageWidth = info.width;
  const imageHeight = info.height;

  console.log(`图片尺寸: ${imageWidth}x${imageHeight}`);
  console.log(
    `参数: scanLineX=${params.scanLineX}, scanStartY=${params.scanStartY}`,
  );

  // 1. Y轴检测
  const panelVerticalRanges = await scanVerticalLine(image, params);

  if (panelVerticalRanges.length === 0) {
    throw new Error("Y轴检测失败：未检测到任何面板");
  }

  console.log(`Y轴检测完成，检测到 ${panelVerticalRanges.length} 个panel`);

  // 2. X轴检测
  const panelRanges: any[] = [];
  for (let i = 0; i < panelVerticalRanges.length; i++) {
    const vRange = panelVerticalRanges[i];
    // 使用安全访问，如果面板不存在则使用默认值
    const panel = debugPanels[i];
    if (!panel) {
      console.warn(
        `[Panel ${i + 1}] 警告：LLM 未返回此面板的元数据，使用默认值`,
      );
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

    console.log(`\n[Panel ${i + 1}] ${safePanel.title}`);
    // 多横线投票识别宽度，减少单条扫描线受干扰导致的抖动
    const hRange = detectHorizontalRangeByVoting(
      pixelData,
      imageWidth,
      imageHeight,
      vRange,
      params,
    );

    const detectedStartX = hRange?.startX ?? 0;
    const detectedEndX = hRange?.endX ?? 0;
    const detectedWidth = Math.max(0, detectedEndX - detectedStartX);

    const fallbackWidth = clamp(
      Math.round(params.chainBoardWidth),
      120,
      imageWidth,
    );

    let finalStartX = detectedStartX;
    let finalWidth = detectedWidth;

    if (params.autoDetectPanelWidth !== false) {
      // 不再按 min/max ratio 限宽；仅在检测失败（<=0）时回退基准宽度。
      console.log(
        `[宽度策略][Panel ${i + 1}] detectedWidth=${detectedWidth}, autoDetect=true, 不启用比例限宽`,
      );

      if (detectedWidth <= 0) {
        const centerX =
          safePanel.width > 0
            ? safePanel.x + safePanel.width / 2
            : imageWidth / 2;
        finalWidth = fallbackWidth;
        finalStartX = clamp(
          Math.round(centerX - finalWidth / 2),
          0,
          Math.max(0, imageWidth - finalWidth),
        );
        console.log(
          `[X轴检测][Panel ${i + 1}] 未检测到有效宽度，回退 chainBoardWidth=${fallbackWidth}`,
        );
      }
    } else if (detectedWidth <= 0) {
      finalWidth = fallbackWidth;
      finalStartX = clamp(
        Math.round(imageWidth / 2 - finalWidth / 2),
        0,
        Math.max(0, imageWidth - finalWidth),
      );
    }

    panelRanges.push({
      startY: vRange.startY,
      endY: vRange.endY,
      startX: finalStartX,
      endX: finalStartX + finalWidth,
      width: finalWidth,
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
      console.warn(
        `[Panel ${i + 1}] 警告：LLM 未返回此面板的元数据，使用默认值`,
      );
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
    const panelGridStartY = estimatePanelGridStartY(
      pixelData,
      imageWidth,
      imageHeight,
      range.startX,
      range.startY,
      range.width,
      range.height,
      params,
    );
    const perPanelParams = { ...params, gridStartY: panelGridStartY };

    console.log(`\n[Panel ${i + 1}] ${safePanel.title}`);
    console.log(
      `  BlueBox: x=${range.startX}, y=${range.startY}, width=${range.width}, height=${range.height}`,
    );
    console.log(
      `  GridStartY(auto): ${panelGridStartY} (fallback=${params.gridStartY})`,
    );

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
      height: panelGridStartY,
    };

    // 红框坐标
    const redBoxes = calculateIconPositions(
      safePanel,
      range.startY,
      perPanelParams,
      pixelData,
      imageWidth,
      imageHeight,
    );

    console.log(
      `  GreenBox: x=${greenBox.x}, y=${greenBox.y}, width=${greenBox.width}, height=${greenBox.height}`,
    );
    console.log(`  RedBox Count: ${redBoxes.length}`);

    detectedPanels.push({
      title: safePanel.title,
      blueBox,
      greenBox,
      redBoxes,
    });
  }

  console.log(
    `\n========== A 计划面板检测完成，共 ${detectedPanels.length} 个面板 ==========`,
  );

  return detectedPanels;
}
