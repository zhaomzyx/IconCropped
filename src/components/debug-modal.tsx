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
import { ChevronDown, ChevronRight } from "lucide-react";
import { detectWikiImage } from "@/lib/wiki-image-detector";
import {
  isPlaceholderPanelTitle,
  normalizePanelTitleCandidate,
} from "@/lib/panel-title";

// 调试台参数接口
export interface DebugPanelParams {
  chainBoardWidth: number;
  gridStartY: number;
  scanLineX: number;
  scanStartY: number;
  colorTolerance: number;
  sustainedPixels: number;
  colorToleranceX: number;
  sustainedPixelsX: number;
  boundsWindowHeight: number;
  boundsWindowWidth: number;
  boundsVarianceThresholdRow: number;
  boundsVarianceThresholdCol: number;
  boundsStepSize: number;
  boundsMinRowHeight: number;
  boundsMinColWidth: number;
  forceSquareIcons: boolean;
  forceSquareOffsetX: number;
  forceSquareOffsetY: number;
  filterEmptyIcons: boolean;
  emptyIconVarianceThreshold: number;
  useVisionFallback: boolean;
}

// 默认参数
const DEFAULT_PARAMS: DebugPanelParams = {
  chainBoardWidth: 786,
  gridStartY: 107,
  scanLineX: 49,
  scanStartY: 200,
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

// 检测到的面板数据
export interface DetectedPanel {
  title: string;
  ocrTitle?: string;
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

interface DebugModalProps {
  imageUrl: string;
  isOpen: boolean;
  onClose: () => void;
  onExport: (panels: DetectedPanel[]) => void;
}

const isFallbackPanelTitle = (title?: string) => isPlaceholderPanelTitle(title);

export default function DebugModal({
  imageUrl,
  isOpen,
  onClose,
  onExport,
}: DebugModalProps) {
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
  const [iconDetectTab, setIconDetectTab] = useState<
    "bounds" | "square" | "empty"
  >("bounds");

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

      try {
        ocrInFlightRef.current = true;
        const response = await fetch("/api/ocr-panel-titles", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            imageUrl,
            panels: panels.map((panel, index) => ({
              index,
              title: panel.title,
              greenBox: panel.greenBox,
              blueBox: panel.blueBox,
            })),
          }),
        });

        if (!response.ok) {
          return;
        }

        const payload = (await response.json()) as {
          success?: boolean;
          titles?: string[];
        };

        if (!payload.success || !Array.isArray(payload.titles)) {
          return;
        }

        console.group("[OCR][DebugModal] titles response");
        payload.titles.forEach((value, index) => {
          console.log(`panel#${index + 1} raw=${JSON.stringify(value || "")}`);
        });
        console.groupEnd();

        setDetectedPanels((prev) => {
          if (prev.length === 0) return prev;
          const mapped = prev.map((panel, index) => {
            const ocrTitle = normalizePanelTitleCandidate(
              payload.titles?.[index] || "",
            );
            if (!ocrTitle) {
              console.log(
                `[OCR][DebugModal] panel#${index + 1} ignored after normalize`,
              );
              return panel;
            }

            console.log(
              `[OCR][DebugModal] panel#${index + 1} applied=${JSON.stringify(ocrTitle)}`,
            );
            return {
              ...panel,
              ocrTitle,
            };
          });
          return mapped;
        });
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
    const STORAGE_KEY = "wiki_slice_config";
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const savedParams = JSON.parse(saved);

        setParams({ ...DEFAULT_PARAMS, ...savedParams } as DebugPanelParams);
      }
    } catch {
      console.warn("无法读取调试参数，使用默认值");
    }
  }, []);

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

      const drawScanGuides = () => {
        const scanX = Math.max(
          0,
          Math.min(canvas.width - 1, paramsSnapshot.scanLineX),
        );
        const scanY = Math.max(
          0,
          Math.min(canvas.height - 1, paramsSnapshot.scanStartY),
        );

        // 竖向扫描线（X轴）
        ctx.save();
        ctx.setLineDash([6, 4]);
        ctx.strokeStyle = "#F97316";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(scanX, 0);
        ctx.lineTo(scanX, canvas.height);
        ctx.stroke();

        // 横向扫描起点线（Y轴）
        ctx.strokeStyle = "#06B6D4";
        ctx.beginPath();
        ctx.moveTo(0, scanY);
        ctx.lineTo(canvas.width, scanY);
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

        ctx.fillStyle = "#06B6D4";
        ctx.fillText(`scanStartY=${scanY}`, 8, Math.max(14, scanY - 6));
      };

      try {
        // 1. 获取图片数据 (保留但不作为参数传入 detectWikiImage，因为该函数在内部会自动处理 ImageData)
        // const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

        // 2. 调用检测函数
        const panels = await detectWikiImage(
          imageUrl,
          paramsSnapshot,
          undefined,
        );

        // 仅绘制最新一次检测结果，避免并发返回造成双层框体/双线叠加
        if (runId !== detectRunIdRef.current) {
          return;
        }

        if (slowDetectTimerRef.current) {
          clearTimeout(slowDetectTimerRef.current);
          slowDetectTimerRef.current = null;
        }
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
        drawScanGuides();
      } catch (error) {
        if (runId !== detectRunIdRef.current) {
          return;
        }
        if (slowDetectTimerRef.current) {
          clearTimeout(slowDetectTimerRef.current);
          slowDetectTimerRef.current = null;
        }
        setShowComputingHint(false);
        console.error("检测失败:", error);
      }
    },
    [imageUrl, recognizePanelTitles],
  );

  const requestDetection = useCallback(() => {
    const img = loadedImageRef.current;
    if (!img) return;

    if (isDetectingRef.current) {
      hasPendingDetectRef.current = true;
      return;
    }

    const run = async () => {
      do {
        hasPendingDetectRef.current = false;
        isDetectingRef.current = true;
        await drawCanvas(img, latestParamsRef.current);
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
    },
    [],
  );

  // 参数更新处理
  const handleParamChange = (
    key: keyof DebugPanelParams,
    value: number | boolean,
  ) => {
    const newParams = { ...params, [key]: value };
    setParams(newParams);

    // 保存到 LocalStorage
    try {
      localStorage.setItem("wiki_slice_config", JSON.stringify(newParams));
    } catch {
      console.warn("无法保存参数到 LocalStorage");
    }
  };

  // 导出工作台
  const handleExport = () => {
    if (detectedPanels.length === 0) {
      alert("请先检测面板！");
      return;
    }
    onExport(detectedPanels);
    onClose();
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

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="w-[98vw] max-w-[98vw] sm:max-w-[98vw] h-[96vh] overflow-hidden p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle>切图确认 - 工作台模式</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col lg:flex-row h-[calc(96vh-96px)] gap-4">
          {/* 左侧：调试视图（与 debug 页面同布局） */}
          <div className="flex-1 overflow-auto pr-1">
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
              <CardContent className="overflow-auto">
                <canvas
                  ref={canvasRef}
                  className="max-w-full w-auto h-auto border border-gray-300 block"
                />
              </CardContent>
            </Card>
          </div>

          {/* 右侧：控制面板（与 debug 页面同布局） */}
          <div className="w-full lg:w-96 shrink-0 h-full overflow-y-auto space-y-4">
            {/* 切图确认信息 */}
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">切图确认</CardTitle>
                <CardDescription className="text-xs">
                  自动检测到合成链 {chainCount} 条，图标共 {totalIconCount} 个
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button
                  onClick={handleExport}
                  className="h-11 w-full bg-green-600 text-base font-semibold hover:bg-green-700"
                  disabled={chainCount === 0}
                >
                  确认切图
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
              </CardHeader>
              {showDebugParams && (
                <CardContent>
                  <div className="space-y-6 pr-1">
                    <div className="border-l-4 border-violet-500 pl-4">
                      <Label className="mb-3 block text-sm font-semibold text-violet-600">
                        合成链板
                      </Label>
                      {renderNumericParamControl(
                        "宽度",
                        "chainBoardWidth",
                        100,
                        1000,
                        1,
                      )}
                    </div>

                    <div className="border-l-4 border-green-500 pl-4">
                      <Label className="mb-3 block text-sm font-semibold text-green-600">
                        标题区域
                      </Label>
                      {renderNumericParamControl(
                        "高度",
                        "gridStartY",
                        -200,
                        100,
                        1,
                      )}
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
