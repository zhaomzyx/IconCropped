'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { X, Download, Save, Upload, Info, Search, RotateCcw } from 'lucide-react';
import { detectWikiImage, DetectionParams } from '@/lib/wiki-image-detector';

// 调试台参数接口
export interface DebugPanelParams {
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
  enableImageEnhancement: boolean;  // 🌟 新增：是否启用图像增强
}

// 默认参数
const DEFAULT_PARAMS: DebugPanelParams = {
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
  boundsMinRowHeight: 10,
  boundsMinColWidth: 20,
  forceSquareIcons: true,
  forceSquareOffsetX: 0,
  forceSquareOffsetY: 12,  // 🌟 调整：将首行检测位置向下移动10px（从2调整为12）
  filterEmptyIcons: true,
  emptyIconVarianceThreshold: 20,
  enableImageEnhancement: true,  // 🌟 默认启用图像增强
};

// 检测到的面板数据
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
}

interface DebugModalProps {
  imageUrl: string;
  isOpen: boolean;
  onClose: () => void;
  onExport: (panels: DetectedPanel[]) => void;
}

export default function DebugModal({ imageUrl, isOpen, onClose, onExport }: DebugModalProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [params, setParams] = useState<DebugPanelParams>(DEFAULT_PARAMS);
  const [detectedPanels, setDetectedPanels] = useState<DetectedPanel[]>([]);
  const [selectedPanelIndex, setSelectedPanelIndex] = useState<number>(-1);
  const [logInfo, setLogInfo] = useState<string>('');
  const [isAutoDetecting, setIsAutoDetecting] = useState(false);  // 🌟 新增：标记是否正在自动检测

  // 初始化参数
  useEffect(() => {
    const STORAGE_KEY = 'wiki_slice_config';
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const savedParams = JSON.parse(saved);
        setParams({ ...DEFAULT_PARAMS, ...savedParams });
      }
    } catch (e) {
      console.warn('无法读取调试参数，使用默认值');
    }
  }, []);

  // 加载图片并自动检测
  useEffect(() => {
    if (!isOpen || !imageUrl) return;

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = async () => {
      drawCanvas(img);

      // 🌟 自动执行检测（只在 Modal 首次打开时）
      if (!isAutoDetecting) {
        setIsAutoDetecting(true);
        await performAutoDetect();
      }
    };
    img.src = imageUrl;
  }, [isOpen, imageUrl, params]);

  // 🌟 新增：自动检测函数
  const performAutoDetect = useCallback(async () => {
    if (!imageUrl) return;

    setLogInfo('🔍 自动检测中...');

    try {
      // 将调试台参数转换为检测参数
      const detectionParams: Partial<DetectionParams> = {
        gridStartY: params.gridStartY,
        scanLineX: params.scanLineX,
        scanStartY: params.scanStartY,
        colorTolerance: params.colorTolerance,
        sustainedPixels: params.sustainedPixels,
        colorToleranceX: params.colorToleranceX,
        sustainedPixelsX: params.sustainedPixelsX,
        boundsWindowHeight: params.boundsWindowHeight,
        boundsWindowWidth: params.boundsWindowWidth,
        boundsVarianceThresholdRow: params.boundsVarianceThresholdRow,
        boundsVarianceThresholdCol: params.boundsVarianceThresholdCol,
        boundsStepSize: params.boundsStepSize,
        boundsMinRowHeight: params.boundsMinRowHeight,
        boundsMinColWidth: params.boundsMinColWidth,
        forceSquareIcons: params.forceSquareIcons,
        forceSquareOffsetX: params.forceSquareOffsetX,
        forceSquareOffsetY: params.forceSquareOffsetY,
        filterEmptyIcons: params.filterEmptyIcons,
        emptyIconVarianceThreshold: params.emptyIconVarianceThreshold,
        enableImageEnhancement: params.enableImageEnhancement,  // 🌟 传递图像增强开关
      };

      // 调用检测函数
      const panels = await detectWikiImage(imageUrl, detectionParams);

      setDetectedPanels(panels);
      setSelectedPanelIndex(-1);

      // 检查是否有归一化应用
      const widthStats = getNormalizationStats(panels);
      let logMessage = `✅ 自动检测完成！共检测到 ${panels.length} 个面板\n\n`;
      
      if (widthStats.applied) {
        logMessage += `🎯 宽度归一化已应用：目标宽度 ${widthStats.targetWidth}px，影响 ${widthStats.affectedCount} 个面板\n\n`;
      }
      
      logMessage += `宽度统计：\n${panels.slice(0, 10).map((p, i) => `${i + 1}. ${p.title}: ${p.width}px`).join('\n')}`;
      if (panels.length > 10) {
        logMessage += `\n... 还有 ${panels.length - 10} 个面板`;
      }

      setLogInfo(logMessage);

      // 重新绘制 Canvas 以显示检测结果
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        drawCanvasWithDetection(img, panels);
      };
      img.src = imageUrl;

    } catch (error) {
      console.error('自动检测失败:', error);
      const errorMsg = '❌ 自动检测失败：' + (error instanceof Error ? error.message : '未知错误');
      setLogInfo(errorMsg);
    }
  }, [imageUrl, params]);

  // 🌟 新增：获取归一化统计信息
  const getNormalizationStats = (panels: DetectedPanel[]) => {
    if (panels.length === 0) return { applied: false, targetWidth: null, affectedCount: 0 };

    const widths = panels.map(p => p.width);
    const tolerance = 10;
    const widthFrequency = new Map<number, number>();

    for (const width of widths) {
      let found = false;
      for (const [baseWidth, count] of widthFrequency) {
        if (Math.abs(width - baseWidth) <= tolerance) {
          widthFrequency.set(baseWidth, count + 1);
          found = true;
          break;
        }
      }
      if (!found) {
        widthFrequency.set(width, 1);
      }
    }

    let maxCount = 0;
    let targetWidth: number | null = null;

    for (const [baseWidth, count] of widthFrequency) {
      if (count > maxCount) {
        maxCount = count;
        targetWidth = baseWidth;
      }
    }

    const threshold = Math.floor(panels.length / 2) + 1;
    const shouldNormalize = maxCount >= threshold;

    if (!shouldNormalize || targetWidth === null) {
      return { applied: false, targetWidth: null, affectedCount: 0 };
    }

    let affectedCount = 0;
    for (const panel of panels) {
      if (Math.abs(panel.width - targetWidth) <= tolerance) {
        affectedCount++;
      }
    }

    return { applied: true, targetWidth, affectedCount };
  };

  // 🌟 新增：检测面板函数
  // 🌟 手动触发检测（按钮点击）
  const handleDetect = useCallback(async () => {
    setLogInfo('🔄 手动重新检测中...');
    await performAutoDetect();
  }, [performAutoDetect]);

  // 🌟 新增：绘制 Canvas 并显示检测结果
  const drawCanvasWithDetection = (img: HTMLImageElement, panels: DetectedPanel[]) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // 设置画布尺寸
    canvas.width = img.width;
    canvas.height = img.height;

    // 绘制图片
    ctx.drawImage(img, 0, 0);

    // 绘制检测结果
    panels.forEach((panel, index) => {
      // 绘制蓝框（大panel）
      ctx.strokeStyle = 'blue';
      ctx.lineWidth = 3;
      ctx.strokeRect(panel.blueBox.x, panel.blueBox.y, panel.blueBox.width, panel.blueBox.height);

      // 绘制绿框（标题区域）
      ctx.strokeStyle = 'green';
      ctx.lineWidth = 2;
      ctx.strokeRect(panel.greenBox.x, panel.greenBox.y, panel.greenBox.width, panel.greenBox.height);

      // 绘制红框（icon区域）
      ctx.strokeStyle = 'red';
      ctx.lineWidth = 1;
      panel.redBoxes.forEach((redBox) => {
        ctx.strokeRect(redBox.x, redBox.y, redBox.width, redBox.height);
      });

      // 绘制面板标题
      ctx.fillStyle = 'yellow';
      ctx.font = '16px Arial';
      ctx.fillText(`${index + 1}. ${panel.title} (${panel.width}x${panel.height})`, panel.blueBox.x, panel.blueBox.y - 10);
    });
  };

  // 绘制 Canvas
  const drawCanvas = (img: HTMLImageElement) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // 设置画布尺寸
    canvas.width = img.width;
    canvas.height = img.height;

    // 绘制图片
    ctx.drawImage(img, 0, 0);

    // 如果有检测结果，绘制检测结果
    if (detectedPanels.length > 0) {
      drawCanvasWithDetection(img, detectedPanels);
    }

    setLogInfo('图片已加载，点击"开始检测"按钮进行检测');
  };

  // 参数更新处理
  const handleParamChange = (key: keyof DebugPanelParams, value: any) => {
    const newParams = { ...params, [key]: value };
    setParams(newParams);

    // 保存到 LocalStorage
    try {
      localStorage.setItem('wiki_slice_config', JSON.stringify(newParams));
    } catch (e) {
      console.warn('无法保存参数到 LocalStorage');
    }
  };

  // 导出工作台
  const handleExport = () => {
    if (detectedPanels.length === 0) {
      alert('请先检测面板！');
      return;
    }
    onExport(detectedPanels);
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="w-screen h-screen max-w-none max-h-none p-0 fixed top-[50%] left-[50%] -translate-x-1/2 -translate-y-1/2 rounded-none">
        <div className="flex flex-col h-full bg-white dark:bg-slate-950">
          {/* 标题栏 */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800">
            <DialogTitle className="text-xl font-semibold">调试台 - 工作台模式</DialogTitle>
            <div className="flex gap-2">
              <Button onClick={handleDetect} size="sm" className="bg-blue-600 hover:bg-blue-700">
                <Search className="w-4 h-4 mr-1" />
                重新检测
              </Button>
              <Button onClick={handleExport} size="sm" className="bg-green-600 hover:bg-green-700">
                导出工作台
              </Button>
              <Button onClick={onClose} size="sm" variant="outline">
                <X className="w-4 h-4" />
              </Button>
            </div>
          </div>

          {/* 主体内容 */}
          <div className="flex flex-1 overflow-hidden gap-0">
            {/* 左侧：Canvas 区域 - 可滚动，不缩放，居中显示 */}
            <div className="flex-1 bg-gray-100 dark:bg-gray-900 overflow-auto flex items-center justify-center p-8 relative">
              <canvas
                ref={canvasRef}
                className="shadow-lg bg-white"
              />
            </div>

          {/* 右侧：控制面板 */}
          <div className="w-96 flex flex-col border-l border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950">
            {/* 日志信息 */}
            <div className="border-b border-slate-200 dark:border-slate-800">
              <div className="px-4 py-3">
                <h3 className="text-sm font-semibold">日志信息</h3>
              </div>
              <div className="px-4 pb-4">
                <ScrollArea className="h-32 w-full rounded border p-2">
                  <pre className="text-xs">{logInfo}</pre>
                </ScrollArea>
              </div>
            </div>

            {/* 检测到的面板 */}
            <div className="border-b border-slate-200 dark:border-slate-800 flex-1 overflow-hidden flex flex-col">
              <div className="px-4 py-3 flex-shrink-0">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold">检测结果</h3>
                  <span className="text-xs text-slate-500">
                    检测到 {detectedPanels.length} 个面板
                  </span>
                </div>
              </div>
              <div className="px-4 pb-4 flex-1 overflow-hidden">
                <ScrollArea className="h-full w-full">
                  {detectedPanels.map((panel, index) => (
                    <div
                      key={index}
                      className={`p-2 mb-2 rounded border cursor-pointer hover:bg-blue-50 dark:hover:bg-blue-950 ${
                        selectedPanelIndex === index ? 'bg-blue-100 dark:bg-blue-900 border-blue-500' : ''
                      }`}
                      onClick={() => setSelectedPanelIndex(index)}
                    >
                      <div className="text-sm font-semibold">{panel.title}</div>
                      <div className="text-xs text-gray-500">
                        {panel.rows}行 × {panel.cols}列
                        {panel.total && ` (${panel.total}个图标)`}
                      </div>
                    </div>
                  ))}
                </ScrollArea>
              </div>
            </div>

            {/* 参数控制 */}
            <div className="flex-shrink-0">
              <div className="px-4 py-3">
                <h3 className="text-sm font-semibold">参数控制</h3>
              </div>
              <div className="px-4 pb-4">
                <ScrollArea className="h-64 w-full pr-4">
                  <div className="space-y-4">
                    {/* 偏移校准 */}
                    <div className="space-y-2">
                      <Label className="text-xs font-semibold">偏移校准</Label>
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <Label className="text-xs w-24">X轴偏移</Label>
                          <Input
                            type="number"
                            value={params.forceSquareOffsetX}
                            onChange={(e) => handleParamChange('forceSquareOffsetX', parseInt(e.target.value))}
                            className="h-8 text-xs"
                          />
                        </div>
                        <div className="flex items-center gap-2">
                          <Label className="text-xs w-24">Y轴偏移</Label>
                          <Input
                            type="number"
                            value={params.forceSquareOffsetY}
                            onChange={(e) => handleParamChange('forceSquareOffsetY', parseInt(e.target.value))}
                            className="h-8 text-xs"
                          />
                        </div>
                      </div>
                    </div>

                    {/* 边界检测 */}
                    <div className="space-y-2">
                      <Label className="text-xs font-semibold">边界检测</Label>
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <Label className="text-xs w-24">行检测阈值</Label>
                          <Slider
                            value={[params.boundsVarianceThresholdRow]}
                            onValueChange={([value]) => handleParamChange('boundsVarianceThresholdRow', value)}
                            min={10}
                            max={100}
                            step={5}
                            className="flex-1"
                          />
                          <span className="text-xs w-8 text-right">{params.boundsVarianceThresholdRow}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Label className="text-xs w-24">列检测阈值</Label>
                          <Slider
                            value={[params.boundsVarianceThresholdCol]}
                            onValueChange={([value]) => handleParamChange('boundsVarianceThresholdCol', value)}
                            min={10}
                            max={100}
                            step={5}
                            className="flex-1"
                          />
                          <span className="text-xs w-8 text-right">{params.boundsVarianceThresholdCol}</span>
                        </div>
                      </div>
                    </div>

                    {/* 空图标过滤 */}
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        id="filterEmptyIcons"
                        checked={params.filterEmptyIcons}
                        onChange={(e) => handleParamChange('filterEmptyIcons', e.target.checked)}
                      />
                      <Label htmlFor="filterEmptyIcons" className="text-xs">过滤空图标</Label>
                    </div>

                    {/* 🌟 图像增强 */}
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        id="enableImageEnhancement"
                        checked={params.enableImageEnhancement}
                        onChange={(e) => handleParamChange('enableImageEnhancement', e.target.checked)}
                      />
                      <Label htmlFor="enableImageEnhancement" className="text-xs">图像增强（边缘+对比度）</Label>
                    </div>
                  </div>
                </ScrollArea>
              </div>
            </div>
          </div>
        </div>
      </div>
      </DialogContent>
    </Dialog>
  );
}
