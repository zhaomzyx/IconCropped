'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  detectRowsBySlidingWindow,
  detectColumnsBySlidingWindow,
  detectIconPositionsBySlidingWindow,
  detectAllBounds,
  calculateIconPositionsFromBounds,
  normalizePanelWidths
} from '@/lib/sliding-window-detection';

interface DebugPanel {
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rows: number;
  cols: number;
  total?: number;
  imageUrl: string;
}

interface IconPosition {
  x: number;
  y: number;
  width: number;
  height: number;
  row: number;
  col: number;
}

interface DetectedPanel {
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
  blueBox: { x: number; y: number; width: number; height: number };
  greenBox: { x: number; y: number; width: number; height: number };
  redBoxes: Array<{ x: number; y: number; width: number; height: number }>;
  originalWidth?: number;
}

const STORAGE_KEY = 'wiki-debug-params';

const DEFAULT_PARAMS = {
  gridStartY: 107,
  scanLineX: 49,
  scanStartY: 200,
  colorTolerance: 30,
  sustainedPixels: 5,
  colorToleranceX: 30,
  sustainedPixelsX: 5,
  iconLineOffset: 107,
  iconLineGap: 144,
  minIconsPerLine: 5,
  slidingWindowRows: 20,
  slidingWindowCols: 20,
  slidingWindowDiffThreshold: 30,
  slidingWindowStepSize: 5,
  slidingWindowMinGap: 50,
  forceSquareIcons: true,
  forceSquareOffsetX: 0,
  forceSquareOffsetY: 2,
  enableBoundsDetection: true,
  boundsVarianceThresholdRow: 1000,
  boundsVarianceThresholdCol: 1000,
  boundsStepSize: 5,
  boundsMinRowHeight: 20,
  boundsMinColWidth: 20,
  enableEmptyIconFilter: true,
  emptyIconVarianceThreshold: 20,
};

export default function WikiDebugPage() {
  const [imageUrl, setImageUrl] = useState<string>('');
  const [debugPanels, setDebugPanels] = useState<DebugPanel[]>([]);
  const [selectedPanelIndex, setSelectedPanelIndex] = useState<number>(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [cropResults, setCropResults] = useState<any[]>([]);
  const [debugLogs, setDebugLogs] = useState<string[]>([]);
  const [detectedPanels, setDetectedPanels] = useState<DetectedPanel[]>([]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [params, setParams] = useState(DEFAULT_PARAMS);
  const [scanVerticalLine, setScanVerticalLine] = useState(DEFAULT_PARAMS.scanLineX);
  const [scanHorizontalLine, setScanHorizontalLine] = useState(DEFAULT_PARAMS.scanStartY);

  const logInfo = useCallback((...args: any[]) => {
    const message = args.map(arg => {
      try {
        return typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg);
      } catch (e) {
        return String(arg);
      }
    }).join(' ');
    console.log(...args);
    setDebugLogs(prev => [...prev, message]);
  }, []);

  const loadParamsFromStorage = useCallback(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        setParams(parsed);
        setScanVerticalLine(parsed.scanLineX || DEFAULT_PARAMS.scanLineX);
        setScanHorizontalLine(parsed.scanStartY || DEFAULT_PARAMS.scanStartY);
      }
    } catch (e) {
      console.error('Failed to load params from localStorage:', e);
    }
  }, []);

  const saveParamsToStorage = useCallback((newParams: typeof DEFAULT_PARAMS) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newParams));
    } catch (e) {
      console.error('Failed to save params to localStorage:', e);
    }
  }, []);

  useEffect(() => {
    loadParamsFromStorage();
  }, [loadParamsFromStorage]);

  const handleParamChange = (key: keyof typeof DEFAULT_PARAMS, value: number | boolean) => {
    const newParams = { ...params, [key]: value };
    setParams(newParams);
    saveParamsToStorage(newParams);

    if (key === 'scanLineX') {
      setScanVerticalLine(value as number);
    } else if (key === 'scanStartY') {
      setScanHorizontalLine(value as number);
    }
  };

  const handleResetToDefault = () => {
    if (window.confirm('确定要恢复所有参数为默认值吗？')) {
      setParams(DEFAULT_PARAMS);
      setScanVerticalLine(DEFAULT_PARAMS.scanLineX);
      setScanHorizontalLine(DEFAULT_PARAMS.scanStartY);
      localStorage.removeItem(STORAGE_KEY);
    }
  };

  const handleResetToNewDefaults = () => {
    if (window.confirm('确定要重置为新默认值吗？')) {
      setParams(DEFAULT_PARAMS);
      setScanVerticalLine(DEFAULT_PARAMS.scanLineX);
      setScanHorizontalLine(DEFAULT_PARAMS.scanStartY);
      localStorage.removeItem(STORAGE_KEY);
      saveParamsToStorage(DEFAULT_PARAMS);
      alert('已重置为新默认值！');
    }
  };

  const handleExportConfig = () => {
    const config = JSON.stringify(params, null, 2);
    const blob = new Blob([config], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'wiki-debug-config.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportConfig = () => {
    fileInputRef.current?.click();
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const config = JSON.parse(event.target?.result as string);
        setParams({ ...DEFAULT_PARAMS, ...config });
        setScanVerticalLine(config.scanLineX || DEFAULT_PARAMS.scanLineX);
        setScanHorizontalLine(config.scanStartY || DEFAULT_PARAMS.scanStartY);
        saveParamsToStorage({ ...DEFAULT_PARAMS, ...config });
        alert('配置导入成功！');
      } catch (e) {
        alert('配置导入失败：无效的 JSON 文件');
      }
    };
    reader.readAsText(file);
  };

  const handleApplyOptimizedParams = () => {
    const optimizedParams = {
      ...params,
      forceSquareOffsetX: 0,
      forceSquareOffsetY: 2,
    };
    setParams(optimizedParams);
    saveParamsToStorage(optimizedParams);
    alert('已应用优化参数！');
  };

  const copyLogs = () => {
    const logs = debugLogs.join('\n');
    navigator.clipboard.writeText(logs).then(() => {
      alert('日志已复制到剪贴板！');
    });
  };

  const clearLogs = () => {
    setDebugLogs([]);
  };

  const drawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !imageUrl) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const img = new Image();
    img.onload = () => {
      canvas.width = img.width;
      canvas.height = img.height;
      ctx.drawImage(img, 0, 0);

      // 绘制扫描线
      ctx.strokeStyle = 'orange';
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 5]);

      // 垂直扫描线
      ctx.beginPath();
      ctx.moveTo(scanVerticalLine, 0);
      ctx.lineTo(scanVerticalLine, canvas.height);
      ctx.stroke();

      // 水平扫描线
      ctx.beginPath();
      ctx.moveTo(0, scanHorizontalLine);
      ctx.lineTo(canvas.width, scanHorizontalLine);
      ctx.stroke();

      ctx.setLineDash([]);

      // 绘制检测到的面板
      detectedPanels.forEach((panel, index) => {
        const isSelected = index === selectedPanelIndex;

        // 蓝色框：Panel外边缘
        ctx.strokeStyle = isSelected ? 'blue' : 'lightblue';
        ctx.lineWidth = isSelected ? 3 : 2;
        ctx.strokeRect(
          panel.blueBox.x,
          panel.blueBox.y,
          panel.blueBox.width,
          panel.blueBox.height
        );

        // 绿色框：顶部标题区域
        ctx.strokeStyle = isSelected ? 'green' : 'lightgreen';
        ctx.strokeRect(
          panel.greenBox.x,
          panel.greenBox.y,
          panel.greenBox.width,
          panel.greenBox.height
        );

        // 红色框：图标裁切区域
        ctx.strokeStyle = isSelected ? 'red' : 'lightcoral';
        panel.redBoxes.forEach((box) => {
          ctx.strokeRect(box.x, box.y, box.width, box.height);
        });

        // 绘制坐标
        ctx.fillStyle = 'black';
        ctx.font = '12px Arial';
        ctx.fillText(
          `(${panel.blueBox.x},${panel.blueBox.y})`,
          panel.blueBox.x,
          panel.blueBox.y - 5
        );
      });
    };
    img.onerror = () => {
      console.error('图片加载失败:', imageUrl);
    };
    img.src = imageUrl;
  }, [imageUrl, detectedPanels, selectedPanelIndex, scanVerticalLine, scanHorizontalLine]);

  useEffect(() => {
    drawCanvas();
  }, [drawCanvas]);

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    logInfo('开始上传图片:', file.name, file.size, 'bytes');

    const formData = new FormData();
    formData.append('file', file);
    formData.append('type', 'wiki');

    setIsProcessing(true);

    try {
      const uploadRes = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });
      const uploadData = await uploadRes.json();

      logInfo('上传响应:', uploadData);

      if (uploadData.success) {
        const uploadedFilename = uploadData.filename;
        logInfo('上传成功，文件名:', uploadedFilename);

        logInfo('调用 /api/process-image-stream (debug模式)');
        const processRes = await fetch('/api/process-image-stream', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            filenames: [uploadedFilename],
            debug: true,
          }),
        });

        logInfo('处理响应状态:', processRes.status, processRes.statusText);

        if (!processRes.ok) {
          const errorText = await processRes.text();
          console.error('Process API error:', errorText);
          throw new Error(`处理失败: ${processRes.status} - ${errorText}`);
        }

        const reader = processRes.body?.getReader();
        if (!reader) throw new Error('No reader');

        const decoder = new TextDecoder();
        let eventCount = 0;
        let fullSSEContent = '';

        logInfo('开始读取SSE流...');

        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            logInfo('SSE流读取完成，共收到', eventCount, '个事件');
            break;
          }

          const chunk = decoder.decode(value, { stream: true });
          fullSSEContent += chunk;
        }

        logInfo('开始解析 SSE 流...');

        const lines = fullSSEContent.split('\n');
        let currentEvent = '';
        let currentData = '';
        let isReadingData = false;
        let hasDebugComplete = false;

        for (const line of lines) {
          const trimmedLine = line.trim();

          if (trimmedLine.startsWith('event:')) {
            currentEvent = trimmedLine.substring(6).trim();
            currentData = '';
            isReadingData = false;
          } else if (trimmedLine.startsWith('data:')) {
            currentData = trimmedLine.substring(5).trim();
            isReadingData = true;
          } else if (trimmedLine === '' && currentEvent && currentData) {
            try {
              const data = JSON.parse(currentData);
              eventCount++;
              logInfo(`收到事件 ${eventCount}: ${currentEvent}`, data);

              if (currentEvent === 'debug_complete') {
                hasDebugComplete = true;
                logInfo('Debug模式完成，面板数据:', data.debugPanels);
                setDebugPanels(data.debugPanels);
                setImageUrl(`/api/uploads/wiki/${uploadedFilename}`);
                logInfo('图片URL已设置:', `/api/uploads/wiki/${uploadedFilename}`);
              } else if (currentEvent === 'error') {
                console.error('收到错误事件:', data);
                logInfo('检测失败，但仍然显示图片');
                setImageUrl(`/api/uploads/wiki/${uploadedFilename}`);
                setDebugLogs(prev => [...prev, `检测失败: ${data.message || '未知错误'}`]);
              }
            } catch (e) {
              console.error(`Failed to parse SSE data for event ${currentEvent}:`, e, '原始数据:', currentData.substring(0, 100));
              throw e;
            }

            currentEvent = '';
            currentData = '';
            isReadingData = false;
          } else if (isReadingData && trimmedLine.startsWith('{')) {
            currentData += '\n' + trimmedLine;
          }
        }

        if (!hasDebugComplete) {
          logInfo('未收到 debug_complete 事件，但仍然显示图片');
          setImageUrl(`/api/uploads/wiki/${uploadedFilename}`);
        }

        if (eventCount === 0) {
          throw new Error('未收到任何SSE事件，请检查后端日志');
        }
      } else {
        throw new Error(uploadData.error || '上传失败');
      }
    } catch (error) {
      console.error('Failed to process image:', error);
      const errorMessage = error instanceof Error ? error.message : '未知错误';
      alert(`处理失败：${errorMessage}\n\n请检查浏览器控制台获取详细信息。`);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleExportToWorkbench = async () => {
    if (!debugPanels.length) {
      alert('没有可导出的面板数据');
      return;
    }

    try {
      const response = await fetch('/api/export-to-workbench', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          panels: debugPanels,
          imageUrl,
        }),
      });

      const result = await response.json();

      if (result.success) {
        alert('导出成功！');
        setCropResults(result.cropResults || []);
      } else {
        throw new Error(result.error || '导出失败');
      }
    } catch (error) {
      console.error('Failed to export to workbench:', error);
      const errorMessage = error instanceof Error ? error.message : '未知错误';
      alert(`导出失败：${errorMessage}`);
    }
  };

  return (
    <div className="container mx-auto p-4">
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Wiki 图片调试工具</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-4 mb-4">
            <Button
              onClick={() => document.getElementById('file-upload')?.click()}
              disabled={isProcessing}
            >
              {isProcessing ? '处理中...' : '上传图片'}
            </Button>
            <input
              id="file-upload"
              type="file"
              accept="image/*"
              onChange={handleImageUpload}
              className="hidden"
            />
          </div>

          {debugLogs.length > 0 && (
            <div className="mt-4">
              <Label>调试日志</Label>
              <div className="mt-2 p-4 bg-gray-50 rounded max-h-40 overflow-y-auto">
                {debugLogs.map((log, index) => (
                  <div key={index} className="text-sm mb-1">
                    {log}
                  </div>
                ))}
              </div>
              <div className="flex gap-2 mt-2">
                <Button onClick={copyLogs} variant="outline" size="sm">
                  复制日志
                </Button>
                <Button onClick={clearLogs} variant="outline" size="sm">
                  清空日志
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {imageUrl && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>图片预览</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex justify-center items-center overflow-auto">
              <canvas
                ref={canvasRef}
                className="border border-gray-300"
                style={{ maxWidth: '100%', height: 'auto' }}
              />
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>参数设置</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-6">
            {/* 扫描线参数 */}
            <div>
              <Label className="text-sm font-semibold mb-3 block">扫描线参数</Label>
              <div className="space-y-3">
                <div>
                  <Label className="text-xs font-medium">扫描线 X 坐标</Label>
                  <div className="flex items-center gap-3 mt-2">
                    <Slider
                      value={[params.scanLineX]}
                      onValueChange={([v]) => handleParamChange('scanLineX', v)}
                      min={0}
                      max={500}
                      step={1}
                      className="flex-1"
                    />
                    <Input
                      type="number"
                      value={params.scanLineX}
                      onChange={(e) => handleParamChange('scanLineX', parseInt(e.target.value) || 0)}
                      className="w-20 text-center text-sm"
                    />
                  </div>
                </div>
                <div>
                  <Label className="text-xs font-medium">扫描起始 Y 坐标</Label>
                  <div className="flex items-center gap-3 mt-2">
                    <Slider
                      value={[params.scanStartY]}
                      onValueChange={([v]) => handleParamChange('scanStartY', v)}
                      min={0}
                      max={500}
                      step={1}
                      className="flex-1"
                    />
                    <Input
                      type="number"
                      value={params.scanStartY}
                      onChange={(e) => handleParamChange('scanStartY', parseInt(e.target.value) || 0)}
                      className="w-20 text-center text-sm"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* 偏移校准参数 */}
            <div>
              <Label className="text-sm font-semibold mb-3 block">偏移校准参数</Label>
              <div className="p-3 bg-blue-50 rounded space-y-3">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <Label className="text-xs font-medium">X轴偏移</Label>
                    <span className="text-xs font-bold text-blue-700">{params.forceSquareOffsetX}px</span>
                  </div>
                  <Slider
                    value={[params.forceSquareOffsetX]}
                    onValueChange={([v]) => handleParamChange('forceSquareOffsetX', v)}
                    min={-20}
                    max={20}
                    step={1}
                    className="w-full"
                  />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <Label className="text-xs font-medium">Y轴偏移</Label>
                    <span className="text-xs font-bold text-blue-700">{params.forceSquareOffsetY}px</span>
                  </div>
                  <Slider
                    value={[params.forceSquareOffsetY]}
                    onValueChange={([v]) => handleParamChange('forceSquareOffsetY', v)}
                    min={-20}
                    max={20}
                    step={1}
                    className="w-full"
                  />
                </div>
              </div>
            </div>

            {/* 预设管理 */}
            <div>
              <Label className="text-sm font-semibold mb-3 block">预设管理</Label>
              <div className="flex gap-2 flex-wrap">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleResetToDefault}
                >
                  恢复默认值
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleResetToNewDefaults}
                  className="bg-blue-50"
                >
                  重置为新默认值
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleExportConfig}
                >
                  导出配置
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleImportConfig}
                >
                  导入配置
                </Button>
                <Button
                  variant="default"
                  size="sm"
                  onClick={handleApplyOptimizedParams}
                  className="bg-green-600 hover:bg-green-700"
                >
                  应用优化参数
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {debugPanels.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>检测结果</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div>
                <Label className="text-sm font-semibold mb-3 block">选择面板</Label>
                <div className="flex gap-2 flex-wrap">
                  {debugPanels.map((panel, index) => (
                    <Button
                      key={index}
                      variant={selectedPanelIndex === index ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setSelectedPanelIndex(index)}
                    >
                      {panel.title || `面板 ${index + 1}`}
                    </Button>
                  ))}
                </div>
              </div>

              {debugPanels[selectedPanelIndex] && (
                <div className="p-4 bg-gray-50 rounded">
                  <h3 className="font-semibold mb-2">
                    {debugPanels[selectedPanelIndex].title || `面板 ${selectedPanelIndex + 1}`}
                  </h3>
                  <div className="text-sm space-y-1">
                    <p>位置: ({debugPanels[selectedPanelIndex].x}, {debugPanels[selectedPanelIndex].y})</p>
                    <p>尺寸: {debugPanels[selectedPanelIndex].width} x {debugPanels[selectedPanelIndex].height}</p>
                    <p>网格: {debugPanels[selectedPanelIndex].rows} 行 x {debugPanels[selectedPanelIndex].cols} 列</p>
                  </div>
                </div>
              )}

              <Button
                onClick={handleExportToWorkbench}
                disabled={isProcessing || !imageUrl || debugPanels.length === 0}
                className="w-full"
              >
                {isProcessing ? '导出中...' : '导出到工作台'}
              </Button>

              {cropResults.length > 0 && (
                <div className="mt-2 text-sm text-green-600">
                  已裁切 {cropResults.length} 个图标
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
