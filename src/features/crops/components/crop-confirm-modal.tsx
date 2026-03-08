"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { detectWikiImage } from "@/lib/wiki-image-detector";
import {
  isPlaceholderPanelTitle,
  normalizePanelTitleCandidate,
} from "@/lib/panel-title";
import {
  fetchProjectDebugParams,
  saveProjectDebugParams,
} from "@/features/crops/services/debug-params-client";
import { requestOcrPanelTitles } from "@/features/crops/services/ocr-panel-titles-client";
import {
  CropConfirmModalProps,
  DebugPanelParams,
  DetectedPanel,
} from "@/features/crops/types";

// 默认参数
const DEFAULT_PARAMS: DebugPanelParams = {
  chainBoardWidth: 786,
  autoDetectPanelWidth: true,
  panelWidthVoteTolerance: 24,
  gridStartY: 107,
  scanLineX: 49,
  scanStartY: 200,
  scanStableVarianceThresholdFactor: 1,
  colorTolerance: 30,
  sustainedPixels: 5,
  colorToleranceX: 30,
  sustainedPixelsX: 5,
  boundsWindowHeight: 5,
  boundsWindowWidth: 5,
  boundsVarianceThresholdRow: 30,
  boundsVarianceThresholdCol: 30,
  boundsStepSize: 1,
  boundsMinRowHeight: 20,
  boundsMinColWidth: 20,
  forceSquareIcons: true,
  forceSquareOffsetX: 0,
  forceSquareOffsetY: 2,
  filterEmptyIcons: true,
  emptyIconVarianceThreshold: 20,
  useVisionFallback: true,
};

const isFallbackPanelTitle = (title?: string) => isPlaceholderPanelTitle(title);

const normalizeWidthAutoParams = (
  input: DebugPanelParams,
): DebugPanelParams => ({
  ...input,
  autoDetectPanelWidth: true,
});

function pickMajorityPanelWidth(
  panels: DetectedPanel[],
  tolerance: number = 10,
): number | null {
  const widths = panels
    .map((panel) =>
      Math.round(Number(panel?.blueBox?.width ?? panel?.width ?? 0)),
    )
    .filter((w) => Number.isFinite(w) && w >= 120);

  if (widths.length === 0) return null;

  let bestCluster: number[] = [];
  for (const pivot of widths) {
    const cluster = widths.filter((w) => Math.abs(w - pivot) <= tolerance);
    if (cluster.length > bestCluster.length) {
      bestCluster = cluster;
    }
  }

  if (bestCluster.length / widths.length <= 0.5) {
    return null;
  }

  const sorted = [...bestCluster].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0
      ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
      : sorted[mid];

  return Math.max(120, Math.min(1000, median));
}

function forceCenterPanelsHorizontally(
  panels: DetectedPanel[],
  imageWidth: number,
): DetectedPanel[] {
  return panels.map((panel) => {
    const panelWidth = Math.round(
      Number(panel?.blueBox?.width ?? panel?.width ?? 0),
    );
    if (!Number.isFinite(panelWidth) || panelWidth <= 0) {
      return panel;
    }

    const currentX = Math.round(Number(panel?.blueBox?.x ?? panel?.x ?? 0));
    const targetX = Math.max(
      0,
      Math.min(
        Math.max(0, imageWidth - panelWidth),
        Math.round((imageWidth - panelWidth) / 2),
      ),
    );
    const shiftX = targetX - currentX;

    if (shiftX === 0) {
      return panel;
    }

    return {
      ...panel,
      x: panel.x + shiftX,
      blueBox: {
        ...panel.blueBox,
        x: panel.blueBox.x + shiftX,
      },
      greenBox: {
        ...panel.greenBox,
        x: panel.greenBox.x + shiftX,
      },
      redBoxes: panel.redBoxes.map((box) => ({
        ...box,
        x: box.x + shiftX,
      })),
    };
  });
}

export default function CropConfirmModal({
  imageUrl,
  isOpen,
  onClose,
  onExport,
  autoCloseOnExport = true,
  disableClose = false,
  batchCurrent,
  batchTotal,
  batchCompletedImages = 0,
  batchCompletedChains = 0,
  batchCompletedIcons = 0,
  batchProcessingLabel,
}: CropConfirmModalProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const detectRunIdRef = useRef(0);
  const slowDetectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadedImageRef = useRef<HTMLImageElement | null>(null);
  const isDetectingRef = useRef(false);
  const hasPendingDetectRef = useRef(false);
  const ocrInFlightRef = useRef(false);
  const [params, setParams] = useState<DebugPanelParams>(DEFAULT_PARAMS);
  const latestParamsRef = useRef<DebugPanelParams>(DEFAULT_PARAMS);
  const [detectedPanels, setDetectedPanels] = useState<DetectedPanel[]>([]);
  const [selectedPanelIndex, setSelectedPanelIndex] = useState<number>(-1);
  const [showChainDetection, setShowChainDetection] = useState(true);
  const [showDebugParams, setShowDebugParams] = useState(true);
  const [showComputingHint, setShowComputingHint] = useState(false);
  const [isDetectingPreview, setIsDetectingPreview] = useState(false);
  const [isAutoDetectingWidth, setIsAutoDetectingWidth] = useState(false);
  const [iconDetectTab, setIconDetectTab] = useState<
    "bounds" | "square" | "empty"
  >("bounds");
  const hasHydratedParamsRef = useRef(false);
  const saveParamsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingPersistParamsRef = useRef<DebugPanelParams | null>(null);
  const autoWidthAppliedKeyRef = useRef<string>("");
  const autoScanLineAdjustStateRef = useRef<{
    imageUrl: string;
    count: number;
  }>({
    imageUrl: "",
    count: 0,
  });
  const autoScanStartYAdjustStateRef = useRef<{
    imageUrl: string;
    count: number;
  }>({
    imageUrl: "",
    count: 0,
  });

  const persistParams = useCallback(async (nextParams: DebugPanelParams) => {
    try {
      localStorage.setItem("wiki_slice_config", JSON.stringify(nextParams));
    } catch {
      console.warn("无法保存参数到 LocalStorage");
    }

    const ok = await saveProjectDebugParams(nextParams);
    if (!ok) {
      console.warn("[DebugParams] 保存项目参数失败");
    }
  }, []);

  const flushPendingParamsPersist = useCallback(() => {
    const pending = pendingPersistParamsRef.current;
    if (!pending) return;
    pendingPersistParamsRef.current = null;
    void persistParams(pending);
  }, [persistParams]);

  const getPanelDisplayTitle = useCallback(
    (panel: DetectedPanel, index: number) => {
      if (panel.ocrTitle && panel.ocrTitle.trim()) {
        return panel.ocrTitle.trim();
      }
      if (!isFallbackPanelTitle(panel.title)) {
        return panel.title;
      }
      return `合成链_${index + 1}`;
    },
    [],
  );

  const recognizePanelTitles = useCallback(
    async (panels: DetectedPanel[]) => {
      if (panels.length === 0) return;
      const needsOcr = panels.some(
        (panel) => !panel.ocrTitle || !panel.ocrTitle.trim(),
      );
      if (!needsOcr || ocrInFlightRef.current) {
        return;
      }

      const BATCH_SIZE = 2;
      const MAX_PASSES = 2;
      const REQUEST_TIMEOUT_MS = 45000;

      const applyOcrTitles = (titlesMap: Map<number, string>) => {
        if (titlesMap.size === 0) return;
        setDetectedPanels((prev) => {
          if (prev.length === 0) return prev;
          return prev.map((panel, index) => {
            const value = titlesMap.get(index);
            if (!value) return panel;
            return {
              ...panel,
              ocrTitle: value,
            };
          });
        });
      };

      try {
        ocrInFlightRef.current = true;
        const recognized = new Map<number, string>();
        let pendingIndices = panels
          .map((panel, index) => ({ panel, index }))
          .filter(({ panel }) => !panel.ocrTitle || !panel.ocrTitle.trim())
          .map(({ index }) => index);

        for (
          let pass = 1;
          pass <= MAX_PASSES && pendingIndices.length > 0;
          pass++
        ) {
          const nextPending: number[] = [];

          for (let i = 0; i < pendingIndices.length; i += BATCH_SIZE) {
            const batchIndices = pendingIndices.slice(i, i + BATCH_SIZE);
            const batchPanels = batchIndices.map((index) => ({
              index,
              title: panels[index]?.title,
              greenBox: panels[index]?.greenBox,
              blueBox: panels[index]?.blueBox,
            }));

            const controller = new AbortController();
            const timeoutId = setTimeout(
              () => controller.abort(),
              REQUEST_TIMEOUT_MS,
            );

            try {
              const payload = await requestOcrPanelTitles(
                imageUrl,
                batchPanels,
                controller.signal,
              );

              if (!payload) {
                batchIndices.forEach((idx) => nextPending.push(idx));
                continue;
              }

              if (!payload.success || !Array.isArray(payload.titles)) {
                batchIndices.forEach((idx) => nextPending.push(idx));
                continue;
              }

              payload.titles.forEach((value, localIndex) => {
                const panelIndex = batchIndices[localIndex];
                const ocrTitle = normalizePanelTitleCandidate(value || "");

                console.log(
                  `[OCR][DebugModal][pass=${pass}] panel#${panelIndex + 1} raw=${JSON.stringify(value || "")} normalized=${JSON.stringify(ocrTitle)}`,
                );

                if (!ocrTitle) {
                  nextPending.push(panelIndex);
                  return;
                }

                recognized.set(panelIndex, ocrTitle);
              });

              applyOcrTitles(recognized);
            } catch {
              batchIndices.forEach((idx) => nextPending.push(idx));
            } finally {
              clearTimeout(timeoutId);
            }
          }

          pendingIndices = [...new Set(nextPending)].filter(
            (idx) => !recognized.has(idx),
          );
        }

        if (pendingIndices.length > 0) {
          console.warn(
            `[OCR][DebugModal] unresolved panels after retries: ${pendingIndices.map((x) => x + 1).join(", ")}`,
          );
        }
      } catch {
        // OCR 失败时保留现有标题，不影响切图主流程
      } finally {
        ocrInFlightRef.current = false;
      }
    },
    [imageUrl],
  );

  // 初始化参数
  useEffect(() => {
    let isDisposed = false;
    const STORAGE_KEY = "wiki_slice_config";

    const loadParams = async () => {
      let localParams: Partial<DebugPanelParams> = {};
      try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
          localParams = JSON.parse(saved) as Partial<DebugPanelParams>;
        }
      } catch {
        console.warn("无法读取本地调试参数，继续读取项目参数");
      }

      try {
        const projectParams = await fetchProjectDebugParams();

        if (projectParams && !isDisposed) {
          const merged = {
            ...DEFAULT_PARAMS,
            ...projectParams,
            ...localParams,
          } as DebugPanelParams;
          const normalized = normalizeWidthAutoParams(merged);
          setParams(normalized);
          latestParamsRef.current = normalized;
          hasHydratedParamsRef.current = true;

          try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
          } catch {
            console.warn("无法回写参数到本地缓存");
          }
          return;
        }
      } catch {
        console.warn("无法读取项目调试参数，回退到本地参数");
      }

      if (!isDisposed) {
        const fallback = {
          ...DEFAULT_PARAMS,
          ...localParams,
        } as DebugPanelParams;
        const normalized = normalizeWidthAutoParams(fallback);
        setParams(normalized);
        latestParamsRef.current = normalized;
        hasHydratedParamsRef.current = true;
      }
    };

    void loadParams();

    return () => {
      isDisposed = true;
    };
  }, []);

  useEffect(() => {
    if (!hasHydratedParamsRef.current) return;

    if (saveParamsTimerRef.current) {
      clearTimeout(saveParamsTimerRef.current);
    }

    pendingPersistParamsRef.current = params;

    saveParamsTimerRef.current = setTimeout(() => {
      flushPendingParamsPersist();
    }, 120);

    return () => {
      if (saveParamsTimerRef.current) {
        clearTimeout(saveParamsTimerRef.current);
        saveParamsTimerRef.current = null;
      }
    };
  }, [params, flushPendingParamsPersist]);

  useEffect(() => {
    if (!isOpen) {
      flushPendingParamsPersist();
    }
  }, [isOpen, flushPendingParamsPersist]);

  // 绘制 Canvas
  const drawCanvas = useCallback(
    async (img: HTMLImageElement, paramsSnapshot: DebugPanelParams) => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const runId = ++detectRunIdRef.current;

      if (slowDetectTimerRef.current) {
        clearTimeout(slowDetectTimerRef.current);
      }
      setIsDetectingPreview(true);
      setShowComputingHint(false);
      slowDetectTimerRef.current = setTimeout(() => {
        if (runId === detectRunIdRef.current) {
          setShowComputingHint(true);
        }
      }, 220);

      // 设置画布尺寸
      canvas.width = img.width;
      canvas.height = img.height;

      // 绘制图片
      ctx.drawImage(img, 0, 0);
      const sourceImageData = ctx.getImageData(
        0,
        0,
        canvas.width,
        canvas.height,
      );

      const drawScanGuides = (panelsForGuide: DetectedPanel[] = []) => {
        const percentile = (values: number[], ratio: number) => {
          if (values.length === 0) return 0;
          const sorted = [...values].sort((a, b) => a - b);
          const idx = Math.max(
            0,
            Math.min(
              sorted.length - 1,
              Math.floor((sorted.length - 1) * ratio),
            ),
          );
          return sorted[idx];
        };

        const estimateStableScanSegment = (
          imageData: ImageData,
          scanX: number,
          requestedY: number,
          refineRange: number,
          sampleRadius: number,
        ): { startY: number; endY: number; midY: number } | null => {
          void scanX;
          const { data, width, height } = imageData;
          if (height < 6 || width < 6) return null;

          const fallbackY = Math.max(0, Math.min(height - 1, requestedY));
          const searchTop = Math.max(0, fallbackY - refineRange);
          const searchBottom = Math.min(height - 1, fallbackY + refineRange);
          const minStableHeight = 4;
          if (searchTop > searchBottom) return null;

          const xStart = 0;
          const xEnd = width - 1;
          const xStep = Math.max(1, sampleRadius);
          const toLuma = (r: number, g: number, b: number) =>
            0.299 * r + 0.587 * g + 0.114 * b;

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
            if (count > 0) {
              const mean = lumaSum / count;
              const variance = Math.max(0, lumaSquareSum / count - mean * mean);
              samples.push({ y, score: variance });
            }
          }

          if (samples.length === 0) return null;

          const sortedScores = samples
            .map((s) => s.score)
            .sort((a, b) => a - b);
          const best = sortedScores[0];
          const p35 = percentile(sortedScores, 0.35);
          const thresholdFactor = Math.max(
            0.2,
            Math.min(
              3,
              Number(
                (
                  paramsSnapshot as DebugPanelParams & {
                    scanStableVarianceThresholdFactor?: number;
                  }
                ).scanStableVarianceThresholdFactor ?? 1,
              ),
            ),
          );
          const stableThreshold =
            best + Math.max(0.6, (p35 - best) * 1.15) * thresholdFactor;

          const segments: Array<{
            startY: number;
            endY: number;
            avgScore: number;
            len: number;
          }> = [];
          let segStart = -1;
          let segEnd = -1;
          let segScoreSum = 0;
          let segCount = 0;

          const flush = () => {
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
              flush();
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
          flush();

          if (segments.length === 0) {
            const bestSingle = samples.reduce((acc, cur) =>
              cur.score < acc.score ? cur : acc,
            );
            const startY = Math.max(
              searchTop,
              Math.min(
                searchBottom - minStableHeight + 1,
                bestSingle.y - Math.floor(minStableHeight / 2),
              ),
            );
            const endY = Math.min(searchBottom, startY + minStableHeight - 1);
            return { startY, endY, midY: Math.round((startY + endY) / 2) };
          }

          const chosen = segments.sort((a, b) => {
            if (a.avgScore !== b.avgScore) return a.avgScore - b.avgScore;
            if (a.len !== b.len) return b.len - a.len;
            const aMid = (a.startY + a.endY) / 2;
            const bMid = (b.startY + b.endY) / 2;
            return Math.abs(aMid - fallbackY) - Math.abs(bMid - fallbackY);
          })[0];

          const startY =
            chosen.len >= minStableHeight
              ? chosen.startY
              : Math.max(
                  searchTop,
                  Math.min(
                    searchBottom - minStableHeight + 1,
                    Math.round((chosen.startY + chosen.endY) / 2) -
                      Math.floor(minStableHeight / 2),
                  ),
                );
          const endY =
            chosen.len >= minStableHeight
              ? chosen.endY
              : Math.min(searchBottom, startY + minStableHeight - 1);

          return {
            startY,
            endY,
            midY: Math.round((startY + endY) / 2),
          };
        };

        const scanInset = 42;
        const refPanel =
          panelsForGuide.length > 0
            ? panelsForGuide[
                selectedPanelIndex >= 0 &&
                selectedPanelIndex < panelsForGuide.length
                  ? selectedPanelIndex
                  : 0
              ]
            : null;
        const primaryRawX = refPanel
          ? Math.round(refPanel.blueBox.x + scanInset)
          : Math.max(0, Math.min(canvas.width - 1, paramsSnapshot.scanLineX));
        const scanX = Math.max(0, Math.min(canvas.width - 1, primaryRawX));
        const secondaryRawX = refPanel
          ? Math.round(refPanel.blueBox.x + refPanel.blueBox.width - scanInset)
          : Math.round(scanX + paramsSnapshot.chainBoardWidth - scanInset * 2);
        const secondaryScanX = Math.max(
          0,
          Math.min(canvas.width - 1, secondaryRawX),
        );
        const scanY = Math.max(
          0,
          Math.min(canvas.height - 1, paramsSnapshot.scanStartY),
        );
        const localScanRefineRange = Math.max(
          1,
          Math.round(
            (
              paramsSnapshot as DebugPanelParams & {
                localScanStartRefineRange?: number;
              }
            ).localScanStartRefineRange ?? 60,
          ),
        );
        const localScanSampleRadius = Math.max(
          1,
          Math.round(
            (
              paramsSnapshot as DebugPanelParams & {
                localScanStartSampleRadius?: number;
              }
            ).localScanStartSampleRadius ?? 3,
          ),
        );
        const scanSearchTop = Math.max(0, scanY - localScanRefineRange);
        const scanSearchBottom = Math.min(
          canvas.height - 1,
          scanY + localScanRefineRange,
        );
        const stableSegment = estimateStableScanSegment(
          sourceImageData,
          scanX,
          scanY,
          localScanRefineRange,
          localScanSampleRadius,
        );
        const effectiveScanY = stableSegment?.midY ?? scanY;

        // 扫描起始Y局部锁定搜索范围（20%透明）
        ctx.save();
        ctx.fillStyle = "rgba(6, 182, 212, 0.2)";
        ctx.fillRect(
          0,
          scanSearchTop,
          canvas.width,
          Math.max(1, scanSearchBottom - scanSearchTop + 1),
        );
        ctx.setLineDash([4, 3]);
        ctx.strokeStyle = "rgba(6, 182, 212, 0.8)";
        ctx.lineWidth = 1;
        ctx.strokeRect(
          0.5,
          scanSearchTop + 0.5,
          Math.max(1, canvas.width - 1),
          Math.max(1, scanSearchBottom - scanSearchTop),
        );
        ctx.restore();

        // 在搜索范围内叠加“最稳定连续段”（60%透明）
        if (stableSegment) {
          const stableTop = Math.max(scanSearchTop, stableSegment.startY);
          const stableBottom = Math.min(scanSearchBottom, stableSegment.endY);
          ctx.save();
          ctx.fillStyle = "rgba(8, 145, 178, 0.6)";
          ctx.fillRect(
            0,
            stableTop,
            canvas.width,
            Math.max(1, stableBottom - stableTop + 1),
          );
          ctx.setLineDash([5, 3]);
          ctx.strokeStyle = "rgba(14, 116, 144, 0.95)";
          ctx.lineWidth = 1.5;
          ctx.strokeRect(
            0.5,
            stableTop + 0.5,
            Math.max(1, canvas.width - 1),
            Math.max(1, stableBottom - stableTop),
          );
          ctx.restore();
        }

        // 竖向扫描线（X轴）
        ctx.save();
        ctx.setLineDash([6, 4]);
        ctx.strokeStyle = "#F97316";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(scanX, 0);
        ctx.lineTo(scanX, canvas.height);
        ctx.stroke();

        // 右侧对照扫描线（与左侧同距内缩）
        ctx.strokeStyle = "#A855F7";
        ctx.beginPath();
        ctx.moveTo(secondaryScanX, 0);
        ctx.lineTo(secondaryScanX, canvas.height);
        ctx.stroke();

        // 横向扫描起点线（Y轴）
        ctx.strokeStyle = "#06B6D4";
        ctx.beginPath();
        ctx.moveTo(0, effectiveScanY);
        ctx.lineTo(canvas.width, effectiveScanY);
        ctx.stroke();
        ctx.restore();

        // 扫描线标签
        ctx.fillStyle = "#F97316";
        ctx.font = "12px monospace";
        ctx.fillText(
          `scanX=${scanX}`,
          Math.min(scanX + 6, canvas.width - 110),
          16,
        );
        ctx.fillStyle = "#A855F7";
        ctx.fillText(
          `scanX2=${secondaryScanX}`,
          Math.max(8, Math.min(secondaryScanX + 6, canvas.width - 130)),
          32,
        );

        ctx.fillStyle = "#06B6D4";
        const scanYLabel =
          effectiveScanY !== scanY
            ? `scanStartY=${scanY} -> ${effectiveScanY}`
            : `scanStartY=${scanY}`;
        ctx.fillText(scanYLabel, 8, Math.max(14, effectiveScanY - 6));
        ctx.fillText(
          `searchY=[${scanSearchTop},${scanSearchBottom}]`,
          8,
          Math.min(canvas.height - 8, scanSearchBottom + 14),
        );
        if (stableSegment) {
          ctx.fillText(
            `stableY=[${stableSegment.startY},${stableSegment.endY}], mid=${stableSegment.midY}`,
            8,
            Math.min(canvas.height - 8, scanSearchBottom + 28),
          );
        }
      };

      try {
        // 1. 获取图片数据 (保留但不作为参数传入 detectWikiImage，因为该函数在内部会自动处理 ImageData)
        // const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

        // 2. 调用检测函数
        let panels = await detectWikiImage(imageUrl, paramsSnapshot, undefined);
        let usedLockedSecondPass = false;

        // 首轮检测后聚合大 panel 宽度：若存在>50%的10px容差多数，使用其中数锁宽再重跑一轮。
        const majorityWidth = pickMajorityPanelWidth(panels, 10);
        if (majorityWidth !== null) {
          const shouldLockWidth =
            paramsSnapshot.autoDetectPanelWidth !== false ||
            Math.abs(paramsSnapshot.chainBoardWidth - majorityWidth) > 1;

          if (shouldLockWidth) {
            const lockedParams = {
              ...paramsSnapshot,
              chainBoardWidth: majorityWidth,
              autoDetectPanelWidth: false,
            };

            panels = await detectWikiImage(imageUrl, lockedParams, undefined);
            usedLockedSecondPass = true;

            setParams((prev) => {
              if (
                Math.abs(prev.chainBoardWidth - majorityWidth) <= 1 &&
                prev.autoDetectPanelWidth === false
              ) {
                return prev;
              }
              return {
                ...prev,
                chainBoardWidth: majorityWidth,
                autoDetectPanelWidth: false,
              };
            });
          }
        }

        // 第二轮模式下每次检测都强制居中，避免后续重绘把居中结果冲掉。
        if (
          paramsSnapshot.autoDetectPanelWidth === false ||
          usedLockedSecondPass
        ) {
          panels = forceCenterPanelsHorizontally(panels, canvas.width);
        }

        // 仅绘制最新一次检测结果，避免并发返回造成双层框体/双线叠加
        if (runId !== detectRunIdRef.current) {
          return;
        }

        if (slowDetectTimerRef.current) {
          clearTimeout(slowDetectTimerRef.current);
          slowDetectTimerRef.current = null;
        }
        setIsDetectingPreview(false);
        setShowComputingHint(false);

        // 重新绘制底图，确保画面只保留当前这次的框体
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);

        setDetectedPanels(panels);
        setSelectedPanelIndex((prev) => {
          if (panels.length === 0) return -1;
          if (prev >= 0 && prev < panels.length) return prev;
          return 0;
        });

        // 非阻塞调用 OCR，用于回填右侧合成链标题展示
        void recognizePanelTitles(panels);

        // 3. 绘制检测结果
        panels.forEach((panel, index) => {
          // 绘制面板边框 (蓝色)
          ctx.strokeStyle = "blue";
          ctx.lineWidth = 4;
          ctx.strokeRect(panel.x, panel.y, panel.width, panel.height);

          // 绘制标题区域 (绿色)
          if (panel.greenBox) {
            ctx.strokeStyle = "green";
            ctx.lineWidth = 2;
            ctx.strokeRect(
              panel.greenBox.x,
              panel.greenBox.y,
              panel.greenBox.width,
              panel.greenBox.height,
            );
          }

          // 绘制图标区域 (红色)
          if (panel.redBoxes) {
            ctx.strokeStyle = "red";
            ctx.lineWidth = 1;
            panel.redBoxes.forEach((box, iconIdx) => {
              ctx.strokeRect(box.x, box.y, box.width, box.height);

              // 在红框左上方标注左上角坐标
              const coordText = `${Math.round(box.x)},${Math.round(box.y)}`;
              const coordX = Math.max(0, Math.round(box.x));
              const coordY = Math.max(10, Math.round(box.y) - 4);
              ctx.font = "10px monospace";
              const coordWidth =
                Math.ceil(ctx.measureText(coordText).width) + 4;
              ctx.fillStyle = "rgba(255, 255, 255, 0.88)";
              ctx.fillRect(coordX - 1, coordY - 9, coordWidth, 11);
              ctx.fillStyle = "#B91C1C";
              ctx.fillText(coordText, coordX + 1, coordY);

              // 显示图标编号（从 0 开始）
              const drawIndex = Number.isFinite(box.iconIndex)
                ? Number(box.iconIndex)
                : iconIdx;
              const labelX = Math.max(0, box.x + 3);
              const labelY = Math.max(10, box.y + 12);

              ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
              ctx.fillRect(labelX - 1, labelY - 9, 18, 12);
              ctx.fillStyle = "#DC2626";
              ctx.font = "11px monospace";
              ctx.fillText(String(drawIndex), labelX, labelY);
            });
          }

          // 绘制面板序号
          ctx.fillStyle = "blue";
          ctx.font = "20px Arial";
          ctx.fillText(`#${index + 1}`, panel.x, panel.y - 5);
        });

        // 扫描线可视化（与参数联动）
        drawScanGuides(panels);
      } catch (error) {
        if (runId !== detectRunIdRef.current) {
          return;
        }
        if (slowDetectTimerRef.current) {
          clearTimeout(slowDetectTimerRef.current);
          slowDetectTimerRef.current = null;
        }
        setIsDetectingPreview(false);
        setShowComputingHint(false);
        console.error("检测失败:", error);
      }
    },
    [imageUrl, recognizePanelTitles, selectedPanelIndex],
  );

  const requestDetection = useCallback(() => {
    if (!loadedImageRef.current) return;

    if (isDetectingRef.current) {
      hasPendingDetectRef.current = true;
      return;
    }

    const run = async () => {
      do {
        hasPendingDetectRef.current = false;
        const currentImg = loadedImageRef.current;
        if (!currentImg) break;
        isDetectingRef.current = true;
        await drawCanvas(currentImg, latestParamsRef.current);
        isDetectingRef.current = false;
      } while (hasPendingDetectRef.current);
    };

    void run();
  }, [drawCanvas]);

  // 加载图片并检测
  useEffect(() => {
    if (!isOpen || !imageUrl) {
      loadedImageRef.current = null;
      return;
    }

    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      loadedImageRef.current = img;
      requestDetection();
    };
    img.src = imageUrl;
  }, [isOpen, imageUrl, requestDetection]);

  useEffect(() => {
    latestParamsRef.current = params;
    if (isOpen && loadedImageRef.current) {
      requestDetection();
    }
  }, [params, isOpen, requestDetection]);

  useEffect(
    () => () => {
      if (slowDetectTimerRef.current) {
        clearTimeout(slowDetectTimerRef.current);
      }
      setIsDetectingPreview(false);
      if (saveParamsTimerRef.current) {
        clearTimeout(saveParamsTimerRef.current);
      }
      flushPendingParamsPersist();
    },
    [flushPendingParamsPersist],
  );

  // 参数更新处理
  const handleParamChange = (
    key: keyof DebugPanelParams,
    value: number | boolean,
  ) => {
    const newParams = normalizeWidthAutoParams({
      ...params,
      [key]: value,
    } as DebugPanelParams);
    setParams(newParams);
  };

  const detectHorizontalRangeAtY = useCallback(
    (
      imageData: ImageData,
      y: number,
      tolerance: number,
      sustained: number,
    ): { startX: number; endX: number } | null => {
      const { data, width, height } = imageData;
      if (y < 0 || y >= height) return null;

      const getPixel = (x: number): [number, number, number] => {
        const idx = (y * width + x) * 4;
        return [data[idx], data[idx + 1], data[idx + 2]];
      };

      const colorDiff = (
        a: [number, number, number],
        b: [number, number, number],
      ) =>
        Math.max(
          Math.abs(a[0] - b[0]),
          Math.abs(a[1] - b[1]),
          Math.abs(a[2] - b[2]),
        );

      const bgLeft = getPixel(0);
      const bgRight = getPixel(width - 1);
      const minRun = Math.max(2, sustained);

      let left = -1;
      let leftRun = 0;
      for (let x = 0; x < width; x++) {
        const diff = colorDiff(getPixel(x), bgLeft);
        if (diff > tolerance) {
          leftRun++;
          if (leftRun >= minRun) {
            left = x - minRun + 1;
            break;
          }
        } else {
          leftRun = 0;
        }
      }

      if (left < 0) return null;

      let right = -1;
      let rightRun = 0;
      for (let x = width - 1; x >= 0; x--) {
        const diff = colorDiff(getPixel(x), bgRight);
        if (diff > tolerance) {
          rightRun++;
          if (rightRun >= minRun) {
            right = x + minRun - 1;
            break;
          }
        } else {
          rightRun = 0;
        }
      }

      if (right < 0 || right <= left) return null;
      return { startX: Math.max(0, left), endX: Math.min(width - 1, right) };
    },
    [],
  );

  const estimateChainBoardWidthFromCanvas = useCallback((): number | null => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || detectedPanels.length === 0) return null;

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const sampleYs = detectedPanels
      .flatMap((panel) => {
        const top = Math.round(panel.y);
        const titleBottom = Math.round(panel.y + panel.greenBox.height);
        const mid = Math.round(panel.y + panel.height * 0.5);
        const bottom = Math.round(panel.y + panel.height - 28);
        return [titleBottom + 12, mid, bottom, top + 40];
      })
      .map((y) => Math.max(0, Math.min(canvas.height - 1, y)))
      .filter((y, idx, arr) => arr.indexOf(y) === idx);

    const widths: number[] = [];
    for (const y of sampleYs) {
      const range = detectHorizontalRangeAtY(
        imageData,
        y,
        Math.max(8, params.colorToleranceX),
        Math.max(2, params.sustainedPixelsX),
      );
      if (!range) continue;
      const width = range.endX - range.startX;
      if (width >= 120 && width <= canvas.width) {
        widths.push(width);
      }
    }

    // 兜底：没有像素扫描结果时，使用当前蓝框宽度中位数。
    if (widths.length === 0) {
      const fallback = detectedPanels
        .map((panel) => Number(panel?.blueBox?.width || 0))
        .filter((w) => Number.isFinite(w) && w >= 120);
      if (fallback.length === 0) return null;
      const sorted = [...fallback].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      const median =
        sorted.length % 2 === 0
          ? (sorted[mid - 1] + sorted[mid]) / 2
          : sorted[mid];
      return Math.max(120, Math.min(1000, Math.round(median)));
    }

    const sorted = [...widths].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const median =
      sorted.length % 2 === 0
        ? (sorted[mid - 1] + sorted[mid]) / 2
        : sorted[mid];
    return Math.max(120, Math.min(1000, Math.round(median)));
  }, [
    detectedPanels,
    detectHorizontalRangeAtY,
    params.colorToleranceX,
    params.sustainedPixelsX,
  ]);

  const estimateStableScanStartYFromCanvas = useCallback((): number | null => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return null;

    const { width, height } = canvas;
    if (height < 6 || width < 1) return null;

    const scanX = Math.max(
      0,
      Math.min(width - 1, Math.round(params.scanLineX)),
    );
    void scanX;
    const fallbackY = Math.max(
      0,
      Math.min(height - 1, Math.round(params.scanStartY)),
    );
    const refineRange = Math.max(
      2,
      Math.round(
        (params as DebugPanelParams & { localScanStartRefineRange?: number })
          .localScanStartRefineRange ?? 60,
      ),
    );
    const sampleRadius = Math.max(
      1,
      Math.round(
        (params as DebugPanelParams & { localScanStartSampleRadius?: number })
          .localScanStartSampleRadius ?? 3,
      ),
    );

    const percentile = (values: number[], ratio: number) => {
      if (values.length === 0) return 0;
      const sorted = [...values].sort((a, b) => a - b);
      const idx = Math.max(
        0,
        Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * ratio)),
      );
      return sorted[idx];
    };

    const imageData = ctx.getImageData(0, 0, width, height);
    const { data } = imageData;
    const toLuma = (r: number, g: number, b: number) =>
      0.299 * r + 0.587 * g + 0.114 * b;

    const searchTop = Math.max(0, fallbackY - refineRange);
    const searchBottom = Math.min(height - 1, fallbackY + refineRange);
    const minStableHeight = 4;
    if (searchTop > searchBottom) return fallbackY;

    const xStart = 0;
    const xEnd = width - 1;
    const xStep = Math.max(1, sampleRadius);

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
      if (count > 0) {
        const mean = lumaSum / count;
        const variance = Math.max(0, lumaSquareSum / count - mean * mean);
        samples.push({ y, score: variance });
      }
    }

    if (samples.length === 0) return fallbackY;

    const sortedScores = samples.map((s) => s.score).sort((a, b) => a - b);
    const best = sortedScores[0];
    const p35 = percentile(sortedScores, 0.35);
    const thresholdFactor = Math.max(
      0.2,
      Math.min(3, Number(params.scanStableVarianceThresholdFactor ?? 1)),
    );
    const stableThreshold =
      best + Math.max(0.6, (p35 - best) * 1.15) * thresholdFactor;

    const segments: Array<{
      startY: number;
      endY: number;
      avgScore: number;
      len: number;
    }> = [];
    let segStart = -1;
    let segEnd = -1;
    let segScoreSum = 0;
    let segCount = 0;
    const flush = () => {
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
      if (sample.score > stableThreshold) {
        flush();
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
    flush();

    if (segments.length === 0) {
      const bestSingle = samples.reduce((acc, cur) =>
        cur.score < acc.score ? cur : acc,
      );
      const startY = Math.max(
        searchTop,
        Math.min(
          searchBottom - minStableHeight + 1,
          bestSingle.y - Math.floor(minStableHeight / 2),
        ),
      );
      const endY = Math.min(searchBottom, startY + minStableHeight - 1);
      return Math.round((startY + endY) / 2);
    }

    const chosen = segments.sort((a, b) => {
      if (a.avgScore !== b.avgScore) return a.avgScore - b.avgScore;
      if (a.len !== b.len) return b.len - a.len;
      const aMid = (a.startY + a.endY) / 2;
      const bMid = (b.startY + b.endY) / 2;
      return Math.abs(aMid - fallbackY) - Math.abs(bMid - fallbackY);
    })[0];

    const startY =
      chosen.len >= minStableHeight
        ? chosen.startY
        : Math.max(
            searchTop,
            Math.min(
              searchBottom - minStableHeight + 1,
              Math.round((chosen.startY + chosen.endY) / 2) -
                Math.floor(minStableHeight / 2),
            ),
          );
    const endY =
      chosen.len >= minStableHeight
        ? chosen.endY
        : Math.min(searchBottom, startY + minStableHeight - 1);

    return Math.round((startY + endY) / 2);
  }, [params]);

  const handleAutoDetectChainBoardWidth = useCallback(
    async (silent = false) => {
      if (isAutoDetectingWidth) return;
      setIsAutoDetectingWidth(true);
      try {
        await new Promise((resolve) => setTimeout(resolve, 0));
        const nextWidth = estimateChainBoardWidthFromCanvas();
        if (!nextWidth) {
          if (!silent) {
            alert("当前没有可用的合成链宽度样本，请先完成一次检测");
          }
          return;
        }
        setParams((prev) => {
          if (Math.abs(prev.chainBoardWidth - nextWidth) < 2) {
            return prev;
          }
          return normalizeWidthAutoParams({
            ...prev,
            chainBoardWidth: nextWidth,
          });
        });
      } finally {
        setIsAutoDetectingWidth(false);
      }
    },
    [estimateChainBoardWidthFromCanvas, isAutoDetectingWidth],
  );

  useEffect(() => {
    if (!isOpen) {
      autoWidthAppliedKeyRef.current = "";
      autoScanLineAdjustStateRef.current = { imageUrl: "", count: 0 };
      autoScanStartYAdjustStateRef.current = { imageUrl: "", count: 0 };
      return;
    }
    if (!imageUrl || detectedPanels.length === 0) return;

    const key = imageUrl;
    if (autoWidthAppliedKeyRef.current === key) return;

    autoWidthAppliedKeyRef.current = key;
    void handleAutoDetectChainBoardWidth(true);
  }, [
    isOpen,
    imageUrl,
    detectedPanels.length,
    handleAutoDetectChainBoardWidth,
  ]);

  useEffect(() => {
    if (!isOpen || !imageUrl || !loadedImageRef.current) return;

    if (autoScanStartYAdjustStateRef.current.imageUrl !== imageUrl) {
      autoScanStartYAdjustStateRef.current = { imageUrl, count: 0 };
    }
    if (autoScanStartYAdjustStateRef.current.count >= 2) return;

    const suggestedScanStartY = estimateStableScanStartYFromCanvas();
    if (suggestedScanStartY === null) return;
    if (Math.abs(params.scanStartY - suggestedScanStartY) < 1) return;

    autoScanStartYAdjustStateRef.current.count += 1;
    setParams((prev) =>
      normalizeWidthAutoParams({
        ...prev,
        scanStartY: Math.round(suggestedScanStartY),
      }),
    );
  }, [
    isOpen,
    imageUrl,
    params.scanStartY,
    params.scanLineX,
    estimateStableScanStartYFromCanvas,
    detectedPanels.length,
  ]);

  useEffect(() => {
    if (!isOpen || !imageUrl || detectedPanels.length === 0) return;

    const refPanel =
      selectedPanelIndex >= 0 && selectedPanelIndex < detectedPanels.length
        ? detectedPanels[selectedPanelIndex]
        : detectedPanels[0];
    if (!refPanel) return;

    // 合成链扫描线：固定跟随“大panel左边界 + 42px”。
    const rawSuggested = Math.round(refPanel.blueBox.x + 42);
    const maxX = Math.max(0, (loadedImageRef.current?.width ?? 1) - 1);
    const suggestedScanX = Math.max(0, Math.min(maxX, rawSuggested));
    if (autoScanLineAdjustStateRef.current.imageUrl !== imageUrl) {
      autoScanLineAdjustStateRef.current = { imageUrl, count: 0 };
    }
    if (autoScanLineAdjustStateRef.current.count >= 2) return;

    if (Math.abs(params.scanLineX - suggestedScanX) < 2) return;
    autoScanLineAdjustStateRef.current.count += 1;

    setParams((prev) =>
      normalizeWidthAutoParams({
        ...prev,
        scanLineX: suggestedScanX,
      }),
    );
  }, [isOpen, imageUrl, detectedPanels, params.scanLineX, selectedPanelIndex]);

  // 导出工作台
  const handleExport = async () => {
    if (detectedPanels.length === 0) {
      alert("请先检测面板！");
      return;
    }
    await Promise.resolve(onExport(detectedPanels));
    if (autoCloseOnExport) {
      onClose();
    }
  };

  const renderNumericParamControl = (
    label: string,
    key: keyof DebugPanelParams,
    min: number,
    max: number,
    step: number,
  ) => {
    const currentValue = Number(params[key] ?? 0);
    const sliderValue = Math.max(min, Math.min(max, currentValue));

    return (
      <div>
        <Label className="text-xs font-medium text-gray-600">{label}</Label>
        <div className="mt-2 flex items-center gap-3">
          <Slider
            value={[sliderValue]}
            onValueChange={([v]) => handleParamChange(key, v)}
            min={min}
            max={max}
            step={step}
            className="flex-1"
          />
          <Input
            type="number"
            value={currentValue}
            onChange={(e) =>
              handleParamChange(key, Number(e.target.value) || 0)
            }
            className="w-20 text-center text-sm"
          />
        </div>
      </div>
    );
  };

  const chainCount = detectedPanels.length;
  const totalIconCount = detectedPanels.reduce(
    (sum, panel) => sum + (panel.redBoxes?.length || 0),
    0,
  );
  const isCroppingInProgress = disableClose;
  const isNextImageLoading = isDetectingPreview && !disableClose;
  const confirmButtonClassName = isCroppingInProgress
    ? "h-11 w-full bg-blue-600 text-base font-semibold hover:bg-blue-700"
    : isNextImageLoading
      ? "h-11 w-full bg-amber-500 text-base font-semibold hover:bg-amber-600"
      : "h-11 w-full bg-green-600 text-base font-semibold hover:bg-green-700";
  const confirmButtonText = isCroppingInProgress
    ? "切图中..."
    : isNextImageLoading
      ? "新图识别中..."
      : "确认切图";

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) {
          if (disableClose) return;
          onClose();
        }
      }}
    >
      <DialogContent className="w-[98vw] max-w-[98vw] sm:max-w-[98vw] h-[96vh] overflow-hidden p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle>切图确认 - 工作台模式</DialogTitle>
          {typeof batchCurrent === "number" &&
            typeof batchTotal === "number" && (
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                <span className="rounded bg-blue-100 px-2 py-1 font-medium text-blue-700">
                  当前图片 {batchCurrent}/{batchTotal}
                </span>
                <span className="rounded bg-emerald-100 px-2 py-1 font-medium text-emerald-700">
                  已切图片 {batchCompletedImages}
                </span>
                <span className="rounded bg-violet-100 px-2 py-1 font-medium text-violet-700">
                  已切合成链 {batchCompletedChains}
                </span>
                <span className="rounded bg-lime-100 px-2 py-1 font-medium text-lime-700">
                  已切图标 {batchCompletedIcons}
                </span>
                {batchProcessingLabel ? (
                  <span className="rounded bg-amber-100 px-2 py-1 font-medium text-amber-700">
                    {batchProcessingLabel}
                  </span>
                ) : null}
              </div>
            )}
        </DialogHeader>

        <div className="flex flex-col lg:flex-row h-[calc(96vh-96px)] gap-4">
          {/* 左侧：调试视图（与 debug 页面同布局） */}
          <div className="relative flex-1 overflow-auto pr-1">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm">调试视图</CardTitle>
                  {showComputingHint && (
                    <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
                      计算中...
                    </span>
                  )}
                </div>
              </CardHeader>
              <CardContent className="relative overflow-auto">
                <canvas
                  ref={canvasRef}
                  className="max-w-full w-auto h-auto border border-gray-300 block"
                />
              </CardContent>
            </Card>
            {isDetectingPreview && (
              <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
                <div className="flex items-center gap-2 rounded-md bg-black/70 px-3 py-2 text-sm font-semibold text-white shadow-lg">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  识别计算中...
                </div>
              </div>
            )}
            {disableClose && (
              <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-white/30 backdrop-blur-[1px]">
                <div className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white shadow-lg">
                  当前图片正在裁切，请稍候...
                </div>
              </div>
            )}
          </div>

          {/* 右侧：控制面板（与 debug 页面同布局） */}
          <div
            className={`w-full lg:w-96 shrink-0 h-full overflow-y-auto space-y-4 ${
              disableClose ? "pointer-events-none opacity-60" : ""
            }`}
          >
            {/* 切图确认信息 */}
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">切图确认</CardTitle>
                <CardDescription className="text-xs">
                  自动检测到合成链 {chainCount} 条，图标共 {totalIconCount} 个
                </CardDescription>
                <CardDescription className="text-xs">
                  {isCroppingInProgress
                    ? "当前状态：正在切图"
                    : isNextImageLoading
                      ? "当前状态：新图片加载并识别中"
                      : "当前状态：等待确认"}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button
                  onClick={() => {
                    void handleExport();
                  }}
                  className={confirmButtonClassName}
                  disabled={
                    chainCount === 0 ||
                    isCroppingInProgress ||
                    isNextImageLoading
                  }
                >
                  {confirmButtonText}
                </Button>
              </CardContent>
            </Card>

            {/* Panel选择 */}
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm">合成链检测</CardTitle>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={() => setShowChainDetection((prev) => !prev)}
                  >
                    {showChainDetection ? (
                      <ChevronDown className="mr-1 h-3.5 w-3.5" />
                    ) : (
                      <ChevronRight className="mr-1 h-3.5 w-3.5" />
                    )}
                    {showChainDetection ? "收起" : "展开"}
                  </Button>
                </div>
                <CardDescription className="text-xs">
                  检测到 {detectedPanels.length} 条合成链
                </CardDescription>
              </CardHeader>
              {showChainDetection && (
                <CardContent className="space-y-3">
                  <div className="space-y-2">
                    {detectedPanels.map((panel, index) => (
                      <div
                        key={index}
                        className="rounded-md border border-border"
                      >
                        <button
                          type="button"
                          onClick={() =>
                            setSelectedPanelIndex((prev) =>
                              prev === index ? -1 : index,
                            )
                          }
                          className={`flex w-full items-center justify-between rounded-md px-4 py-2 text-left transition-colors ${
                            selectedPanelIndex === index
                              ? "bg-slate-950 text-white"
                              : "bg-slate-100 text-slate-900 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
                          }`}
                        >
                          <span>
                            {getPanelDisplayTitle(panel, index)} ({panel.rows}x
                            {panel.cols})
                          </span>
                          <span className="ml-2 rounded bg-purple-100 px-2 py-0.5 text-xs text-purple-700">
                            {panel.redBoxes?.length || 0}个合成物
                          </span>
                        </button>

                        {selectedPanelIndex === index && (
                          <div className="space-y-2 bg-slate-50 p-2 text-xs dark:bg-slate-900/40">
                            <div className="rounded border border-blue-200 bg-blue-50 p-2 dark:border-blue-900 dark:bg-blue-950/40">
                              <p className="mb-1 font-semibold text-blue-700 dark:text-blue-300">
                                合成链底板
                              </p>
                              <p>
                                左上角点（{Math.round(panel.blueBox.x)}，
                                {Math.round(panel.blueBox.y)}），宽
                                {Math.round(panel.blueBox.width)}，高
                                {Math.round(panel.blueBox.height)}
                              </p>
                            </div>

                            <div className="rounded border border-green-200 bg-green-50 p-2 dark:border-green-900 dark:bg-green-950/40">
                              <p className="mb-1 font-semibold text-green-700 dark:text-green-300">
                                标题区
                              </p>
                              <p>
                                左上角点（{Math.round(panel.greenBox.x)}，
                                {Math.round(panel.greenBox.y)}），宽
                                {Math.round(panel.greenBox.width)}，高
                                {Math.round(panel.greenBox.height)}
                              </p>
                              <p>
                                文本：
                                {panel.ocrTitle && panel.ocrTitle.trim()
                                  ? panel.ocrTitle
                                  : "未识别"}
                              </p>
                            </div>

                            <div className="rounded border border-red-200 bg-red-50 p-2 dark:border-red-900 dark:bg-red-950/40">
                              <p className="mb-1 font-semibold text-red-700 dark:text-red-300">
                                Icon区
                              </p>
                              <p>共 {panel.redBoxes.length} 个</p>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </CardContent>
              )}
            </Card>

            {/* 调试参数 */}
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm">调试参数</CardTitle>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={requestDetection}
                      disabled={!loadedImageRef.current}
                    >
                      {isDetectingPreview ? (
                        <>
                          <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                          重新分析中...
                        </>
                      ) : (
                        "重新标注分析"
                      )}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={() => setShowDebugParams((prev) => !prev)}
                    >
                      {showDebugParams ? (
                        <ChevronDown className="mr-1 h-3.5 w-3.5" />
                      ) : (
                        <ChevronRight className="mr-1 h-3.5 w-3.5" />
                      )}
                      {showDebugParams ? "收起" : "展开"}
                    </Button>
                  </div>
                </div>
              </CardHeader>
              {showDebugParams && (
                <CardContent>
                  <div className="space-y-6 pr-1">
                    <div className="border-l-4 border-violet-500 pl-4">
                      <Label className="mb-3 block text-sm font-semibold text-violet-600">
                        合成链板
                      </Label>
                      <div className="space-y-4">
                        {renderNumericParamControl(
                          "宽度",
                          "chainBoardWidth",
                          100,
                          1000,
                          1,
                        )}

                        <div className="flex flex-wrap items-center gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="text-xs"
                            onClick={() => {
                              void handleAutoDetectChainBoardWidth(false);
                            }}
                            disabled={isAutoDetectingWidth}
                          >
                            {isAutoDetectingWidth ? (
                              <>
                                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                                识别中...
                              </>
                            ) : (
                              "自动识别宽度"
                            )}
                          </Button>
                          <span className="text-xs text-muted-foreground">
                            基于当前检测结果的中位宽度
                          </span>
                        </div>

                        {renderNumericParamControl(
                          "投票容差",
                          "panelWidthVoteTolerance",
                          8,
                          80,
                          1,
                        )}
                      </div>
                    </div>

                    <div className="border-l-4 border-green-500 pl-4">
                      <Label className="mb-3 block text-sm font-semibold text-green-600">
                        标题区域
                      </Label>
                      <div className="space-y-4">
                        {renderNumericParamControl(
                          "高度",
                          "gridStartY",
                          -200,
                          100,
                          1,
                        )}
                        {renderNumericParamControl(
                          "稳定方差阈值系数",
                          "scanStableVarianceThresholdFactor",
                          0.2,
                          3,
                          0.05,
                        )}
                      </div>
                    </div>

                    <div className="border-l-4 border-orange-500 pl-4">
                      <Label className="mb-3 block text-sm font-semibold text-orange-600">
                        合成链扫描线
                      </Label>
                      <div className="space-y-4">
                        {renderNumericParamControl(
                          "扫描线 X 坐标",
                          "scanLineX",
                          0,
                          100,
                          1,
                        )}
                        {renderNumericParamControl(
                          "扫描起始 Y 坐标",
                          "scanStartY",
                          0,
                          500,
                          1,
                        )}
                        {renderNumericParamControl(
                          "颜色容差值",
                          "colorTolerance",
                          5,
                          50,
                          1,
                        )}
                        {renderNumericParamControl(
                          "连续判定高度",
                          "sustainedPixels",
                          5,
                          100,
                          5,
                        )}
                      </div>
                    </div>

                    <div className="border-l-4 border-cyan-500 pl-4">
                      <Label className="mb-3 block text-sm font-semibold text-cyan-600">
                        X轴检测相关
                      </Label>
                      <div className="space-y-4">
                        {renderNumericParamControl(
                          "X轴颜色容差",
                          "colorToleranceX",
                          5,
                          50,
                          1,
                        )}
                        {renderNumericParamControl(
                          "X轴连续判定",
                          "sustainedPixelsX",
                          3,
                          100,
                          1,
                        )}
                      </div>
                    </div>

                    <div className="border-l-4 border-blue-500 pl-4">
                      <Label className="mb-3 block text-sm font-semibold text-blue-600">
                        图标检测
                      </Label>
                      <div className="mb-4 grid grid-cols-3 gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant={
                            iconDetectTab === "bounds" ? "default" : "outline"
                          }
                          onClick={() => setIconDetectTab("bounds")}
                          className="text-xs"
                        >
                          边界检测
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant={
                            iconDetectTab === "square" ? "default" : "outline"
                          }
                          onClick={() => setIconDetectTab("square")}
                          className="text-xs"
                        >
                          偏移校准
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant={
                            iconDetectTab === "empty" ? "default" : "outline"
                          }
                          onClick={() => setIconDetectTab("empty")}
                          className="text-xs"
                        >
                          空图标过滤
                        </Button>
                      </div>

                      <div className="min-h-260">
                        {iconDetectTab === "bounds" && (
                          <div className="space-y-4">
                            <p className="text-xs text-muted-foreground">
                              当前流程固定启用边界检测。
                            </p>
                            {renderNumericParamControl(
                              "行窗口高度",
                              "boundsWindowHeight",
                              1,
                              20,
                              1,
                            )}
                            {renderNumericParamControl(
                              "列窗口宽度",
                              "boundsWindowWidth",
                              1,
                              20,
                              1,
                            )}
                            {renderNumericParamControl(
                              "行检测阈值",
                              "boundsVarianceThresholdRow",
                              10,
                              100,
                              1,
                            )}
                            {renderNumericParamControl(
                              "列检测阈值",
                              "boundsVarianceThresholdCol",
                              10,
                              100,
                              1,
                            )}
                            {renderNumericParamControl(
                              "边界步长",
                              "boundsStepSize",
                              1,
                              10,
                              1,
                            )}
                            {renderNumericParamControl(
                              "最小行高",
                              "boundsMinRowHeight",
                              1,
                              100,
                              1,
                            )}
                            {renderNumericParamControl(
                              "最小列宽",
                              "boundsMinColWidth",
                              1,
                              100,
                              1,
                            )}
                          </div>
                        )}

                        {iconDetectTab === "square" && (
                          <div className="space-y-4">
                            <div className="flex items-center gap-2">
                              <input
                                type="checkbox"
                                id="forceSquareIcons"
                                title="强制图标为1:1正方形"
                                checked={params.forceSquareIcons}
                                onChange={(e) =>
                                  handleParamChange(
                                    "forceSquareIcons",
                                    e.target.checked,
                                  )
                                }
                              />
                              <Label
                                htmlFor="forceSquareIcons"
                                className="text-xs"
                              >
                                强制图标为 1:1 正方形
                              </Label>
                            </div>

                            {renderNumericParamControl(
                              "X轴偏移",
                              "forceSquareOffsetX",
                              -50,
                              50,
                              1,
                            )}
                            {renderNumericParamControl(
                              "Y轴偏移",
                              "forceSquareOffsetY",
                              -50,
                              50,
                              1,
                            )}
                          </div>
                        )}

                        {iconDetectTab === "empty" && (
                          <div className="space-y-4">
                            <div className="flex items-center gap-2">
                              <input
                                type="checkbox"
                                id="filterEmptyIcons"
                                title="过滤空图标"
                                checked={params.filterEmptyIcons}
                                onChange={(e) =>
                                  handleParamChange(
                                    "filterEmptyIcons",
                                    e.target.checked,
                                  )
                                }
                              />
                              <Label
                                htmlFor="filterEmptyIcons"
                                className="text-xs"
                              >
                                过滤空图标
                              </Label>
                            </div>

                            {renderNumericParamControl(
                              "空图标方差阈值",
                              "emptyIconVarianceThreshold",
                              1,
                              100,
                              1,
                            )}

                            <div className="flex items-center gap-2">
                              <input
                                type="checkbox"
                                id="useVisionFallback"
                                title="启用视觉识别兜底"
                                checked={params.useVisionFallback}
                                onChange={(e) =>
                                  handleParamChange(
                                    "useVisionFallback",
                                    e.target.checked,
                                  )
                                }
                              />
                              <Label
                                htmlFor="useVisionFallback"
                                className="text-xs"
                              >
                                启用视觉识别兜底
                              </Label>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </CardContent>
              )}
            </Card>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
