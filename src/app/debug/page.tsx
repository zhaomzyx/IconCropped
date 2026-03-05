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
  const [debugLogs, setDebugLogs] = useState<string[]>([]); // 调试日志
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 自定义日志函数（同时输出到控制台和存储日志）
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
    scanLineX: 49,           // 扫描线 X 坐标（调整到面板左边界附近）
    scanStartY: 200,         // 扫描起始 Y 坐标
    colorTolerance: 30,      // 颜色容差值（降低以提高灵敏度）
    sustainedPixels: 5,      // 连续判定高度（减少以提高灵敏度）
    panelWidth: 876,         // 蓝框宽度（Panel外边缘）
    greenBoxWidth: 876,      // 绿框宽度（标题区域）
    // X轴检测参数（用于检测panel宽度和小panel位置）
    colorToleranceX: 30,     // X轴颜色容差值
    sustainedPixelsX: 5,     // X轴连续判定宽度
  };

  // 复制日志到剪贴板
  const copyLogs = useCallback(() => {
    const logsText = debugLogs.join('\n');
    navigator.clipboard.writeText(logsText).then(() => {
      alert(`✅ 已复制 ${debugLogs.length} 条日志到剪贴板！\n\n请粘贴到对话框中发送给我。`);
    }).catch(err => {
      console.error('复制失败:', err);
      alert('❌ 复制失败，请手动复制。');
    });
  }, [debugLogs]);

  // 清空日志
  const clearLogs = useCallback(() => {
    setDebugLogs([]);
  }, []);

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

    // 计算面板的左上角坐标（X 和 Y 都使用相同的基准）
    const panelX = panel.x + panelLeftOffset;

    // 首个中心点坐标（都基于调整后的 panelX 和 panelY）
    const firstCenterX = panelX + gridStartX + iconCenterOffsetX;
    const firstCenterY = panelY + gridStartY + iconCenterOffsetY;

    const positions: IconPosition[] = [];
    let count = 0;
    const maxCount = total ?? (rows * cols); // 如果没有 total，则使用 rows * cols
    const coreSize = 30; // 核心区域大小（正方形）
    const varianceThreshold = 50; // 方差阈值，小于此值判定为空图标（降低阈值以提高灵敏度）

    // 获取完整的像素数据
    const imageData = ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height);

    console.log(`  [详细坐标分析]`);
    console.log(`    输入参数:`);
    console.log(`      panel.x=${panel.x}, panel.y=${panel.y}`);
    console.log(`      panelLeftOffset=${panelLeftOffset}`);
    console.log(`      gridStartX=${gridStartX}, gridStartY=${gridStartY}`);
    console.log(`      iconCenterOffsetX=${iconCenterOffsetX}, iconCenterOffsetY=${iconCenterOffsetY}`);
    console.log(`    计算过程:`);
    console.log(`      panelX = panel.x + panelLeftOffset = ${panel.x} + ${panelLeftOffset} = ${panelX}`);
    console.log(`      panelY = ${panelY}`);
    console.log(`      firstCenterX = panelX + gridStartX + iconCenterOffsetX = ${panelX} + ${gridStartX} + ${iconCenterOffsetX} = ${firstCenterX}`);
    console.log(`      firstCenterY = panelY + gridStartY + iconCenterOffsetY = ${panelY} + ${gridStartY} + ${iconCenterOffsetY} = ${firstCenterY}`);
    console.log(`    首个图标左上角:`);
    console.log(`      x = firstCenterX - iconSize/2 = ${firstCenterX} - ${iconSize/2} = ${firstCenterX - iconSize/2}`);
    console.log(`      y = firstCenterY - iconSize/2 = ${firstCenterY} - ${iconSize/2} = ${firstCenterY - iconSize/2}`);

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

  // 垂直像素扫描（滑动窗口算法），找出所有面板的 Y 坐标范围
  interface PanelVerticalRange {
    startY: number;
    endY: number;
  }

  const scanVerticalLine = useCallback((
    imageData: ImageData,
    scanLineX: number,
    scanStartY: number,
    colorTolerance: number,
    sustainedPixels: number,
    width: number,
    height: number
  ): PanelVerticalRange[] => {
    const { data } = imageData;
    const panels: PanelVerticalRange[] = [];

    // 边界检查
    if (scanLineX < 0 || scanLineX >= width) {
      console.warn(`Scan line X (${scanLineX}) is out of image bounds (${width})`);
      return panels;
    }

    if (scanStartY < 0 || scanStartY >= height) {
      console.warn(`Scan start Y (${scanStartY}) is out of image bounds (${height})`);
      return panels;
    }

    // 获取主背景色（从起始坐标开始）
    const getPixelColor = (x: number, y: number): [number, number, number] => {
      const index = (y * width + x) * 4;
      return [data[index], data[index + 1], data[index + 2]];
    };

    const backgroundColor = getPixelColor(scanLineX, scanStartY);
    console.log(`[Y轴检测] 背景色: (${backgroundColor.join(', ')})`);
    console.log(`[Y轴检测] 参数: scanLineX=${scanLineX}, scanStartY=${scanStartY}, colorTolerance=${colorTolerance}, sustainedPixels=${sustainedPixels}`);

    // 滑动窗口算法
    let inPanel = false;
    let consecutiveBg = 0;    // 连续背景色计数器
    let consecutivePanel = 0; // 连续面板色计数器
    let currentStartY = 0;

    // 从 Y=scanStartY 扫描到底部（跳过顶部杂乱区域）
    for (let y = scanStartY; y < height; y++) {
      const currentColor = getPixelColor(scanLineX, y);
      const diff = colorDiff(currentColor, backgroundColor);

      if (diff > colorTolerance) {
        // 进入panel区域（背景→面板）
        consecutivePanel++;
        consecutiveBg = 0;

        if (!inPanel && consecutivePanel >= sustainedPixels) {
          inPanel = true;
          currentStartY = y - sustainedPixels + 1;
          console.log(`[Y轴检测] Panel ${panels.length + 1} 上Y轴: ${currentStartY} (检测于 Y=${y})`);
        }
      } else {
        // 离开panel区域（面板→背景）
        consecutiveBg++;
        consecutivePanel = 0;

        if (inPanel && consecutiveBg >= sustainedPixels) {
          inPanel = false;
          const endY = y - sustainedPixels + 1;
          console.log(`[Y轴检测] Panel ${panels.length + 1} 下Y轴: ${endY}, 高度: ${endY - currentStartY}`);
          panels.push({ startY: currentStartY, endY: endY });
        }
      }
    }

    console.log(`[Y轴检测] 共检测到 ${panels.length} 个panel`);
    return panels;
  }, []);

  // 水平像素扫描（滑动窗口算法），检测panel宽度和小panel位置
  interface PanelHorizontalRange {
    startX: number;
    endX: number;
    iconCenters: number[]; // 每个小panel的中心X坐标
  }

  const scanHorizontalLine = useCallback((
    imageData: ImageData,
    midY: number,
    colorTolerance: number,
    sustainedPixels: number,
    width: number
  ): PanelHorizontalRange | null => {
    const { data } = imageData;

    // 获取背景色（从左边开始）
    const getPixelColor = (x: number, y: number): [number, number, number] => {
      const index = (y * width + x) * 4;
      return [data[index], data[index + 1], data[index + 2]];
    };

    const backgroundColor = getPixelColor(0, midY);
    console.log(`[X轴检测] 中间横线 Y: ${midY}, 背景色: (${backgroundColor.join(', ')})`);
    console.log(`[X轴检测] 参数: colorTolerance=${colorTolerance}, sustainedPixels=${sustainedPixels}`);

    // 滑动窗口算法
    let inPanel = false;
    let consecutiveBg = 0;
    let consecutivePanel = 0;
    let startX = 0;
    let endX = 0;
    let currentIconStart = 0;
    const iconCenters: number[] = [];

    for (let x = 0; x < width; x++) {
      const currentColor = getPixelColor(x, midY);
      const diff = colorDiff(currentColor, backgroundColor);

      if (diff > colorTolerance) {
        // 进入panel区域（背景→面板）
        consecutivePanel++;
        consecutiveBg = 0;

        if (!inPanel && consecutivePanel >= sustainedPixels) {
          inPanel = true;
          const panelStartX = x - sustainedPixels + 1;
          currentIconStart = panelStartX;
          
          // 第一次进入时，记录大panel的起始X
          if (iconCenters.length === 0) {
            startX = panelStartX;
            console.log(`[X轴检测] 大panel左边界: ${startX}`);
          } else {
            // 不是第一次进入，说明是一个新的小panel
            console.log(`[X轴检测] 小panel ${iconCenters.length + 1} 左边界: ${panelStartX}`);
          }
        }
      } else {
        // 离开panel区域（面板→背景）
        consecutiveBg++;
        consecutivePanel = 0;

        if (inPanel && consecutiveBg >= sustainedPixels) {
          inPanel = false;
          const panelEndX = x - sustainedPixels + 1;
          
          // 计算当前小panel的中心点
          const iconCenterX = (currentIconStart + panelEndX) / 2;
          iconCenters.push(iconCenterX);
          console.log(`[X轴检测] 小panel ${iconCenters.length} 右边界: ${panelEndX}, 中心点: ${iconCenterX.toFixed(1)}`);
        }
      }
    }

    // 如果扫描到右边还没有回到背景色，假设右边界是图片宽度
    if (inPanel) {
      endX = width;
      const iconCenterX = (currentIconStart + endX) / 2;
      iconCenters.push(iconCenterX);
      console.log(`[X轴检测] 大panel右边界: ${endX} (到图片边界), 最后一个小panel中心点: ${iconCenterX.toFixed(1)}`);
    } else {
      // 使用最后一个icon的右边界
      if (iconCenters.length > 0) {
        const lastIconStart = currentIconStart;
        endX = currentIconStart + (currentIconStart - (iconCenters.length > 1 ? iconCenters[iconCenters.length - 2] * 2 - lastIconStart : 0)) * 2;
        // 简化：使用最后一个icon的右边界
        endX = Math.round(iconCenters[iconCenters.length - 1] + (iconCenters[iconCenters.length - 1] - currentIconStart));
        console.log(`[X轴检测] 大panel右边界: ${endX} (基于最后一个icon计算)`);
      }
    }

    if (iconCenters.length === 0) {
      console.warn(`[X轴检测] 未检测到任何小panel`);
      return null;
    }

    console.log(`[X轴检测] 检测到 ${iconCenters.length} 个小panel, 宽度: ${endX - startX}`);
    console.log(`[X轴检测] 所有小panel中心点: [${iconCenters.map(c => c.toFixed(1)).join(', ')}]`);

    return { startX, endX, iconCenters };
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

      // 1. Y轴检测：获得每个panel的Y坐标范围
      const panelVerticalRanges = scanVerticalLine(
        imageData,
        params.scanLineX,
        params.scanStartY,
        params.colorTolerance,
        params.sustainedPixels,
        canvas.width,
        canvas.height
      );

      // 2. X轴检测：对每个panel检测X坐标范围和小panel位置
      const panelRanges = panelVerticalRanges.map((vRange, index) => {
        const midY = Math.round((vRange.startY + vRange.endY) / 2);
        console.log(`\n[Panel ${index + 1}] 中间横线 Y: ${midY}`);
        
        const hRange = scanHorizontalLine(
          imageData,
          midY,
          params.colorToleranceX,
          params.sustainedPixelsX,
          canvas.width
        );
        
        return {
          startY: vRange.startY,
          endY: vRange.endY,
          startX: hRange?.startX ?? 0,
          endX: hRange?.endX ?? 0,
          width: hRange ? hRange.endX - hRange.startX : 0,
          height: vRange.endY - vRange.startY,
          iconCenters: hRange?.iconCenters ?? [],
          midY: midY
        };
      });

      // 3. 遍历所有panel，使用检测到的坐标绘制
      for (let i = 0; i < Math.min(debugPanels.length, panelRanges.length); i++) {
        const panel = debugPanels[i];
        const range = panelRanges[i];
        const isSelected = i === selectedPanelIndex;

        // 绘制时的详细日志（只记录选中的面板）
        if (isSelected) {
          console.log(`\n========== [drawCanvas] 面板 ${i + 1} (${panel.title}) 坐标计算 ==========`);
          console.log(`[LLM 识别的原始坐标]`);
          console.log(`  panel.x = ${panel.x}`);
          console.log(`  panel.y = ${panel.y}`);
          console.log(`[Y轴检测结果]`);
          console.log(`  startY = ${range.startY}, endY = ${range.endY}, height = ${range.height}`);
          console.log(`[X轴检测结果]`);
          console.log(`  startX = ${range.startX}, endX = ${range.endX}, width = ${range.width}`);
          console.log(`  检测到 ${range.iconCenters.length} 个小panel`);
          console.log(`  所有中心点: [${range.iconCenters.map(c => c.toFixed(1)).join(', ')}]`);
          console.log(`[面板左上角坐标]`);
          console.log(`  x = ${range.startX}, y = ${range.startY}`);
          console.log(`  尺寸 = ${range.width}x${range.height}`);
        }

        // 绘制蓝色框（Panel外边缘）
        ctx.strokeStyle = isSelected ? '#3B82F6' : '#93C5FD'; // 选中时深蓝，未选中时浅蓝
        ctx.lineWidth = isSelected ? 3 : 2;
        ctx.strokeRect(range.startX, range.startY, range.width, range.height);

        // 绘制蓝框坐标
        ctx.fillStyle = isSelected ? '#3B82F6' : '#93C5FD';
        ctx.font = '10px monospace';
        ctx.fillText(
          `(${Math.round(range.startX)}, ${Math.round(range.startY)}) ${Math.round(range.width)}x${Math.round(range.height)}`,
          range.startX + 5,
          range.startY + 12
        );

        // 绘制绿色框（标题区域）
        ctx.strokeStyle = '#22C55E';
        ctx.lineWidth = 2;
        ctx.strokeRect(range.startX, range.startY, range.width, params.gridStartY);

        // 绘制绿框坐标
        ctx.fillStyle = '#22C55E';
        ctx.font = '10px monospace';
        ctx.fillText(
          `(${Math.round(range.startX)}, ${Math.round(range.startY)})`,
          range.startX + 5,
          range.startY + 24
        );

        // 绘制中间横线（用于X轴检测）
        if (isSelected) {
          ctx.strokeStyle = '#00FF00'; // 绿色
          ctx.lineWidth = 1;
          ctx.setLineDash([3, 3]);
          ctx.beginPath();
          ctx.moveTo(range.startX, range.midY);
          ctx.lineTo(range.endX, range.midY);
          ctx.stroke();
          ctx.setLineDash([]);

          ctx.fillStyle = '#00FF00';
          ctx.font = '10px monospace';
          ctx.fillText(`midY=${range.midY}`, range.startX + 5, range.midY - 5);
        }

        // 绘制红色框（使用检测到的中心点）
        range.iconCenters.forEach((centerX, index) => {
          const iconX = centerX - params.iconSize / 2;
          const iconY = range.startY + params.gridStartY + params.iconCenterOffsetY - params.iconSize / 2;

          ctx.strokeStyle = '#EF4444';
          ctx.lineWidth = 2;
          ctx.strokeRect(iconX, iconY, params.iconSize, params.iconSize);

          // 绘制序号
          ctx.fillStyle = '#EF4444';
          ctx.font = '12px Arial';
          ctx.fillText(`#${index + 1}`, iconX + 3, iconY + 15);

          // 绘制红框坐标
          ctx.fillStyle = '#EF4444';
          ctx.font = '9px monospace';
          ctx.fillText(
            `(${Math.round(iconX)}, ${Math.round(iconY)})`,
            iconX + 3,
            iconY + params.iconSize - 3
          );

          // 绘制中心点标记
          if (isSelected) {
            ctx.fillStyle = '#FF00FF';
            ctx.beginPath();
            ctx.arc(centerX, iconY + params.iconSize / 2, 3, 0, 2 * Math.PI);
            ctx.fill();
          }
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

          // 在扫描线上显示颜色变化点（调试用）
          const { data } = imageData;
          const getPixelColor = (x: number, y: number): [number, number, number] => {
            const index = (y * imageData.width + x) * 4;
            return [data[index], data[index + 1], data[index + 2]];
          };
          const backgroundColor = getPixelColor(params.scanLineX, params.scanStartY);

          // 每隔 20 像素显示一个颜色指示器
          for (let y = params.scanStartY; y < canvas.height; y += 20) {
            const currentColor = getPixelColor(params.scanLineX, y);
            const diff = colorDiff(currentColor, backgroundColor);

            // 如果颜色差异超过容差值，绘制红色标记
            if (diff > params.colorTolerance) {
              ctx.fillStyle = '#FF0000';
              ctx.fillRect(params.scanLineX - 2, y, 4, 4);
            }
          }

          // 在扫描线旁边标注参数
          ctx.fillStyle = '#FFA500';
          ctx.font = '12px monospace';
          ctx.fillText(`X=${params.scanLineX}, T=${params.colorTolerance}, S=${params.sustainedPixels}`, params.scanLineX + 5, params.scanStartY - 10);
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
  }, [imageUrl, debugPanels, selectedPanelIndex, params, scanVerticalLine, scanHorizontalLine]);

  // 重新绘制Canvas
  useEffect(() => {
    drawCanvas();
  }, [drawCanvas]);

  // 处理图片上传
  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    logInfo('开始上传图片:', file.name, file.size, 'bytes');

    const formData = new FormData();
    formData.append('file', file);
    formData.append('type', 'wiki');

    setIsProcessing(true);

    try {
      // 上传图片
      logInfo('步骤1: 上传图片到 /api/upload');
      const uploadRes = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });
      const uploadData = await uploadRes.json();

      logInfo('上传响应:', uploadData);

      if (uploadData.success) {
        const uploadedFilename = uploadData.filename;
        logInfo('✓ 上传成功，文件名:', uploadedFilename);

        // 调试模式处理
        logInfo('步骤2: 调用 /api/process-image-stream (debug模式)');
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

        logInfo('开始读取SSE流...');

        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            logInfo('SSE流读取完成，共收到', eventCount, '个事件');
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
                  logInfo(`收到事件 ${eventCount}: ${event}`, data);

                  if (event === 'debug_complete') {
                    logInfo('✓ Debug模式完成，面板数据:', data.debugPanels);
                    setDebugPanels(data.debugPanels);
                    // 设置图片URL - 使用正确的API路由
                    setImageUrl(`/api/uploads/wiki/${uploadedFilename}`);
                    logInfo('✓ 图片URL已设置:', `/api/uploads/wiki/${uploadedFilename}`);
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

      // 1. Y轴检测：获得每个panel的Y坐标范围
      const panelVerticalRanges = scanVerticalLine(
        imageData,
        params.scanLineX,
        params.scanStartY,
        params.colorTolerance,
        params.sustainedPixels,
        canvas.width,
        canvas.height
      );

      // 2. X轴检测：对每个panel检测X坐标范围和小panel位置
      const panelRanges = panelVerticalRanges.map((vRange, index) => {
        const midY = Math.round((vRange.startY + vRange.endY) / 2);
        
        const hRange = scanHorizontalLine(
          imageData,
          midY,
          params.colorToleranceX,
          params.sustainedPixelsX,
          canvas.width
        );
        
        return {
          startY: vRange.startY,
          endY: vRange.endY,
          startX: hRange?.startX ?? 0,
          endX: hRange?.endX ?? 0,
          width: hRange ? hRange.endX - hRange.startX : 0,
          height: vRange.endY - vRange.startY,
          iconCenters: hRange?.iconCenters ?? [],
          midY: midY
        };
      });

      // 收集所有面板的坐标数据
      const exportPanels = panelRanges.map((range, i) => {
        const panel = debugPanels[i];
        const panelX = range.startX;
        const panelY = range.startY;

        // 详细日志：计算前的参数
        logInfo(`\n========== 面板 ${i + 1} (${panel.title}) 坐标分析 ==========`);
        logInfo(`[Y轴检测结果]`);
        logInfo(`  startY = ${range.startY}, endY = ${range.endY}, height = ${range.height}`);
        logInfo(`[X轴检测结果]`);
        logInfo(`  startX = ${range.startX}, endX = ${range.endX}, width = ${range.width}`);
        logInfo(`  检测到 ${range.iconCenters.length} 个小panel`);
        logInfo(`  所有中心点: [${range.iconCenters.map(c => c.toFixed(1)).join(', ')}]`);

        // 蓝框坐标（一级裁切区域）
        const blueBox = {
          x: range.startX,
          y: range.startY,
          width: range.width,
          height: range.height,
        };

        // 绿框坐标（标题区域）
        const greenBox = {
          x: range.startX,
          y: range.startY,
          width: range.width,
          height: params.gridStartY,
        };

        // 红框坐标（icon区域，二级裁切）- 使用检测到的中心点
        const redBoxes = range.iconCenters.map((centerX, iconIndex) => {
          const iconX = centerX - params.iconSize / 2;
          const iconY = range.startY + params.gridStartY + params.iconCenterOffsetY - params.iconSize / 2;
          return {
            x: iconX,
            y: iconY,
            width: params.iconSize,
            height: params.iconSize,
          };
        });

        logInfo(`  最终坐标:`);
        logInfo(`    BlueBox: x=${Math.round(blueBox.x)}, y=${Math.round(blueBox.y)}, w=${Math.round(blueBox.width)}, h=${Math.round(blueBox.height)}`);
        logInfo(`    GreenBox: x=${Math.round(greenBox.x)}, y=${Math.round(greenBox.y)}, w=${Math.round(greenBox.width)}, h=${Math.round(greenBox.height)}`);
        logInfo(`    RedBox Count: ${redBoxes.length}`);

        return {
          title: panel.title,
          x: range.startX,
          y: range.startY,
          width: range.width,
          height: range.height,
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
      
      logInfo('=== 裁切坐标信息 ===\n' + debugInfo);
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
        logInfo('裁切结果:', result.results);
      } else {
        throw new Error(result.error || '裁切失败');
      }
    } catch (error) {
      if (error instanceof Error && error.message === '用户取消') {
        // 用户点击了取消
        logInfo('用户取消裁切');
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
                  className="border border-gray-300"
                  style={{ maxWidth: '100%', width: 'auto', height: 'auto' }}
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

                    <div className="border-t pt-4 mt-4">
                      <Label className="text-xs font-semibold text-orange-600 mb-3 block">X轴检测参数 (Horizontal Scan)</Label>
                      <div className="space-y-4">
                        <div>
                          <Label className="text-xs font-medium text-gray-600">X轴颜色容差值 (Color Tolerance X)</Label>
                          <div className="flex items-center gap-3 mt-2">
                            <Slider
                              value={[params.colorToleranceX]}
                              onValueChange={([v]) => handleParamChange('colorToleranceX', v)}
                              min={5}
                              max={50}
                              step={1}
                              className="flex-1"
                            />
                            <Input
                              type="number"
                              value={params.colorToleranceX}
                              onChange={(e) => handleParamChange('colorToleranceX', parseInt(e.target.value) || 0)}
                              className="w-20 text-center text-sm"
                            />
                          </div>
                        </div>

                        <div>
                          <Label className="text-xs font-medium text-gray-600">X轴连续判定宽度 (Sustained Pixels X)</Label>
                          <div className="flex items-center gap-3 mt-2">
                            <Slider
                              value={[params.sustainedPixelsX]}
                              onValueChange={([v]) => handleParamChange('sustainedPixelsX', v)}
                              min={5}
                              max={100}
                              step={5}
                              className="flex-1"
                            />
                            <Input
                              type="number"
                              value={params.sustainedPixelsX}
                              onChange={(e) => handleParamChange('sustainedPixelsX', parseInt(e.target.value) || 0)}
                              className="w-20 text-center text-sm"
                            />
                          </div>
                        </div>
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

                {/* 调试日志 */}
                <div className="pt-4 border-t">
                  <Label className="text-sm font-semibold mb-3 block">调试日志</Label>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={copyLogs}
                      disabled={debugLogs.length === 0}
                      className="flex-1"
                    >
                      📋 复制日志 ({debugLogs.length})
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={clearLogs}
                      disabled={debugLogs.length === 0}
                      className="flex-1"
                    >
                      🗑️ 清空日志
                    </Button>
                  </div>
                  {debugLogs.length > 0 && (
                    <div className="mt-2 text-xs text-gray-500">
                      点击"复制日志"后，将内容粘贴到对话框中发送给我
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* 调试信息 */}
      {imageUrl && canvasRef.current && (() => {
        const scaleRatioX = canvasRef.current.clientWidth / canvasRef.current.width * 100;
        const scaleRatioY = canvasRef.current.clientHeight / canvasRef.current.height * 100;
        const isScaled = Math.abs(scaleRatioX - 100) > 1 || Math.abs(scaleRatioY - 100) > 1;

        return (
          <Card className={`mt-6 ${isScaled ? 'bg-red-50' : 'bg-green-50'}`}>
            <CardHeader>
              <CardTitle className={isScaled ? 'text-red-800' : 'text-green-800'}>
                {isScaled ? '⚠️ 警告：Canvas 被缩放了！' : '✅ Canvas 缩放正常'}
              </CardTitle>
            </CardHeader>
            <CardContent className={`text-sm ${isScaled ? 'text-red-900' : 'text-green-900'}`}>
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
                  <p className={isScaled ? 'text-red-600 font-bold' : ''}>
                    X: {scaleRatioX.toFixed(1)}%
                    <br />
                    Y: {scaleRatioY.toFixed(1)}%
                  </p>
                </div>
                <div>
                  <strong>图片 URL：</strong>
                  <p className="text-xs break-all">{imageUrl}</p>
                </div>
              </div>

              {isScaled && (
                <div className="mt-4 p-3 bg-red-100 rounded border border-red-300">
                  <strong className="text-red-800">🚨 问题说明：</strong>
                  <p className="mt-2 text-red-900">
                    Canvas 被缩放了 {Math.abs(scaleRatioX - 100).toFixed(1)}%，这会导致裁切坐标不准确！
                  </p>
                  <p className="mt-2 text-red-900">
                    <strong>可能原因：</strong>
                    <br />• CSS 样式导致 Canvas 被拉伸
                    <br />• 浏览器缩放或显示器缩放
                  </p>
                  <p className="mt-2 text-red-900">
                    <strong>解决方案：</strong>
                    <br />• 刷新页面重新加载图片
                    <br />• 检查浏览器缩放比例（应为 100%）
                    <br />• 如果问题持续，请联系开发者
                  </p>
                </div>
              )}

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
                  return <p className="mt-2">无图标</p>
                })()}
              </div>
            </CardContent>
          </Card>
        );
      })()}

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
            <div className="mt-4 p-3 bg-blue-50 rounded border border-blue-200">
              <p className="text-sm text-blue-900">
                <strong>💡 坐标显示说明：</strong>各框左上角会显示坐标值（格式：x,y）。裁切后的图片会自动在左下角添加红色坐标信息，便于对照验证。
              </p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
