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
  const [cropResults, setCropResults] = useState<any[]>([]); // 裁切结果
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 默认参数常量（基于用户调试优化）
  const DEFAULT_PARAMS = {
    panelLeftOffset: -28,
    panelTopOffset: 0,
    gridStartX: 69,
    gridStartY: 107,
    iconSize: 132,
    iconCenterOffsetX: 66,   // 首个图标中心点 X 偏移
    iconCenterOffsetY: 66,   // 首个图标中心点 Y 偏移
    centerGapX: 146,         // 中心点横向间距（默认 iconSize + gap）
    centerGapY: 144,         // 中心点纵向间距（默认 iconSize + gap）
    scanLineX: 86,           // 扫描线 X 坐标
    scanStartY: 200,         // 扫描起始 Y 坐标
    colorTolerance: 50,      // 颜色容差值
    sustainedPixels: 10,     // 连续判定高度（滑动窗口）
    panelWidth: 876,         // 蓝框宽度（Panel外边缘）
    greenBoxWidth: 876,      // 绿框宽度（标题区域）
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
  const [params, setParams] = useState<typeof DEFAULT_PARAMS>(() => {
    // 只在客户端加载localStorage中的参数
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
          const parsed = JSON.parse(saved);
          return { ...DEFAULT_PARAMS, ...parsed };
        }
      } catch (error) {
        console.error('Failed to load params from localStorage:', error);
      }
    }
    return DEFAULT_PARAMS;
  });

  // 计算颜色方差（用于判断是否为空图标）
  const calculateColorVariance = (imageData: ImageData, x: number, y: number, width: number, height: number): number => {
    const { data } = imageData;
    let rSum = 0, gSum = 0, bSum = 0;
    let count = 0;

    // 计算平均值
    for (let py = y; py < y + height; py++) {
      for (let px = x; px < x + width; px++) {
        if (px < 0 || py < 0 || px >= imageData.width || py >= imageData.height) continue;
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
        if (px < 0 || py < 0 || px >= imageData.width || py >= imageData.height) continue;
        const idx = (py * imageData.width + px) * 4;
        variance += Math.pow(data[idx] - rAvg, 2);
        variance += Math.pow(data[idx + 1] - gAvg, 2);
        variance += Math.pow(data[idx + 2] - bAvg, 2);
      }
    }

    return variance / (count * 3); // 返回平均方差
  };

  // 计算图标位置（支持 total 限制 + 空图标过滤）- 使用中心点定位
  const calculateIconPositions = useCallback((
    panel: DebugPanel,
    panelY: number,
    ctx: CanvasRenderingContext2D
  ): IconPosition[] => {
    const { width, rows, cols, total } = panel;
    const { gridStartX, gridStartY, iconSize, centerGapX, centerGapY, panelLeftOffset, iconCenterOffsetX, iconCenterOffsetY } = params;

    // 首个中心点坐标
    const firstCenterX = panel.x + panelLeftOffset + gridStartX + iconCenterOffsetX;
    const firstCenterY = panelY + gridStartY + iconCenterOffsetY;

    const positions: IconPosition[] = [];
    let count = 0;
    const maxCount = total ?? (rows * cols); // 如果没有 total，则使用 rows * cols
    const coreSize = 30; // 核心区域大小（正方形）
    const varianceThreshold = 100; // 方差阈值，小于此值判定为空图标

    // 获取完整的像素数据
    const imageData = ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height);

    console.log(`  开始扫描图标位置，rows=${rows}, cols=${cols}, maxCount=${maxCount}`);
    console.log(`  方差阈值: ${varianceThreshold}, 核心区域大小: ${coreSize}x${coreSize}`);
    console.log(`  首个中心点: (${firstCenterX}, ${firstCenterY}), 中心点间距: X=${centerGapX}, Y=${centerGapY}`);

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        // 检查是否超过总数
        if (count >= maxCount) {
          break;
        }

        // 计算中心点坐标
        const centerX = Math.round(firstCenterX + col * centerGapX);
        const centerY = Math.round(firstCenterY + row * centerGapY);

        // 从中心点计算左上角坐标（用于红框绘制）
        const x = centerX - Math.round(iconSize / 2);
        const y = centerY - Math.round(iconSize / 2);

        // 获取icon中心区域的像素（用于检测空图标）
        const coreX = centerX - Math.floor(coreSize / 2);
        const coreY = centerY - Math.floor(coreSize / 2);

        // 计算中心区域的颜色方差
        const variance = calculateColorVariance(imageData, coreX, coreY, coreSize, coreSize);

        const hasIcon = variance >= varianceThreshold;

        console.log(`  [${row}, ${col}] 中心点: center(${centerX}, ${centerY}), 左上角: x=${x}, y=${y}, 方差=${variance.toFixed(2)}, ${hasIcon ? '✓ 有图标' : '✗ 空图标'}`);

        if (hasIcon) {
          positions.push({
            x,  // 左上角 X
            y,  // 左上角 Y
            width: iconSize,
            height: iconSize,
            row,
            col,
          });
          count++;
        } else {
          // 遇到空图标，直接结束当前面板的扫描
          console.log(`  遇到空图标，结束面板扫描。共找到 ${positions.length} 个有效图标`);
          return positions;
        }
      }
      // 外层循环也需要检查，避免不必要的行
      if (count >= maxCount) {
        break;
      }
    }

    console.log(`  扫描完成，共找到 ${positions.length} 个有效图标`);
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

  // 垂直像素扫描（滑动窗口算法），找出所有面板的起始 Y 坐标
  const scanVerticalLine = useCallback((
    imageData: ImageData,
    scanLineX: number,
    scanStartY: number,
    colorTolerance: number,
    sustainedPixels: number,
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

    if (scanStartY < 0 || scanStartY >= height) {
      console.warn(`Scan start Y (${scanStartY}) is out of image bounds (${height})`);
      return panelStartYs;
    }

    // 获取主背景色（从起始坐标开始）
    const getPixelColor = (x: number, y: number): [number, number, number] => {
      const index = (y * width + x) * 4;
      return [data[index], data[index + 1], data[index + 2]];
    };

    const backgroundColor = getPixelColor(scanLineX, scanStartY);

    // 滑动窗口算法
    let isPanel = false;
    let consecutiveBg = 0;    // 连续背景色计数器
    let consecutivePanel = 0; // 连续面板色计数器
    const requiredPixels = sustainedPixels;

    // 从 Y=scanStartY 扫描到底部（跳过顶部杂乱区域）
    for (let y = scanStartY; y < height; y++) {
      const currentColor = getPixelColor(scanLineX, y);
      const diff = colorDiff(currentColor, backgroundColor);

      if (diff > colorTolerance) {
        // 识别为浅色面板区域
        consecutivePanel++;
        consecutiveBg = 0;

        if (!isPanel && consecutivePanel >= requiredPixels) {
          // 真正的起点是几十个像素之前突变的那个点
          const actualStartY = y - requiredPixels + 1;
          panelStartYs.push(actualStartY);
          isPanel = true;

          console.log(`Panel started at Y=${actualStartY} (detected at Y=${y})`);
        }
      } else {
        // 识别为深色背景区域
        consecutiveBg++;
        consecutivePanel = 0;

        if (isPanel && consecutiveBg >= requiredPixels) {
          // 面板结束
          isPanel = false;
          console.log(`Panel ended at Y=${y - requiredPixels + 1} (detected at Y=${y})`);
        }
      }
    }

    console.log(`Scanned ${panelStartYs.length} panel start positions from Y=${scanStartY} (sustained=${requiredPixels}):`, panelStartYs);
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

      console.log(`Canvas尺寸：实际=${img.width}x${img.height}, 显示=${canvas.clientWidth}x${canvas.clientHeight}`);
      console.log(`缩放比例：X=${canvas.clientWidth / canvas.width}, Y=${canvas.clientHeight / canvas.height}`);

      // 绘制原图
      ctx.drawImage(img, 0, 0);

      // 获取像素数据用于扫描
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

      // 垂直扫描找出所有面板的起始 Y 坐标
      const panelStartYs = scanVerticalLine(
        imageData,
        params.scanLineX,
        params.scanStartY,
        params.colorTolerance,
        params.sustainedPixels,
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
        const positions = calculateIconPositions(panel, panelY, ctx);
        const usedRows = positions.length > 0
          ? Math.ceil(positions[positions.length - 1].row + 1)
          : 1;
        // 使用中心点间距计算高度：第一个图标顶部 + (行数-1) * 中心点间距 + 图标大小
        const firstIconTop = panelY + params.gridStartY + params.iconCenterOffsetY - Math.round(params.iconSize / 2);
        const iconAreaHeight = usedRows > 0 
          ? firstIconTop + (usedRows - 1) * params.centerGapY + params.iconSize - firstIconTop
          : params.iconSize;

        // 计算当前大框的实际总高度
        const currentPanelHeight = params.gridStartY + iconAreaHeight;

        // 绘制蓝色框（Panel外边缘）
        ctx.strokeStyle = isSelected ? '#3B82F6' : '#93C5FD'; // 选中时深蓝，未选中时浅蓝
        ctx.lineWidth = isSelected ? 3 : 2;
        ctx.strokeRect(panelX, panelY, params.panelWidth, currentPanelHeight);

        // 绘制绿色框（标题区域）
        ctx.strokeStyle = '#22C55E';
        ctx.lineWidth = 2;
        ctx.strokeRect(panelX, panelY, params.greenBoxWidth, params.gridStartY);

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

      // 绘制扫描起始线（水平黄色虚线）
      ctx.strokeStyle = '#FFD700'; // 金黄色
      ctx.lineWidth = 2;
      ctx.setLineDash([8, 8]);
      ctx.beginPath();
      ctx.moveTo(0, params.scanStartY);
      ctx.lineTo(canvas.width, params.scanStartY);
      ctx.stroke();
      ctx.setLineDash([]);
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

    console.log('开始上传图片:', file.name, file.size, 'bytes');

    const formData = new FormData();
    formData.append('file', file);
    formData.append('type', 'wiki');

    setIsProcessing(true);

    try {
      // 上传图片
      console.log('步骤1: 上传图片到 /api/upload');
      const uploadRes = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });
      const uploadData = await uploadRes.json();

      console.log('上传响应:', uploadData);

      if (uploadData.success) {
        const uploadedFilename = uploadData.filename;
        console.log('✓ 上传成功，文件名:', uploadedFilename);

        // 调试模式处理
        console.log('步骤2: 调用 /api/process-image-stream (debug模式)');
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

        console.log('处理响应状态:', processRes.status, processRes.statusText);

        if (!processRes.ok) {
          const errorText = await processRes.text();
          console.error('Process API error:', errorText);
          throw new Error(`处理失败: ${processRes.status} - ${errorText}`);
        }

        const reader = processRes.body?.getReader();
        if (!reader) throw new Error('No reader');

        const decoder = new TextDecoder();
        let eventCount = 0;

        console.log('开始读取SSE流...');

        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            console.log('SSE流读取完成，共收到', eventCount, '个事件');
            break;
          }

          const chunk = decoder.decode(value);
          const lines = chunk.split('\n');

          for (const line of lines) {
            if (line.startsWith('event:')) {
              const event = line.slice(6).trim();
              const nextLine = lines[lines.indexOf(line) + 1];
              if (nextLine?.startsWith('data:')) {
                try {
                  const data = JSON.parse(nextLine.slice(5));
                  eventCount++;
                  console.log(`收到事件 ${eventCount}: ${event}`, data);

                  if (event === 'debug_complete') {
                    console.log('✓ Debug模式完成，面板数据:', data.debugPanels);
                    setDebugPanels(data.debugPanels);
                    // 设置图片URL - 使用正确的API路由
                    setImageUrl(`/api/uploads/wiki/${uploadedFilename}`);
                    console.log('✓ 图片URL已设置:', `/api/uploads/wiki/${uploadedFilename}`);
                  } else if (event === 'error') {
                    console.error('✗ 收到错误事件:', data);
                    throw new Error(data.message || '处理过程中发生错误');
                  }
                } catch (e) {
                  console.error('Failed to parse SSE data:', e, 'Line:', nextLine);
                  if (e instanceof Error && e.message !== 'Failed to parse SSE data') {
                    throw e; // 重新抛出解析错误以外的错误
                  }
                }
              }
            }
          }
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

  // 导出到工作台（裁切icon）
  const handleExportToWorkbench = async () => {
    if (!imageUrl || debugPanels.length === 0) {
      alert('请先上传图片并完成面板调试');
      return;
    }

    setIsProcessing(true);
    try {
      // 从Canvas获取面板坐标数据
      const canvas = canvasRef.current;
      if (!canvas) {
        throw new Error('Canvas not found');
      }

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        throw new Error('Canvas context not found');
      }

      // 获取像素数据
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

      // 扫描面板起始位置
      const panelStartYs = scanVerticalLine(
        imageData,
        params.scanLineX,
        params.scanStartY,
        params.colorTolerance,
        params.sustainedPixels,
        canvas.width,
        canvas.height
      );

      // 收集所有面板的坐标数据
      const exportPanels = debugPanels.map((panel, i) => {
        const absolutePanelY = panelStartYs[i] ?? (params.panelTopOffset + i * 200);
        const panelX = panel.x + params.panelLeftOffset;
        const panelY = absolutePanelY;

        // 详细日志：计算前的参数
        console.log(`\n面板 ${i + 1} (${panel.title}) 计算前的参数:`);
        console.log(`  LLM识别: x=${panel.x}, y=${panel.y}, width=${panel.width}, rows=${panel.rows}, cols=${panel.cols}`);
        console.log(`  滑动窗口: panelStartYs[${i}]=${panelStartYs[i]}`);
        console.log(`  调试参数: panelLeftOffset=${params.panelLeftOffset}, gridStartX=${params.gridStartX}, gridStartY=${params.gridStartY}`);
        console.log(`  计算后: panelX=${panelX}, panelY=${panelY}`);

        // 计算图标位置
        const positions = calculateIconPositions(panel, panelY, ctx);
        console.log(`  calculateIconPositions 返回了 ${positions.length} 个位置:`);
        positions.forEach((pos, idx) => {
          if (idx < 3 || idx === positions.length - 1) { // 只显示前3个和最后一个
            console.log(`    Icon #${idx + 1}: x=${pos.x}, y=${pos.y}, w=${pos.width}, h=${pos.height}`);
          }
        });

        const usedRows = positions.length > 0
          ? Math.ceil(positions[positions.length - 1].row + 1)
          : 1;
        // 使用中心点间距计算高度
        const firstIconTop = panelY + params.gridStartY + params.iconCenterOffsetY - Math.round(params.iconSize / 2);
        const iconAreaHeight = usedRows > 0 
          ? firstIconTop + (usedRows - 1) * params.centerGapY + params.iconSize - firstIconTop
          : params.iconSize;
        const currentPanelHeight = params.gridStartY + iconAreaHeight;

        // 蓝框坐标（一级裁切区域）
        const blueBox = {
          x: panelX,
          y: panelY,
          width: params.panelWidth,
          height: currentPanelHeight,
        };

        // 绿框坐标（标题区域）
        const greenBox = {
          x: panelX,
          y: panelY,
          width: params.greenBoxWidth,
          height: params.gridStartY,
        };

        // 红框坐标（icon区域，二级裁切）
        const redBoxes = positions.map(pos => ({
          x: pos.x,
          y: pos.y,
          width: pos.width,
          height: pos.height,
        }));

        console.log(`  最终坐标:`);
        console.log(`    BlueBox: x=${Math.round(blueBox.x)}, y=${Math.round(blueBox.y)}, w=${Math.round(blueBox.width)}, h=${Math.round(blueBox.height)}`);
        console.log(`    GreenBox: x=${Math.round(greenBox.x)}, y=${Math.round(greenBox.y)}, w=${Math.round(greenBox.width)}, h=${Math.round(greenBox.height)}`);
        console.log(`    RedBox Count: ${redBoxes.length}`);

        return {
          title: panel.title,
          x: panelX,
          y: panelY,
          width: params.panelWidth,
          height: currentPanelHeight,
          rows: panel.rows,
          cols: panel.cols,
          total: panel.total,
          imageUrl: imageUrl,
          blueBox,
          greenBox,
          redBoxes,
        };
      });

      // 显示调试信息
      const debugInfo = exportPanels.map((p, i) => 
        `面板${i + 1}: x=${p.x}, y=${p.y}, w=${p.width}, h=${p.height}, icons=${p.redBoxes?.length || 0}`
      ).join('\n');
      
      console.log('=== 裁切坐标信息 ===\n' + debugInfo);
      alert(`即将裁切，请确认坐标是否正确：\n\n${debugInfo}\n\n点击"确定"继续裁切，点击"取消"取消`);

      // 调用API进行裁切
      const response = await fetch('/api/crop-with-coordinates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageUrl,
          debugPanels: exportPanels,
          wikiName: 'travel-town', // 可以从UI中获取或使用固定值
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();

      if (result.success) {
        setCropResults(result.results);
        alert(`裁切成功！共裁切 ${result.total} 个icon\n\n结果已保存到 public/wiki-cropped/travel-town/`);
        console.log('裁切结果:', result.results);
      } else {
        throw new Error(result.error || '裁切失败');
      }
    } catch (error) {
      if (error instanceof Error && error.message === '用户取消') {
        // 用户点击了取消
        console.log('用户取消裁切');
      } else {
        console.error('裁切失败:', error);
        alert('裁切失败：' + (error instanceof Error ? error.message : '未知错误'));
      }
    } finally {
      setIsProcessing(false);
    }
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
        <div className="flex flex-col lg:flex-row gap-6 h-[calc(100vh-200px)]">
          {/* Canvas区域 - 可滚动 */}
          <div className="flex-1 overflow-y-auto pr-2">
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

          {/* 参数控制区域 - 固定在右侧，不随图片滚动 */}
          <div className="w-full lg:w-96 flex-shrink-0 sticky top-0 h-full overflow-y-auto">
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
              <CardContent className="space-y-6">
                {/* 蓝框相关 */}
                <div className="border-l-4 border-blue-500 pl-4">
                  <Label className="text-sm font-semibold text-blue-600 mb-3 block">蓝框相关 (Panel)</Label>
                  <div className="space-y-4">
                    <div>
                      <Label className="text-xs font-medium text-gray-600">大框 X 起点 (Left Offset)</Label>
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
                          className="w-20 text-center text-sm"
                        />
                      </div>
                    </div>

                    <div>
                      <Label className="text-xs font-medium text-gray-600">大框 Y 起点 (Top Offset)</Label>
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
                          className="w-20 text-center text-sm"
                        />
                      </div>
                    </div>

                    <div>
                      <Label className="text-xs font-medium text-gray-600">蓝框宽度 (Panel Width)</Label>
                      <div className="flex items-center gap-3 mt-2">
                        <Slider
                          value={[params.panelWidth]}
                          onValueChange={([v]) => handleParamChange('panelWidth', v)}
                          min={100}
                          max={2000}
                          step={1}
                          className="flex-1"
                        />
                        <Input
                          type="number"
                          value={params.panelWidth}
                          onChange={(e) => handleParamChange('panelWidth', parseInt(e.target.value) || 0)}
                          className="w-20 text-center text-sm"
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {/* 绿框相关 */}
                <div className="border-l-4 border-green-500 pl-4">
                  <Label className="text-sm font-semibold text-green-600 mb-3 block">绿框相关 (Title)</Label>
                  <div className="space-y-4">
                    <div>
                      <Label className="text-xs font-medium text-gray-600">绿框宽度 (Green Box Width)</Label>
                      <div className="flex items-center gap-3 mt-2">
                        <Slider
                          value={[params.greenBoxWidth]}
                          onValueChange={([v]) => handleParamChange('greenBoxWidth', v)}
                          min={100}
                          max={2000}
                          step={1}
                          className="flex-1"
                        />
                        <Input
                          type="number"
                          value={params.greenBoxWidth}
                          onChange={(e) => handleParamChange('greenBoxWidth', parseInt(e.target.value) || 0)}
                          className="w-20 text-center text-sm"
                        />
                      </div>
                    </div>

                    <div>
                      <Label className="text-xs font-medium text-gray-600">首个图标上边距 (Grid Start Y)</Label>
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
                          className="w-20 text-center text-sm"
                        />
                      </div>
                      <p className="text-xs text-gray-500 mt-1">绿框的高度（标题区域高度）</p>
                    </div>
                  </div>
                </div>

                {/* 红框相关 */}
                <div className="border-l-4 border-red-500 pl-4">
                  <Label className="text-sm font-semibold text-red-600 mb-3 block">红框相关 (Icon)</Label>
                  <div className="space-y-4">
                    <div>
                      <Label className="text-xs font-medium text-gray-600">首个图标左边距 (Grid Start X)</Label>
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
                          className="w-20 text-center text-sm"
                        />
                      </div>
                    </div>

                    <div>
                      <Label className="text-xs font-medium text-gray-600">图标边长尺寸 (Icon Size)</Label>
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
                          className="w-20 text-center text-sm"
                        />
                      </div>
                      <p className="text-xs text-gray-500 mt-1">以中心点为基准的矩形裁切大小（不影响中心点位置）</p>
                    </div>

                    <div>
                      <Label className="text-xs font-medium text-gray-600">中心点 X 偏移 (Center Offset X)</Label>
                      <div className="flex items-center gap-3 mt-2">
                        <Slider
                          value={[params.iconCenterOffsetX]}
                          onValueChange={([v]) => handleParamChange('iconCenterOffsetX', v)}
                          min={-200}
                          max={500}
                          step={1}
                          className="flex-1"
                        />
                        <Input
                          type="number"
                          value={params.iconCenterOffsetX}
                          onChange={(e) => handleParamChange('iconCenterOffsetX', parseInt(e.target.value) || 0)}
                          className="w-20 text-center text-sm"
                        />
                      </div>
                      <p className="text-xs text-gray-500 mt-1">首个中心点相对于 gridStartX 的偏移</p>
                    </div>

                    <div>
                      <Label className="text-xs font-medium text-gray-600">中心点 Y 偏移 (Center Offset Y)</Label>
                      <div className="flex items-center gap-3 mt-2">
                        <Slider
                          value={[params.iconCenterOffsetY]}
                          onValueChange={([v]) => handleParamChange('iconCenterOffsetY', v)}
                          min={-200}
                          max={500}
                          step={1}
                          className="flex-1"
                        />
                        <Input
                          type="number"
                          value={params.iconCenterOffsetY}
                          onChange={(e) => handleParamChange('iconCenterOffsetY', parseInt(e.target.value) || 0)}
                          className="w-20 text-center text-sm"
                        />
                      </div>
                      <p className="text-xs text-gray-500 mt-1">首个中心点相对于 gridStartY 的偏移</p>
                    </div>

                    <div>
                      <Label className="text-xs font-medium text-gray-600">中心点横向间距 (Center Gap X)</Label>
                      <div className="flex items-center gap-3 mt-2">
                        <Slider
                          value={[params.centerGapX]}
                          onValueChange={([v]) => handleParamChange('centerGapX', v)}
                          min={0}
                          max={500}
                          step={1}
                          className="flex-1"
                        />
                        <Input
                          type="number"
                          value={params.centerGapX}
                          onChange={(e) => handleParamChange('centerGapX', parseInt(e.target.value) || 0)}
                          className="w-20 text-center text-sm"
                        />
                      </div>
                      <p className="text-xs text-gray-500 mt-1">相邻中心点之间的 X 轴距离</p>
                    </div>

                    <div>
                      <Label className="text-xs font-medium text-gray-600">中心点纵向间距 (Center Gap Y)</Label>
                      <div className="flex items-center gap-3 mt-2">
                        <Slider
                          value={[params.centerGapY]}
                          onValueChange={([v]) => handleParamChange('centerGapY', v)}
                          min={0}
                          max={500}
                          step={1}
                          className="flex-1"
                        />
                        <Input
                          type="number"
                          value={params.centerGapY}
                          onChange={(e) => handleParamChange('centerGapY', parseInt(e.target.value) || 0)}
                          className="w-20 text-center text-sm"
                        />
                      </div>
                      <p className="text-xs text-gray-500 mt-1">相邻中心点之间的 Y 轴距离</p>
                    </div>
                  </div>
                </div>

                {/* 扫描线相关 */}
                <div className="border-l-4 border-orange-500 pl-4">
                  <Label className="text-sm font-semibold text-orange-600 mb-3 block">扫描线相关 (Scan)</Label>
                  <div className="space-y-4">
                    <div>
                      <Label className="text-xs font-medium text-gray-600">扫描线 X 坐标 (Scan Line X)</Label>
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
                          className="w-20 text-center text-sm"
                        />
                      </div>
                    </div>

                    <div>
                      <Label className="text-xs font-medium text-gray-600">扫描起始 Y 坐标 (Scan Start Y)</Label>
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

                    <div>
                      <Label className="text-xs font-medium text-gray-600">颜色容差值 (Color Tolerance)</Label>
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
                          className="w-20 text-center text-sm"
                        />
                      </div>
                    </div>

                    <div>
                      <Label className="text-xs font-medium text-gray-600">连续判定高度 (Sustained Pixels)</Label>
                      <div className="flex items-center gap-3 mt-2">
                        <Slider
                          value={[params.sustainedPixels]}
                          onValueChange={([v]) => handleParamChange('sustainedPixels', v)}
                          min={5}
                          max={100}
                          step={5}
                          className="flex-1"
                        />
                        <Input
                          type="number"
                          value={params.sustainedPixels}
                          onChange={(e) => handleParamChange('sustainedPixels', parseInt(e.target.value) || 0)}
                          className="w-20 text-center text-sm"
                        />
                      </div>
                    </div>
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

                {/* 裁切功能 */}
                <div className="pt-4 border-t">
                  <Label className="text-sm font-semibold mb-3 block">裁切功能</Label>
                  <Button
                    variant="default"
                    size="default"
                    onClick={handleExportToWorkbench}
                    disabled={isProcessing || !imageUrl || debugPanels.length === 0}
                    className="w-full"
                  >
                    {isProcessing ? '裁切中...' : '导出到工作台'}
                  </Button>
                  {cropResults.length > 0 && (
                    <div className="mt-2 text-sm text-green-600">
                      ✓ 已裁切 {cropResults.length} 个icon
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* 调试信息 */}
      {imageUrl && canvasRef.current && (
        <Card className="mt-6 bg-yellow-50">
          <CardHeader>
            <CardTitle className="text-yellow-800">调试信息</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-yellow-900">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <strong>Canvas 实际尺寸：</strong>
                <p>{canvasRef.current.width} x {canvasRef.current.height} 像素</p>
              </div>
              <div>
                <strong>Canvas 显示尺寸：</strong>
                <p>{canvasRef.current.clientWidth} x {canvasRef.current.clientHeight} 像素</p>
              </div>
              <div>
                <strong>缩放比例：</strong>
                <p>X: {(canvasRef.current.clientWidth / canvasRef.current.width * 100).toFixed(1)}%</p>
                <p>Y: {(canvasRef.current.clientHeight / canvasRef.current.height * 100).toFixed(1)}%</p>
              </div>
              <div>
                <strong>图片 URL：</strong>
                <p className="text-xs break-all">{imageUrl}</p>
              </div>
            </div>
            <div className="mt-4 p-3 bg-yellow-100 rounded">
              <strong>红框坐标示例（选中面板的第一个图标）：</strong>
              {selectedPanelIndex < debugPanels.length && (() => {
                const positions = calculateIconPositions(
                  debugPanels[selectedPanelIndex],
                  0, // 只用于示例
                  canvasRef.current.getContext('2d')!
                );
                if (positions.length > 0) {
                  const pos = positions[0];
                  return (
                    <div className="mt-2 text-xs">
                      <p>左上角：x={pos.x}, y={pos.y}</p>
                      <p>中心点：x={pos.x + Math.round(pos.width / 2)}, y={pos.y + Math.round(pos.height / 2)}</p>
                      <p>尺寸：{pos.width} x {pos.height}</p>
                    </div>
                  );
                }
                return <p className="mt-2">无图标</p>;
              })()}
            </div>
          </CardContent>
        </Card>
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
                <span>红色框：图标裁切区域（基于中心点生成）</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 border-2 border-orange-500 border-dashed" />
                <span>橙色虚线：扫描线</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 border-2 border-yellow-500 border-dashed" />
                <span>黄色虚线：扫描起始线</span>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
