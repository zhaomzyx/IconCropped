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

  // 计算图标位置
  const calculateIconPositions = useCallback((panel: DebugPanel): IconPosition[] => {
    const { x, y, width, height, rows, cols } = panel;
    const { gridStartX, gridStartY, iconSize, gapX, gapY } = params;

    const startX = x + params.panelLeftOffset + gridStartX;
    const startY = y + params.panelTopOffset + gridStartY;

    const positions: IconPosition[] = [];

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        positions.push({
          x: Math.round(startX + col * (iconSize + gapX)),
          y: Math.round(startY + row * (iconSize + gapY)),
          width: iconSize,
          height: iconSize,
          row,
          col,
        });
      }
    }

    return positions;
  }, [params]);

  // 绘制Canvas
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

      // 绘制Panel边框（蓝色）
      const selectedPanel = debugPanels[selectedPanelIndex];
      if (selectedPanel) {
        const { x, y, width, height } = selectedPanel;
        const panelX = x + params.panelLeftOffset;
        const panelY = y + params.panelTopOffset;

        // 蓝色框：Panel外边缘
        ctx.strokeStyle = '#3B82F6';
        ctx.lineWidth = 3;
        ctx.strokeRect(panelX, panelY, width, height);

        // 绿色框：顶部标题区域
        ctx.strokeStyle = '#22C55E';
        ctx.strokeRect(panelX, panelY, width, params.gridStartY);

        // 红色框：每个图标位置
        const positions = calculateIconPositions(selectedPanel);
        positions.forEach((pos) => {
          ctx.strokeStyle = '#EF4444';
          ctx.lineWidth = 2;
          ctx.strokeRect(pos.x, pos.y, pos.width, pos.height);

          // 绘制序号
          ctx.fillStyle = '#EF4444';
          ctx.font = '14px Arial';
          ctx.fillText(`${pos.row},${pos.col}`, pos.x + 5, pos.y + 20);
        });
      }
    };
    img.src = imageUrl;
  }, [imageUrl, debugPanels, selectedPanelIndex, params, calculateIconPositions]);

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
            <div className="flex gap-6 text-sm">
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
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
