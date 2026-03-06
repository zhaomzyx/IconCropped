'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { X, Download, Save, Upload, Info } from 'lucide-react';

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
  forceSquareOffsetY: 2,
  filterEmptyIcons: true,
  emptyIconVarianceThreshold: 20,
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

  // 加载图片并检测
  useEffect(() => {
    if (!isOpen || !imageUrl) return;

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      drawCanvas(img);
    };
    img.src = imageUrl;
  }, [isOpen, imageUrl, params]);

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

    // 这里可以添加检测逻辑，暂时留空
    setLogInfo('图片已加载，请调整参数后点击"检测"按钮');
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
      <DialogContent className="max-w-7xl max-h-[90vh] overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between">
            <span>调试台 - 工作台模式</span>
            <div className="flex gap-2">
              <Button onClick={handleExport} size="sm" className="bg-green-600 hover:bg-green-700">
                导出工作台
              </Button>
              <Button onClick={onClose} size="sm" variant="outline">
                <X className="w-4 h-4" />
              </Button>
            </div>
          </DialogTitle>
        </DialogHeader>

        <div className="flex h-[calc(90vh-80px)] gap-4">
          {/* 左侧：Canvas 区域 */}
          <div className="flex-1 bg-gray-100 dark:bg-gray-900 rounded-lg overflow-hidden relative">
            <canvas
              ref={canvasRef}
              className="max-w-full max-h-full object-contain"
            />
          </div>

          {/* 右侧：控制面板 */}
          <div className="w-96 flex flex-col gap-4">
            {/* 日志信息 */}
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">日志信息</CardTitle>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-32 w-full rounded border p-2">
                  <pre className="text-xs">{logInfo}</pre>
                </ScrollArea>
              </CardContent>
            </Card>

            {/* 检测到的面板 */}
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">检测结果</CardTitle>
                <CardDescription className="text-xs">
                  检测到 {detectedPanels.length} 个面板
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-48 w-full">
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
              </CardContent>
            </Card>

            {/* 参数控制 */}
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">参数控制</CardTitle>
              </CardHeader>
              <CardContent>
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
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
