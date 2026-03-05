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

  // 调试参数
  const [params, setParams] = useState({
    panelLeftOffset: 0,
    panelTopOffset: 0,
    gridStartX: 30,
    gridStartY: 60,
    iconSize: 130,
    gapX: 15,
    gapY: 15,
  });

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
  const handleParamChange = (key: string, value: number) => {
    setParams(prev => ({ ...prev, [key]: value }));
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
              <CardContent className="space-y-4">
                <div>
                  <Label>Panel Left Offset: {params.panelLeftOffset}</Label>
                  <Slider
                    value={[params.panelLeftOffset]}
                    onValueChange={([v]) => handleParamChange('panelLeftOffset', v)}
                    min={-50}
                    max={50}
                    step={1}
                  />
                </div>

                <div>
                  <Label>Panel Top Offset: {params.panelTopOffset}</Label>
                  <Slider
                    value={[params.panelTopOffset]}
                    onValueChange={([v]) => handleParamChange('panelTopOffset', v)}
                    min={-50}
                    max={50}
                    step={1}
                  />
                </div>

                <div>
                  <Label>Grid Start X: {params.gridStartX}</Label>
                  <Slider
                    value={[params.gridStartX]}
                    onValueChange={([v]) => handleParamChange('gridStartX', v)}
                    min={0}
                    max={200}
                    step={1}
                  />
                </div>

                <div>
                  <Label>Grid Start Y: {params.gridStartY}</Label>
                  <Slider
                    value={[params.gridStartY]}
                    onValueChange={([v]) => handleParamChange('gridStartY', v)}
                    min={0}
                    max={200}
                    step={1}
                  />
                </div>

                <div>
                  <Label>Icon Size: {params.iconSize}</Label>
                  <Slider
                    value={[params.iconSize]}
                    onValueChange={([v]) => handleParamChange('iconSize', v)}
                    min={50}
                    max={200}
                    step={1}
                  />
                </div>

                <div>
                  <Label>Gap X: {params.gapX}</Label>
                  <Slider
                    value={[params.gapX]}
                    onValueChange={([v]) => handleParamChange('gapX', v)}
                    min={0}
                    max={50}
                    step={1}
                  />
                </div>

                <div>
                  <Label>Gap Y: {params.gapY}</Label>
                  <Slider
                    value={[params.gapY]}
                    onValueChange={([v]) => handleParamChange('gapY', v)}
                    min={0}
                    max={50}
                    step={1}
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
