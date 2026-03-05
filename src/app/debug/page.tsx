'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface DebugPanel {
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rows: number;
  cols: number;
  total?: number; // 实际图标总数
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

export default function WikiDebugPage() {
  const [imageUrl, setImageUrl] = useState<string>('');
  const [debugPanels, setDebugPanels] = useState<DebugPanel[]>([]);
  const [selectedPanelIndex, setSelectedPanelIndex] = useState<number>(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 默认参数常量
  const DEFAULT_PARAMS = {
    panelLeftOffset: 0,
    panelTopOffset: 0,
    gridStartX: 30,
    gridStartY: 60,
    iconSize: 130,
    gapX: 15,
    gapY: 15,
    scanLineX: 20,         // 扫描线 X 坐标
    colorTolerance: 15,    // 颜色容差值
  };

  // LocalStorage 键名
  const STORAGE_KEY = 'wiki_slice_config';

  // 从 LocalStorage 加载参数
  const loadParamsFromStorage = useCallback((): typeof DEFAULT_PARAMS => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        return { ...DEFAULT_PARAMS, ...parsed };
      }
    } catch (error) {
      console.error('Failed to load params from localStorage:', error);
    }
    return DEFAULT_PARAMS;
  }, []);

  // 保存参数到 LocalStorage
  const saveParamsToStorage = useCallback((params: typeof DEFAULT_PARAMS) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(params));
    } catch (error) {
      console.error('Failed to save params to localStorage:', error);
    }
  }, []);

  // 调试参数
  const [params, setParams] = useState<typeof DEFAULT_PARAMS>(() => loadParamsFromStorage());

  // 计算图标位置（支持 total 限制）
  const calculateIconPositions = useCallback((
    panel: DebugPanel,
    panelY: number
  ): IconPosition[] => {
    const { width, rows, cols, total } = panel;
    const { gridStartX, gridStartY, iconSize, gapX, gapY, panelLeftOffset } = params;

    const startX = panel.x + panelLeftOffset + gridStartX;
    const startY = panelY + gridStartY;

    const positions: IconPosition[] = [];
    let count = 0;
    const maxCount = total ?? (rows * cols); // 如果没有 total，则使用 rows * cols

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        // 检查是否超过总数
        if (count >= maxCount) {
          break;
        }

        positions.push({
          x: Math.round(startX + col * (iconSize + gapX)),
          y: Math.round(startY + row * (iconSize + gapY)),
          width: iconSize,
          height: iconSize,
          row,
          col,
        });

        count++;
      }
      // 外层循环也需要检查，避免不必要的行
      if (count >= maxCount) {
        break;
      }
    }

    return positions;
  }, [params]);

  // 计算颜色差异
  const colorDiff = (color1: [number, number, number], color2: [number, number, number]): number => {
    return Math.max(
      Math.abs(color1[0] - color2[0]),
      Math.abs(color1[1] - color2[1]),
      Math.abs(color1[2] - color2[2])
    );
  };

  // 垂直像素扫描，找出所有面板的起始 Y 坐标
  const scanVerticalLine = useCallback((
    imageData: ImageData,
    scanLineX: number,
    colorTolerance: number,
    width: number,
    height: number
  ): number[] => {
    const { data } = imageData;
    const panelStartYs: number[] = [];

    // 边界检查
    if (scanLineX < 0 || scanLineX >= width) {
      console.warn(`Scan line X (${scanLineX}) is out of image bounds (${width})`);
      return panelStartYs;
    }

    // 获取主背景色（从顶部开始）
    const getPixelColor = (x: number, y: number): [number, number, number] => {
      const index = (y * width + x) * 4;
      return [data[index], data[index + 1], data[index + 2]];
    };

    const backgroundColor = getPixelColor(scanLineX, 0);

    // 从 Y=0 扫描到底部
    let inPanel = false;
    for (let y = 0; y < height; y++) {
      const currentColor = getPixelColor(scanLineX, y);
      const diff = colorDiff(currentColor, backgroundColor);

      // 检测是否进入或离开面板
      if (!inPanel && diff > colorTolerance) {
        // 进入面板，记录起始 Y
        panelStartYs.push(y);
        inPanel = true;
      } else if (inPanel && diff <= colorTolerance) {
        // 离开面板
        inPanel = false;
      }
    }

    console.log(`Scanned ${panelStartYs.length} panel start positions:`, panelStartYs);
    return panelStartYs;
  }, []);

  // 绘制Canvas（使用绝对定位）
  const drawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !imageUrl) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const img = new Image();
    img.onload = () => {
      // 设置Canvas大小
      canvas.width = img.width;
      canvas.height = img.height;

      // 绘制原图
      ctx.drawImage(img, 0, 0);

      // 获取像素数据用于扫描
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

      // 垂直扫描找出所有面板的起始 Y 坐标
      const panelStartYs = scanVerticalLine(
        imageData,
        params.scanLineX,
        params.colorTolerance,
        canvas.width,
        canvas.height
      );

      // 遍历所有面板，使用扫描到的绝对坐标
      for (let i = 0; i < debugPanels.length; i++) {
        const panel = debugPanels[i];
        const isSelected = i === selectedPanelIndex;

        // 使用扫描到的绝对坐标
        const absolutePanelY = panelStartYs[i] ?? (params.panelTopOffset + i * 200); // 备用方案

        const panelX = panel.x + params.panelLeftOffset;
        const panelY = absolutePanelY;

        // 计算图标区域的实际高度（基于实际使用的行数）
        const positions = calculateIconPositions(panel, panelY);
        const usedRows = positions.length > 0
          ? Math.ceil(positions[positions.length - 1].row + 1)
          : 1;
        const iconAreaHeight = usedRows * params.iconSize + (usedRows - 1) * params.gapY;

        // 计算当前大框的实际总高度
        const currentPanelHeight = params.gridStartY + iconAreaHeight;

        // 绘制蓝色框（Panel外边缘）
        ctx.strokeStyle = isSelected ? '#3B82F6' : '#93C5FD'; // 选中时深蓝，未选中时浅蓝
        ctx.lineWidth = isSelected ? 3 : 2;
        ctx.strokeRect(panelX, panelY, panel.width, currentPanelHeight);

        // 绘制绿色框（标题区域）
        ctx.strokeStyle = '#22C55E';
        ctx.lineWidth = 2;
        ctx.strokeRect(panelX, panelY, panel.width, params.gridStartY);

        // 绘制红色框（图标位置）
        positions.forEach((pos, index) => {
          ctx.strokeStyle = '#EF4444';
          ctx.lineWidth = 2;
          ctx.strokeRect(pos.x, pos.y, pos.width, pos.height);

          // 绘制序号
          ctx.fillStyle = '#EF4444';
          ctx.font = '12px Arial';
          ctx.fillText(`#${index + 1}`, pos.x + 3, pos.y + 15);
        });

        // 绘制扫描线（用于调试）
        if (isSelected) {
          ctx.strokeStyle = '#FFA500'; // 橙色扫描线
          ctx.lineWidth = 1;
          ctx.setLineDash([5, 5]);
          ctx.beginPath();
          ctx.moveTo(params.scanLineX, 0);
          ctx.lineTo(params.scanLineX, canvas.height);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }
    };
    img.src = imageUrl;
  }, [imageUrl, debugPanels, selectedPanelIndex, params, calculateIconPositions, scanVerticalLine]);

  // 重新绘制Canvas
  useEffect(() => {
    drawCanvas();
  }, [drawCanvas]);

  // 处理图片上传
  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('file', file);
    formData.append('folder', 'wiki');

    setIsProcessing(true);

    try {
      // 上传图片
      const uploadRes = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });
      const uploadData = await uploadRes.json();

      if (uploadData.success) {
        const uploadedFilename = uploadData.filename;

        console.log('Uploaded filename:', uploadedFilename);

        // 调试模式处理
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

        console.log('Process response status:', processRes.status);

        if (!processRes.ok) {
          const errorText = await processRes.text();
          console.error('Process API error:', errorText);
          throw new Error(`处理失败: ${processRes.status} - ${errorText}`);
        }

        const reader = processRes.body?.getReader();
        if (!reader) throw new Error('No reader');

        const decoder = new TextDecoder();

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value);
          const lines = chunk.split('\n');

          for (const line of lines) {
            if (line.startsWith('event:')) {
              const event = line.slice(6).trim();
              const nextLine = lines[lines.indexOf(line) + 1];
              if (nextLine?.startsWith('data:')) {
                try {
                  const data = JSON.parse(nextLine.slice(5));

                  if (event === 'debug_complete') {
                    setDebugPanels(data.debugPanels);
                    // 设置图片URL - 使用正确的API路由
                    setImageUrl(`/api/uploads/wiki/${uploadedFilename}`);
                  }
                } catch (e) {
                  console.error('Failed to parse SSE data:', e);
                }
              }
            }
          }
        }
      }
    } catch (error) {
      console.error('Failed to process image:', error);
      const errorMessage = error instanceof Error ? error.message : '未知错误';
      alert(`处理失败：${errorMessage}\n\n请检查浏览器控制台获取详细信息。`);
    } finally {
      setIsProcessing(false);
    }
  };

  // 调试参数变更处理
  const handleParamChange = (key: keyof typeof DEFAULT_PARAMS, value: number) => {
    const newParams = { ...params, [key]: value };
    setParams(newParams);
    // 实时保存到 localStorage
    saveParamsToStorage(newParams);
  };

  // 恢复默认值
  const handleResetToDefault = () => {
    if (window.confirm('确定要恢复所有参数为默认值吗？')) {
      setParams(DEFAULT_PARAMS);
      // 清除 localStorage
      localStorage.removeItem(STORAGE_KEY);
    }
  };

  // 导出配置
  const handleExportConfig = () => {
    const config = {
      version: '1.0',
      timestamp: new Date().toISOString(),
      params: params,
    };

    const jsonStr = JSON.stringify(config, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.href = url;
    link.download = 'slice_config.json';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // 导入配置
  const handleImportConfig = () => {
    fileInputRef.current?.click();
  };

  // 处理文件选择
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const content = event.target?.result as string;
        const parsed = JSON.parse(content);

        // 检查是否是有效的配置文件
        if (parsed.params && typeof parsed.params === 'object') {
          const newParams = { ...DEFAULT_PARAMS, ...parsed.params };
          setParams(newParams);
          // 保存到 localStorage
          saveParamsToStorage(newParams);
          alert('配置导入成功！');
        } else {
          throw new Error('配置格式无效');
        }
      } catch (error) {
        console.error('Failed to import config:', error);
        alert('导入失败：配置文件格式无效');
      }
      // 清空 input，允许重复选择同一文件
      e.target.value = '';
    };
    reader.readAsText(file);
  };

  return (
    <div className="container mx-auto p-6">
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Wiki裁切调试工具</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-4 items-center">
            <Input
              type="file"
              accept="image/*"
              onChange={handleImageUpload}
              disabled={isProcessing}
              className="max-w-md"
            />
            {isProcessing && <span>处理中...</span>}
          </div>
        </CardContent>
      </Card>

      {imageUrl && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Canvas区域 */}
          <div className="lg:col-span-2">
            <Card>
              <CardHeader>
                <CardTitle>调试视图</CardTitle>
              </CardHeader>
              <CardContent>
                <canvas
                  ref={canvasRef}
                  className="border border-gray-300 w-full"
                  style={{ maxWidth: '100%', height: 'auto' }}
                />
              </CardContent>
            </Card>
          </div>

          {/* 参数控制区域 */}
          <div>
            <Card className="mb-4">
              <CardHeader>
                <CardTitle>Panel选择</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {debugPanels.map((panel, idx) => (
                    <Button
                      key={idx}
                      variant={selectedPanelIndex === idx ? 'default' : 'outline'}
                      onClick={() => setSelectedPanelIndex(idx)}
                      className="w-full"
                    >
                      {panel.title} ({panel.rows}x{panel.cols})
                    </Button>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>调试参数</CardTitle>
              </CardHeader>
              <CardContent className="space-y-5">
                <div>
                  <Label className="text-sm font-medium">大框 X 起点 (Left Offset)</Label>
                  <div className="flex items-center gap-3 mt-2">
                    <Slider
                      value={[params.panelLeftOffset]}
                      onValueChange={([v]) => handleParamChange('panelLeftOffset', v)}
                      min={-200}
                      max={2000}
                      step={1}
                      className="flex-1"
                    />
                    <Input
                      type="number"
                      value={params.panelLeftOffset}
                      onChange={(e) => handleParamChange('panelLeftOffset', parseInt(e.target.value) || 0)}
                      className="w-20 text-center"
                    />
                  </div>
                </div>

                <div>
                  <Label className="text-sm font-medium">大框 Y 起点 (Top Offset)</Label>
                  <div className="flex items-center gap-3 mt-2">
                    <Slider
                      value={[params.panelTopOffset]}
                      onValueChange={([v]) => handleParamChange('panelTopOffset', v)}
                      min={-200}
                      max={2000}
                      step={1}
                      className="flex-1"
                    />
                    <Input
                      type="number"
                      value={params.panelTopOffset}
                      onChange={(e) => handleParamChange('panelTopOffset', parseInt(e.target.value) || 0)}
                      className="w-20 text-center"
                    />
                  </div>
                </div>

                <div>
                  <Label className="text-sm font-medium">首个图标左边距 (Grid Start X)</Label>
                  <div className="flex items-center gap-3 mt-2">
                    <Slider
                      value={[params.gridStartX]}
                      onValueChange={([v]) => handleParamChange('gridStartX', v)}
                      min={-200}
                      max={2000}
                      step={1}
                      className="flex-1"
                    />
                    <Input
                      type="number"
                      value={params.gridStartX}
                      onChange={(e) => handleParamChange('gridStartX', parseInt(e.target.value) || 0)}
                      className="w-20 text-center"
                    />
                  </div>
                </div>

                <div>
                  <Label className="text-sm font-medium">首个图标上边距 (Grid Start Y)</Label>
                  <div className="flex items-center gap-3 mt-2">
                    <Slider
                      value={[params.gridStartY]}
                      onValueChange={([v]) => handleParamChange('gridStartY', v)}
                      min={-200}
                      max={2000}
                      step={1}
                      className="flex-1"
                    />
                    <Input
                      type="number"
                      value={params.gridStartY}
                      onChange={(e) => handleParamChange('gridStartY', parseInt(e.target.value) || 0)}
                      className="w-20 text-center"
                    />
                  </div>
                </div>

                <div>
                  <Label className="text-sm font-medium">图标边长尺寸 (Icon Size)</Label>
                  <div className="flex items-center gap-3 mt-2">
                    <Slider
                      value={[params.iconSize]}
                      onValueChange={([v]) => handleParamChange('iconSize', v)}
                      min={10}
                      max={500}
                      step={1}
                      className="flex-1"
                    />
                    <Input
                      type="number"
                      value={params.iconSize}
                      onChange={(e) => handleParamChange('iconSize', parseInt(e.target.value) || 0)}
                      className="w-20 text-center"
                    />
                  </div>
                </div>

                <div>
                  <Label className="text-sm font-medium">横向间距 (Gap X)</Label>
                  <div className="flex items-center gap-3 mt-2">
                    <Slider
                      value={[params.gapX]}
                      onValueChange={([v]) => handleParamChange('gapX', v)}
                      min={0}
                      max={500}
                      step={1}
                      className="flex-1"
                    />
                    <Input
                      type="number"
                      value={params.gapX}
                      onChange={(e) => handleParamChange('gapX', parseInt(e.target.value) || 0)}
                      className="w-20 text-center"
                    />
                  </div>
                </div>

                <div>
                  <Label className="text-sm font-medium">纵向间距 (Gap Y)</Label>
                  <div className="flex items-center gap-3 mt-2">
                    <Slider
                      value={[params.gapY]}
                      onValueChange={([v]) => handleParamChange('gapY', v)}
                      min={0}
                      max={500}
                      step={1}
                      className="flex-1"
                    />
                    <Input
                      type="number"
                      value={params.gapY}
                      onChange={(e) => handleParamChange('gapY', parseInt(e.target.value) || 0)}
                      className="w-20 text-center"
                    />
                  </div>
                </div>

                <div>
                  <Label className="text-sm font-medium">扫描线 X 坐标 (Scan Line X)</Label>
                  <div className="flex items-center gap-3 mt-2">
                    <Slider
                      value={[params.scanLineX]}
                      onValueChange={([v]) => handleParamChange('scanLineX', v)}
                      min={0}
                      max={100}
                      step={1}
                      className="flex-1"
                    />
                    <Input
                      type="number"
                      value={params.scanLineX}
                      onChange={(e) => handleParamChange('scanLineX', parseInt(e.target.value) || 0)}
                      className="w-20 text-center"
                    />
                  </div>
                </div>

                <div>
                  <Label className="text-sm font-medium">颜色容差值 (Color Tolerance)</Label>
                  <div className="flex items-center gap-3 mt-2">
                    <Slider
                      value={[params.colorTolerance]}
                      onValueChange={([v]) => handleParamChange('colorTolerance', v)}
                      min={5}
                      max={50}
                      step={1}
                      className="flex-1"
                    />
                    <Input
                      type="number"
                      value={params.colorTolerance}
                      onChange={(e) => handleParamChange('colorTolerance', parseInt(e.target.value) || 0)}
                      className="w-20 text-center"
                    />
                  </div>
                </div>

                {/* 预设管理 */}
                <div className="pt-4 border-t">
                  <Label className="text-sm font-semibold mb-3 block">预设管理</Label>
                  <div className="flex gap-2 flex-wrap">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleResetToDefault}
                      className="flex-1 min-w-[120px]"
                    >
                      恢复默认值
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleExportConfig}
                      className="flex-1 min-w-[120px]"
                    >
                      导出配置 (JSON)
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleImportConfig}
                      className="flex-1 min-w-[120px]"
                    >
                      导入配置
                    </Button>
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".json"
                    onChange={handleFileSelect}
                    className="hidden"
                  />
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* 图例说明 */}
      {imageUrl && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>图例说明</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex gap-6 text-sm flex-wrap">
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 border-2 border-blue-500" />
                <span>蓝色框：Panel外边缘</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 border-2 border-green-500" />
                <span>绿色框：顶部标题区域</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 border-2 border-red-500" />
                <span>红色框：图标裁切区域</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 border-2 border-orange-500 border-dashed" />
                <span>橙色虚线：扫描线</span>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
