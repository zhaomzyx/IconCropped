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

// 保存 Canvas 上绘制的框体坐标
interface DetectedPanel {
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
  blueBox: { x: number; y: number; width: number; height: number };
  greenBox: { x: number; y: number; width: number; height: number };
  redBoxes: Array<{ x: number; y: number; width: number; height: number }>;
  originalWidth?: number; // 归一化前的原始宽度（可选）
}

export default function WikiDebugPage() {
  const [imageUrl, setImageUrl] = useState<string>('');
  const [debugPanels, setDebugPanels] = useState<DebugPanel[]>([]);
  const [selectedPanelIndex, setSelectedPanelIndex] = useState<number>(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [cropResults, setCropResults] = useState<any[]>([]); // 裁切结果
  const [debugLogs, setDebugLogs] = useState<string[]>([]); // 调试日志
  const [detectedPanels, setDetectedPanels] = useState<DetectedPanel[]>([]); // Canvas 上绘制的框体坐标
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
    // 绿框相关（标题区域）
    gridStartY: 107,  // 标题区域高度（绿框高度）

    // 扫描线相关参数
    scanLineX: 49,           // 扫描线 X 坐标（调整到面板左边界附近）
    scanStartY: 200,         // 扫描起始 Y 坐标
    colorTolerance: 30,      // 颜色容差值（降低以提高灵敏度）
    sustainedPixels: 5,      // 连续判定高度（减少以提高灵敏度）
    // X轴检测参数（用于检测panel宽度和小panel位置）
    colorToleranceX: 30,     // X轴颜色容差值
    sustainedPixelsX: 5,     // X轴连续判定宽度
    // 🌟 X轴偏移校准（用于调整蓝框的X坐标）
    offsetX: 0,              // 蓝框X轴偏移（像素，正数向右，负数向左）
    // 多行图标检测参数
    iconLineOffset: 107,     // 第一行图标线相对于panel顶部的偏移
    iconLineGap: 144,        // 多行图标线之间的间距
    minIconsPerLine: 5,      // 每行最小图标数量（达到此数量才检测下一行）

    // 滑动窗口检测参数（已弃用，保留用于兼容性）
    slidingWindowRows: 20,      // 红色横向矩形窗口高度（N行）
    slidingWindowCols: 20,      // 蓝色竖向矩形窗口宽度（M列）
    slidingWindowDiffThreshold: 30,  // 滑动窗口颜色差异阈值
    slidingWindowStepSize: 5,   // 滑动窗口步长（像素）
    slidingWindowMinGap: 50,    // 最小行/列间距（像素）

    // 边界检测参数（默认使用）
    useBoundsDetection: true,   // 始终使用边界检测方法
    boundsWindowHeight: 5,      // 边界检测窗口高度（用于检测行）
    boundsWindowWidth: 5,       // 边界检测窗口宽度（用于检测列）
    boundsVarianceThresholdRow: 30,  // 边界检测颜色方差阈值（行检测）
    boundsVarianceThresholdCol: 30,  // 边界检测颜色方差阈值（列检测）
    boundsStepSize: 1,          // 边界检测步长（像素）
    boundsMinRowHeight: 20,     // 最小行高（过滤噪声）
    boundsMinColWidth: 20,      // 最小列宽（过滤噪声）
    forceSquareIcons: true,     // 强制图标为1:1正方形（基于行高度）
    forceSquareOffsetX: 0,      // 1:1强制时的X轴偏移（像素）
    forceSquareOffsetY: 2,      // 1:1强制时的Y轴偏移（像素）

    // 空图标过滤参数
    filterEmptyIcons: true,     // 是否过滤空图标（没有内容的方框）
    emptyIconVarianceThreshold: 20,  // 判断空图标的方差阈值（低于此值视为空）
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
          const mergedParams = { ...DEFAULT_PARAMS, ...parsed };
          // 🌟 确保新参数有默认值（如果localStorage中没有）
          if (parsed.filterEmptyIcons === undefined) {
            mergedParams.filterEmptyIcons = DEFAULT_PARAMS.filterEmptyIcons;
          }
          if (parsed.emptyIconVarianceThreshold === undefined) {
            mergedParams.emptyIconVarianceThreshold = DEFAULT_PARAMS.emptyIconVarianceThreshold;
          }
          // ⚠️ 不再强制覆盖偏移校准参数，允许用户自定义
          // if (parsed.forceSquareOffsetX === undefined) {
          //   mergedParams.forceSquareOffsetX = DEFAULT_PARAMS.forceSquareOffsetX;
          // }
          // if (parsed.forceSquareOffsetY === undefined) {
          //   mergedParams.forceSquareOffsetY = DEFAULT_PARAMS.forceSquareOffsetY;
          // }
          console.log('[DebugPage] 从LocalStorage加载参数:', mergedParams);
          return mergedParams;
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

    console.log(`[Y轴检测] 开始扫描，输入参数：`);
    console.log(`  scanLineX=${scanLineX}, scanStartY=${scanStartY}`);
    console.log(`  colorTolerance=${colorTolerance}, sustainedPixels=${sustainedPixels}`);
    console.log(`  image size: ${width}x${height}`);

    // 边界检查
    if (scanLineX < 0 || scanLineX >= width) {
      console.warn(`[Y轴检测] ❌ Scan line X (${scanLineX}) is out of image bounds (${width})`);
      return panels;
    }

    if (scanStartY < 0 || scanStartY >= height) {
      console.warn(`[Y轴检测] ❌ Scan start Y (${scanStartY}) is out of image bounds (${height})`);
      return panels;
    }

    console.log(`[Y轴检测] ✓ 边界检查通过`);

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
  interface IconBoundary {
    startX: number;
    endX: number;
    centerX: number;
  }

  interface PanelHorizontalRange {
    startX: number;
    endX: number;
    icons: IconBoundary[]; // 每个小panel的边界信息
  }

  const scanHorizontalLine = useCallback((
    imageData: ImageData,
    scanY: number,
    colorTolerance: number,
    sustainedPixels: number,
    width: number
  ): PanelHorizontalRange | null => {
    const { data } = imageData;

    // 获取像素颜色
    const getPixelColor = (x: number, y: number): [number, number, number] => {
      const index = (y * width + x) * 4;
      return [data[index], data[index + 1], data[index + 2]];
    };

    // 🌟 优化：从左侧多个位置采样背景色，确保背景色准确
    // 从左侧 5px-20px 位置采样，避免可能的装饰边框
    const samplePositions = [5, 10, 15, 20];
    const backgroundColors = samplePositions.map(x => getPixelColor(x, scanY));
    
    // 计算平均背景色
    const backgroundColor = [
      Math.round(backgroundColors.reduce((sum, c) => sum + c[0], 0) / backgroundColors.length),
      Math.round(backgroundColors.reduce((sum, c) => sum + c[1], 0) / backgroundColors.length),
      Math.round(backgroundColors.reduce((sum, c) => sum + c[2], 0) / backgroundColors.length)
    ] as [number, number, number];
    
    console.log(`[X轴检测] 扫描线 Y: ${scanY}`);
    console.log(`[X轴检测] 采样位置: x=${samplePositions.join(', ')}`);
    console.log(`[X轴检测] 背景色: (${backgroundColor.join(', ')}) (平均值)`);
    console.log(`[X轴检测] 参数: colorTolerance=${colorTolerance}, sustainedPixels=${sustainedPixels}`);

    // 滑动窗口算法
    let inPanel = false;
    let consecutiveBg = 0;
    let consecutivePanel = 0;
    let panelStartX = 0;
    let panelEndX = 0;
    let currentIconStart = 0;
    const icons: IconBoundary[] = [];

    for (let x = 0; x < width; x++) {
      const currentColor = getPixelColor(x, scanY);
      const diff = colorDiff(currentColor, backgroundColor);

      if (diff > colorTolerance) {
        // 进入panel区域（背景→面板）
        consecutivePanel++;
        consecutiveBg = 0;

        if (!inPanel && consecutivePanel >= sustainedPixels) {
          inPanel = true;
          const iconStartX = x - sustainedPixels + 1;
          currentIconStart = iconStartX;
          
          // 第一次进入时，记录大panel的起始X
          if (icons.length === 0) {
            panelStartX = iconStartX;
            console.log(`[X轴检测] 大panel左边界: ${panelStartX}`);
          } else {
            // 不是第一次进入，说明是一个新的小panel
            console.log(`[X轴检测] Icon ${icons.length + 1} 左边界: ${iconStartX}`);
          }
        }
      } else {
        // 离开panel区域（面板→背景）
        consecutiveBg++;
        consecutivePanel = 0;

        if (inPanel && consecutiveBg >= sustainedPixels) {
          inPanel = false;
          const iconEndX = x - sustainedPixels + 1;
          
          // 计算当前icon的边界信息
          const iconCenterX = (currentIconStart + iconEndX) / 2;
          icons.push({
            startX: currentIconStart,
            endX: iconEndX,
            centerX: iconCenterX
          });
          console.log(`[X轴检测] Icon ${icons.length} 右边界: ${iconEndX}, 中心点: ${iconCenterX.toFixed(1)}`);
        }
      }
    }

    // 如果扫描到右边还没有回到背景色，假设右边界是图片宽度
    if (inPanel) {
      panelEndX = width;
      const iconCenterX = (currentIconStart + panelEndX) / 2;
      icons.push({
        startX: currentIconStart,
        endX: panelEndX,
        centerX: iconCenterX
      });
      console.log(`[X轴检测] 大panel右边界: ${panelEndX} (到图片边界), 最后一个Icon中心点: ${iconCenterX.toFixed(1)}`);
    } else {
      // 使用最后一个icon的右边界
      if (icons.length > 0) {
        const lastIcon = icons[icons.length - 1];
        panelEndX = lastIcon.endX;
        console.log(`[X轴检测] 大panel右边界: ${panelEndX} (基于最后一个icon计算)`);
      }
    }

    if (icons.length === 0) {
      console.warn(`[X轴检测] 未检测到任何icon`);
      return null;
    }

    console.log(`[X轴检测] 检测到 ${icons.length} 个icon, 宽度: ${panelEndX - panelStartX}`);

    return { startX: panelStartX, endX: panelEndX, icons };
  }, []);

  // 在icon中心点上下扫描，检测icon的高度
  interface IconVerticalRange {
    topY: number;
    bottomY: number;
    height: number;
  }

  const scanIconVerticalBounds = useCallback((
    imageData: ImageData,
    centerX: number,
    scanY: number,  // icon中心点的Y坐标
    colorTolerance: number,
    sustainedPixels: number,
    width: number,
    height: number
  ): IconVerticalRange | null => {
    const { data } = imageData;

    const getPixelColor = (x: number, y: number): [number, number, number] => {
      const index = (y * width + x) * 4;
      return [data[index], data[index + 1], data[index + 2]];
    };

    // 获取icon颜色（从中心点）
    const iconColor = getPixelColor(centerX, scanY);
    console.log(`[高度检测] 中心点 (${centerX}, ${scanY}), icon色: (${iconColor.join(', ')})`);

    let topY = scanY;
    let bottomY = scanY;

    // 向上扫描检测上边界
    let consecutiveIcon = 0;
    let consecutiveBg = 0;
    for (let y = scanY - 1; y >= 0; y--) {
      const currentColor = getPixelColor(centerX, y);
      const diff = colorDiff(currentColor, iconColor);

      if (diff <= colorTolerance) {
        // 仍在icon区域内
        consecutiveIcon++;
        consecutiveBg = 0;
      } else {
        // 离开icon区域
        consecutiveBg++;
        consecutiveIcon = 0;

        if (consecutiveBg >= sustainedPixels) {
          topY = y + sustainedPixels;
          console.log(`[高度检测] 上边界: Y=${topY}`);
          break;
        }
      }
    }

    // 向下扫描检测下边界
    consecutiveIcon = 0;
    consecutiveBg = 0;
    for (let y = scanY + 1; y < height; y++) {
      const currentColor = getPixelColor(centerX, y);
      const diff = colorDiff(currentColor, iconColor);

      if (diff <= colorTolerance) {
        // 仍在icon区域内
        consecutiveIcon++;
        consecutiveBg = 0;
      } else {
        // 离开icon区域
        consecutiveBg++;
        consecutiveIcon = 0;

        if (consecutiveBg >= sustainedPixels) {
          bottomY = y - sustainedPixels;
          console.log(`[高度检测] 下边界: Y=${bottomY}`);
          break;
        }
      }
    }

    const iconHeight = bottomY - topY;
    console.log(`[高度检测] Icon高度: ${iconHeight}`);

    return { topY, bottomY, height: iconHeight };
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

      // 2. X轴检测：对每个panel检测X坐标范围（仅检测Panel边界）
      const panelRanges = panelVerticalRanges.map((vRange, index) => {
        const panel = debugPanels[index];
        const safePanel = panel || { title: `Panel_${index + 1}` };
        const midY = Math.round((vRange.startY + vRange.endY) / 2);

        console.log(`\n[Panel ${index + 1}] ${safePanel.title}`);
        console.log(`[Panel ${index + 1}] 中间检测线 Y: ${midY}`);

        // 在Panel中间横线上扫描，检测Panel的左右边界
        const hRange = scanHorizontalLine(
          imageData,
          midY,
          params.colorToleranceX,
          params.sustainedPixelsX,
          canvas.width
        );

        if (hRange) {
          console.log(`[Panel ${index + 1}] 检测到 Panel 边界: startX=${hRange.startX}, endX=${hRange.endX}, width=${hRange.endX - hRange.startX}`);
        } else {
          console.warn(`[Panel ${index + 1}] 未检测到 Panel 边界`);
        }

        return {
          startY: vRange.startY,
          endY: vRange.endY,
          startX: hRange?.startX ?? 0,
          endX: hRange?.endX ?? 0,
          width: hRange ? hRange.endX - hRange.startX : 0,
          height: vRange.endY - vRange.startY,
        };
      });

      // 3. 🌟 重新组织代码：先创建面板数据，执行归一化，然后再绘制

      // 3.1 遍历所有panel，创建面板数据（不绘制）
      const currentDetectedPanels: DetectedPanel[] = [];

      for (let i = 0; i < Math.min(debugPanels.length, panelRanges.length); i++) {
        const panel = debugPanels[i];
        const safePanel = panel || { title: `Panel_${i + 1}` };
        const range = panelRanges[i];
        const isSelected = i === selectedPanelIndex;

        console.log(`\n[Panel ${i + 1}] ${safePanel.title}: 初始宽度 = ${range.width}px`);

        // 保存框体坐标
        const blueBox = {
          x: range.startX,
          y: range.startY,
          width: range.width,
          height: range.height,
        };

        const greenBox = {
          x: range.startX,
          y: range.startY,
          width: range.width,
          height: params.gridStartY,
        };

        currentDetectedPanels.push({
          title: safePanel.title,
          x: range.startX,
          y: range.startY,
          width: range.width,
          height: range.height,
          blueBox,
          greenBox,
          redBoxes: [], // 稍后填充
        });
      }

      // 3.2 🌟 宽度归一化（在绘制之前执行）
      if (currentDetectedPanels.length > 0) {
        const widthStats = normalizePanelWidths(currentDetectedPanels);
        if (widthStats.applied) {
          console.log(`[drawCanvas] ✅ 宽度归一化已应用：目标宽度 ${widthStats.targetWidth}px，影响 ${widthStats.affectedCount} 个面板`);

          // 🌟 更新 panelRanges，让 Canvas 绘制蓝框时使用归一化后的宽度
          for (let i = 0; i < currentDetectedPanels.length; i++) {
            const panel = currentDetectedPanels[i];
            if (panel.width !== panelRanges[i].width) {
              console.log(`[Canvas绘制] Panel ${i + 1}: 更新蓝框宽度 ${panelRanges[i].width}px → ${panel.width}px`);
              panelRanges[i].width = panel.width;
              panelRanges[i].endX = panelRanges[i].startX + panel.width;
            }
          }

          // 添加归一化日志
          const logMessages = [
            '',
            '='.repeat(60),
            '🎯 宽度归一化结果',
            '='.repeat(60),
            `目标宽度: ${widthStats.targetWidth}px`,
            `影响面板: ${widthStats.affectedCount} / ${currentDetectedPanels.length} 个`,
            '',
            '归一化详情:',
            ...widthStats.normalizedPanels.map(p => `  Panel ${p.panelIndex + 1} [${p.title}]: ${p.oldWidth}px → ${p.newWidth}px`),
            '='.repeat(60),
            ''
          ];
          logMessages.forEach(msg => console.log(msg));
        } else {
          console.log(`[drawCanvas] ⚠️ 宽度归一化未应用（不满足归一化条件）`);
        }
      }

      // 3.3 🌟 再次遍历所有panel，使用归一化后的宽度绘制并检测图标
      for (let i = 0; i < Math.min(debugPanels.length, panelRanges.length); i++) {
        const panel = debugPanels[i];
        const safePanel = panel || { title: `Panel_${i + 1}` };
        const range = panelRanges[i]; // 🌟 此时 range.width 已经被归一化更新
        const isSelected = i === selectedPanelIndex;
        const currentDetectedPanel = currentDetectedPanels[i]; // 🌟 获取归一化后的面板数据

        // 绘制时的详细日志（只记录选中的面板）
        if (isSelected) {
          console.log(`\n========== [drawCanvas] 面板 ${i + 1} (${safePanel.title}) 坐标计算 ==========`);
          console.log(`[Y轴检测结果]`);
          console.log(`  startY = ${range.startY}, endY = ${range.endY}, height = ${range.height}`);
          console.log(`[X轴检测结果]`);
          console.log(`  startX = ${range.startX}, endX = ${range.endX}, width = ${range.width}`);
          console.log(`  🌟 归一化后宽度 = ${currentDetectedPanel.width}px`);
        }

        // 绘制蓝色框（Panel外边缘）- 🌟 使用归一化后的宽度 + X轴偏移
        const adjustedStartX = range.startX + params.offsetX;
        ctx.strokeStyle = isSelected ? '#3B82F6' : '#93C5FD';
        ctx.lineWidth = isSelected ? 3 : 2;
        ctx.strokeRect(adjustedStartX, range.startY, range.width, range.height);

        // 绘制蓝框坐标
        ctx.fillStyle = isSelected ? '#3B82F6' : '#93C5FD';
        ctx.font = '10px monospace';
        ctx.fillText(
          `(${Math.round(adjustedStartX)}, ${Math.round(range.startY)}) ${Math.round(range.width)}x${Math.round(range.height)}`,
          adjustedStartX + 5,
          range.startY + 12
        );

        // 绘制绿色框（标题区域）- 🌟 使用归一化后的宽度 + X轴偏移
        ctx.strokeStyle = '#22C55E';
        ctx.lineWidth = 2;
        ctx.strokeRect(adjustedStartX, range.startY, range.width, params.gridStartY);

        // 绘制绿框坐标
        ctx.fillStyle = '#22C55E';
        ctx.font = '10px monospace';
        ctx.fillText(
          `(${Math.round(range.startX)}, ${Math.round(range.startY)})`,
          range.startX + 5,
          range.startY + 24
        );

        // 绘制中间横线（用于调试X轴检测）
        if (isSelected) {
          const midY = Math.round((range.startY + range.endY) / 2);
          ctx.strokeStyle = '#00FF00';
          ctx.lineWidth = 1;
          ctx.setLineDash([3, 3]);
          ctx.beginPath();
          ctx.moveTo(range.startX, midY);
          ctx.lineTo(range.endX, midY);
          ctx.stroke();
          ctx.setLineDash([]);

          ctx.fillStyle = '#00FF00';
          ctx.font = '10px monospace';
          ctx.fillText(`midY=${midY}`, range.startX + 5, midY - 5);
        }

        // 使用边界检测方法检测图标位置
        console.log(`[检测方法] 使用边界检测方法`);

        // 缩小扫描范围10像素，减少边界噪音
        const padding = 10;
        const scanX = range.startX + padding;

        // 核心修改 1：让扫描的起始 Y 坐标直接跳过绿框（标题区域）
        const scanY = range.startY + params.gridStartY + padding;

        const scanWidth = range.width - padding * 2; // 🌟 使用归一化后的宽度

        // 核心修改 2：扫描总高度也要相应减去绿框的高度
        const scanHeight = range.height - params.gridStartY - padding * 2;

        console.log(`[扫描范围] 原始: (${range.startX}, ${range.startY}) ${range.width}x${range.height}`);
        console.log(`[扫描范围] 缩小: (${scanX}, ${scanY}) ${scanWidth}x${scanHeight}`);

        const bounds = detectAllBounds(
          Buffer.from(imageData.data),
          canvas.width,
          scanX,
          scanY,
          scanWidth,
          scanHeight,
          {
            windowHeight: params.boundsWindowHeight,
            windowWidth: params.boundsWindowWidth,
            varianceThresholdRow: params.boundsVarianceThresholdRow,
            varianceThresholdCol: params.boundsVarianceThresholdCol,
            stepSize: params.boundsStepSize,
            minRowHeight: params.boundsMinRowHeight,
            minColWidth: params.boundsMinColWidth,
          }
        );

        console.log(`[边界检测] Panel: ${panel.title}`);
        console.log(`  检测到 ${bounds.rows.length} 行, ${bounds.cols.length} 列`);

        // 显示列检测使用的扫描高度
        if (bounds.rows.length > 0) {
          const colScanHeight = bounds.rows[0].height;
          console.log(`  ✅ 列检测使用第一行高度: ${Math.round(colScanHeight)}px`);
        } else {
          console.log(`  ⚠️ 列检测使用整个panel高度: ${range.height}px (未检测到行)`);
        }

        // 警告：如果没有检测到行列
        if (bounds.rows.length === 0) {
          console.warn(`  ⚠️ 未检测到任何行！请调整行检测参数：`);
          console.warn(`    - 增大窗口高度 (当前: ${params.boundsWindowHeight})`);
          console.warn(`    - 降低行检测方差阈值 (当前: ${params.boundsVarianceThresholdRow})`);
          console.warn(`    - 降低最小行高 (当前: ${params.boundsMinRowHeight})`);
        }

        if (bounds.cols.length === 0) {
          console.warn(`  ⚠️ 未检测到任何列！请调整列检测参数：`);
          console.warn(`    - 增大窗口宽度 (当前: ${params.boundsWindowWidth})`);
          console.warn(`    - 降低列检测方差阈值 (当前: ${params.boundsVarianceThresholdCol})`);
          console.warn(`    - 降低最小列宽 (当前: ${params.boundsMinColWidth})`);
        }

        if (bounds.rows.length > 0) {
          bounds.rows.forEach((row, i) => {
            console.log(`  行 ${i}: y=${row.topY} ~ ${row.bottomY}, 高度=${row.height}`);
          });
        }

        if (bounds.cols.length > 0) {
          bounds.cols.forEach((col, i) => {
            console.log(`  列 ${i}: x=${col.leftX} ~ ${col.rightX}, 宽度=${col.width}`);
          });
        }

        const boundsIcons = calculateIconPositionsFromBounds(bounds);

        // 绘制行列边界线（始终显示，选中的更明显）
        const rowStrokeColor = isSelected ? '#22C55E' : 'rgba(34, 197, 94, 0.4)';
        const rowLineWidth = isSelected ? 2 : 1;
        const colStrokeColor = isSelected ? '#EF4444' : 'rgba(239, 68, 68, 0.4)';
        const colLineWidth = isSelected ? 2 : 1;

        // 绘制行边界（绿色横线）
        bounds.rows.forEach((row) => {
          ctx.strokeStyle = rowStrokeColor;
          ctx.lineWidth = rowLineWidth;
          ctx.beginPath();
          ctx.moveTo(scanX, row.topY);
          ctx.lineTo(scanX + scanWidth, row.topY);
          ctx.stroke();
          ctx.moveTo(scanX, row.bottomY);
          ctx.lineTo(scanX + scanWidth, row.bottomY);
          ctx.stroke();

          // 只在选中时标注行号
          if (isSelected) {
            ctx.fillStyle = '#22C55E';
            ctx.font = '10px Arial';
            ctx.fillText(`行${row.rowIndex}: y=${Math.round(row.topY)}~${Math.round(row.bottomY)}`, scanX + 5, row.topY - 3);
          }
        });

        // 绘制列边界（红色竖线）
        const colScanHeight = bounds.rows.length > 0 ? bounds.rows[0].height : scanHeight;
        if (isSelected) {
          ctx.fillStyle = 'rgba(239, 68, 68, 0.1)';
          ctx.fillRect(scanX, scanY, scanWidth, colScanHeight);
          ctx.strokeStyle = 'rgba(239, 68, 68, 0.5)';
          ctx.lineWidth = 1;
          ctx.strokeRect(scanX, scanY, scanWidth, colScanHeight);
        }

        bounds.cols.forEach((col) => {
          ctx.strokeStyle = colStrokeColor;
          ctx.lineWidth = colLineWidth;
          ctx.beginPath();
          ctx.moveTo(col.leftX, scanY);
          ctx.lineTo(col.leftX, scanY + colScanHeight);
          ctx.stroke();
          ctx.moveTo(col.rightX, scanY);
          ctx.lineTo(col.rightX, scanY + colScanHeight);
          ctx.stroke();

          if (isSelected) {
            ctx.fillStyle = '#EF4444';
            ctx.font = '10px Arial';
            ctx.fillText(`列${col.colIndex}: x=${Math.round(col.leftX)}~${Math.round(col.rightX)}`, col.leftX + 3, scanY + 12);
          }
        });

        // 绘制红色框（使用边界检测计算的精确边界）
        const validIcons = boundsIcons.filter((icon) => {
          if (!params.filterEmptyIcons) return true;

          const variance = calculateColorVariance(
            imageData,
            icon.leftX,
            icon.topY,
            icon.width,
            icon.height
          );

          const isEmpty = variance < params.emptyIconVarianceThreshold;
          if (isEmpty) {
            console.log(`  [过滤空图标] [${icon.row},${icon.col}] 方差=${variance.toFixed(2)} < 阈值=${params.emptyIconVarianceThreshold}`);
          }

          return !isEmpty;
        });

        console.log(`[空图标过滤] 原始图标数=${boundsIcons.length}, 有效图标数=${validIcons.length}, 过滤掉=${boundsIcons.length - validIcons.length}个`);

        if (isSelected) {
          ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
          ctx.fillRect(scanX + scanWidth - 160, scanY, 160, 70);
          ctx.fillStyle = '#FFFFFF';
          ctx.font = '12px Arial';
          ctx.fillText(`检测到: ${bounds.rows.length}行 × ${bounds.cols.length}列`, scanX + scanWidth - 155, scanY + 15);
          ctx.fillText(`预计图标: ${bounds.rows.length * bounds.cols.length}个`, scanX + scanWidth - 155, scanY + 32);
          ctx.fillText(`合成物数量: ${validIcons.length}个`, scanX + scanWidth - 155, scanY + 49);
          ctx.fillText(`列扫描高度: ${Math.round(colScanHeight)}px`, scanX + scanWidth - 155, scanY + 66);
        }

        // 绘制有效的红色框
        validIcons.forEach((icon, iconIndex) => {
          const { leftX, topY, width, height, centerX, centerY, row, col } = icon;

          console.log(`  合成物 #${iconIndex}: 行${row}列${col}, 位置(${Math.round(centerX)}, ${Math.round(centerY)})`);

          let drawLeftX = leftX;
          let drawTopY = topY;
          let drawWidth = width;
          let drawHeight = height;
          let drawCenterX = centerX;
          let drawCenterY = centerY;

          if (params.forceSquareIcons) {
            const squareSize = height;
            drawWidth = squareSize;
            drawHeight = squareSize;
            drawLeftX = centerX - squareSize / 2;
            drawTopY = centerY - squareSize / 2;

            drawLeftX += params.forceSquareOffsetX;
            drawTopY += params.forceSquareOffsetY;
          }

          ctx.strokeStyle = '#EF4444';
          ctx.lineWidth = 2;
          ctx.strokeRect(drawLeftX, drawTopY, drawWidth, drawHeight);

          ctx.fillStyle = '#EF4444';
          ctx.font = 'bold 14px Arial';
          ctx.fillText(`${iconIndex}`, drawLeftX + 5, drawTopY + 18);

          ctx.fillStyle = 'rgba(239, 68, 68, 0.6)';
          ctx.font = '8px monospace';
          ctx.fillText(`[${row},${col}]`, drawLeftX + drawWidth - 25, drawTopY + drawHeight - 3);

          ctx.fillStyle = '#EF4444';
          ctx.font = '9px monospace';
          ctx.fillText(
            `(${Math.round(drawLeftX)}, ${Math.round(drawTopY)}) ${Math.round(drawWidth)}x${Math.round(drawHeight)}`,
            drawLeftX + 3,
            drawTopY + drawHeight - 3
          );

          if (isSelected) {
            ctx.fillStyle = '#FF00FF';
            ctx.beginPath();
            ctx.arc(drawCenterX, drawCenterY, 3, 0, 2 * Math.PI);
            ctx.fill();
          }
        });

        // 生成 redBoxes 数据
        const redBoxes = validIcons.map((icon, iconIndex) => {
          const { leftX, topY, width, height, centerX, centerY, row, col } = icon;

          let drawLeftX = leftX;
          let drawTopY = topY;
          let drawWidth = width;
          let drawHeight = height;

          if (params.forceSquareIcons) {
            const squareSize = height;
            drawWidth = squareSize;
            drawHeight = squareSize;
            drawLeftX = centerX - squareSize / 2;
            drawTopY = centerY - squareSize / 2;

            drawLeftX += params.forceSquareOffsetX;
            drawTopY += params.forceSquareOffsetY;
          }

          return {
            x: drawLeftX,
            y: drawTopY,
            width: drawWidth,
            height: drawHeight,
            iconIndex,
            row,
            col,
          };
        });

        // 更新 currentDetectedPanels[i].redBoxes
        currentDetectedPanels[i].redBoxes = redBoxes;

        // 绘制扫描线（用于调试）
        if (isSelected) {
          ctx.strokeStyle = '#FFA500';
          ctx.lineWidth = 1;
          ctx.setLineDash([5, 5]);
          ctx.beginPath();
          ctx.moveTo(params.scanLineX, 0);
          ctx.lineTo(params.scanLineX, canvas.height);
          ctx.stroke();
          ctx.setLineDash([]);

          const { data } = imageData;
          const getPixelColor = (x: number, y: number): [number, number, number] => {
            const index = (y * imageData.width + x) * 4;
            return [data[index], data[index + 1], data[index + 2]];
          };
          const backgroundColor = getPixelColor(params.scanLineX, params.scanStartY);

          for (let y = params.scanStartY; y < canvas.height; y += 20) {
            const currentColor = getPixelColor(params.scanLineX, y);
            const diff = colorDiff(currentColor, backgroundColor);

            if (diff > params.colorTolerance) {
              ctx.fillStyle = '#FF0000';
              ctx.fillRect(params.scanLineX - 2, y, 4, 4);
            }
          }

          ctx.fillStyle = '#FFA500';
          ctx.font = '12px monospace';
          ctx.fillText(`X=${params.scanLineX}, T=${params.colorTolerance}, S=${params.sustainedPixels}`, params.scanLineX + 5, params.scanStartY - 10);
        }
      }

      // 3.3 🌟 再次遍历所有panel，使用归一化后的宽度绘制并检测图标
      for (let i = 0; i < Math.min(debugPanels.length, panelRanges.length); i++) {
        const panel = debugPanels[i];
        const range = panelRanges[i];
        const isSelected = i === selectedPanelIndex;

        // 绘制时的详细日志（只记录选中的面板）
        if (isSelected) {
          console.log(`\n========== [drawCanvas] 面板 ${i + 1} (${panel.title}) 坐标计算 ==========`);
          console.log(`[Y轴检测结果]`);
          console.log(`  startY = ${range.startY}, endY = ${range.endY}, height = ${range.height}`);
          console.log(`[X轴检测结果]`);
          console.log(`  startX = ${range.startX}, endX = ${range.endX}, width = ${range.width}`);
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
        // 🌟 绿框宽度使用归一化后的蓝框宽度
        const greenBoxWidth = currentDetectedPanels[i]?.blueBox.width || range.width;
        ctx.strokeRect(range.startX, range.startY, greenBoxWidth, params.gridStartY);

        // 绘制绿框坐标
        ctx.fillStyle = '#22C55E';
        ctx.font = '10px monospace';
        ctx.fillText(
          `(${Math.round(range.startX)}, ${Math.round(range.startY)})`,
          range.startX + 5,
          range.startY + 24
        );

        // 绘制中间横线（用于调试X轴检测）
        if (isSelected) {
          const midY = Math.round((range.startY + range.endY) / 2);
          ctx.strokeStyle = '#00FF00'; // 绿色
          ctx.lineWidth = 1;
          ctx.setLineDash([3, 3]);
          ctx.beginPath();
          ctx.moveTo(range.startX, midY);
          ctx.lineTo(range.endX, midY);
          ctx.stroke();
          ctx.setLineDash([]);

          ctx.fillStyle = '#00FF00';
          ctx.font = '10px monospace';
          ctx.fillText(`midY=${midY}`, range.startX + 5, midY - 5);
        }

        // 使用边界检测方法检测图标位置
        console.log(`[检测方法] 使用边界检测方法`);

        // 缩小扫描范围10像素，减少边界噪音
        const padding = 10;
        const scanX = range.startX + padding;

        // 🌟 核心修改 1：让扫描的起始 Y 坐标直接跳过绿框（标题区域）
        // 原代码：const scanY = range.startY + padding;
        const scanY = range.startY + params.gridStartY + padding;

        const scanWidth = range.width - padding * 2;

        // 🌟 核心修改 2：扫描总高度也要相应减去绿框的高度
        // 原代码：const scanHeight = range.height - padding * 2;
        const scanHeight = range.height - params.gridStartY - padding * 2;

        console.log(`[扫描范围] 原始: (${range.startX}, ${range.startY}) ${range.width}x${range.height}`);
        console.log(`[扫描范围] 缩小: (${scanX}, ${scanY}) ${scanWidth}x${scanHeight}`);

        const bounds = detectAllBounds(
          Buffer.from(imageData.data),
          canvas.width,
          scanX,
          scanY,
          scanWidth,
          scanHeight,
          {
            windowHeight: params.boundsWindowHeight,
            windowWidth: params.boundsWindowWidth,
            varianceThresholdRow: params.boundsVarianceThresholdRow,
            varianceThresholdCol: params.boundsVarianceThresholdCol,
            stepSize: params.boundsStepSize,
            minRowHeight: params.boundsMinRowHeight,
            minColWidth: params.boundsMinColWidth,
          }
        );

        console.log(`[边界检测] Panel: ${panel.title}`);
        console.log(`  检测到 ${bounds.rows.length} 行, ${bounds.cols.length} 列`);

        // 显示列检测使用的扫描高度
        if (bounds.rows.length > 0) {
          const colScanHeight = bounds.rows[0].height;
          console.log(`  ✅ 列检测使用第一行高度: ${Math.round(colScanHeight)}px`);
        } else {
          console.log(`  ⚠️ 列检测使用整个panel高度: ${range.height}px (未检测到行)`);
        }

        // 警告：如果没有检测到行列
        if (bounds.rows.length === 0) {
          console.warn(`  ⚠️ 未检测到任何行！请调整行检测参数：`);
          console.warn(`    - 增大窗口高度 (当前: ${params.boundsWindowHeight})`);
          console.warn(`    - 降低行检测方差阈值 (当前: ${params.boundsVarianceThresholdRow})`);
          console.warn(`    - 降低最小行高 (当前: ${params.boundsMinRowHeight})`);
        }

        if (bounds.cols.length === 0) {
          console.warn(`  ⚠️ 未检测到任何列！请调整列检测参数：`);
          console.warn(`    - 增大窗口宽度 (当前: ${params.boundsWindowWidth})`);
          console.warn(`    - 降低列检测方差阈值 (当前: ${params.boundsVarianceThresholdCol})`);
          console.warn(`    - 降低最小列宽 (当前: ${params.boundsMinColWidth})`);
        }

        if (bounds.rows.length > 0) {
          bounds.rows.forEach((row, i) => {
            console.log(`  行 ${i}: y=${row.topY} ~ ${row.bottomY}, 高度=${row.height}`);
          });
        }

        if (bounds.cols.length > 0) {
          bounds.cols.forEach((col, i) => {
            console.log(`  列 ${i}: x=${col.leftX} ~ ${col.rightX}, 宽度=${col.width}`);
          });
        }

        const boundsIcons = calculateIconPositionsFromBounds(bounds);

        // 保存框体坐标
        const blueBox = {
          x: range.startX,
          y: range.startY,
          width: range.width,
          height: range.height,
        };

        const greenBox = {
          x: range.startX,
          y: range.startY,
          width: range.width,
          height: params.gridStartY,
        };

        // 绘制行列边界线（始终显示，选中的更明显）
        const rowStrokeColor = isSelected ? '#22C55E' : 'rgba(34, 197, 94, 0.4)';
        const rowLineWidth = isSelected ? 2 : 1;
        const colStrokeColor = isSelected ? '#EF4444' : 'rgba(239, 68, 68, 0.4)';
        const colLineWidth = isSelected ? 2 : 1;

        // 绘制行边界（绿色横线）
        bounds.rows.forEach((row) => {
          ctx.strokeStyle = rowStrokeColor;
          ctx.lineWidth = rowLineWidth;
          ctx.beginPath();
          ctx.moveTo(scanX, row.topY);
          ctx.lineTo(scanX + scanWidth, row.topY);
          ctx.stroke();
          ctx.moveTo(scanX, row.bottomY);
          ctx.lineTo(scanX + scanWidth, row.bottomY);
          ctx.stroke();

          // 只在选中时标注行号
          if (isSelected) {
            ctx.fillStyle = '#22C55E';
            ctx.font = '10px Arial';
            ctx.fillText(`行${row.rowIndex}: y=${Math.round(row.topY)}~${Math.round(row.bottomY)}`, scanX + 5, row.topY - 3);
          }
        });

        // 绘制列边界（红色竖线）
        // 先绘制列检测的扫描范围（浅色矩形）
        const colScanHeight = bounds.rows.length > 0 ? bounds.rows[0].height : scanHeight;
        if (isSelected) {
          ctx.fillStyle = 'rgba(239, 68, 68, 0.1)'; // 浅红色背景
          ctx.fillRect(scanX, scanY, scanWidth, colScanHeight);
          ctx.strokeStyle = 'rgba(239, 68, 68, 0.5)'; // 半透明红色边框
          ctx.lineWidth = 1;
          ctx.strokeRect(scanX, scanY, scanWidth, colScanHeight);
        }

        // 绘制列边界线（红色竖线）
        bounds.cols.forEach((col) => {
          ctx.strokeStyle = colStrokeColor;
          ctx.lineWidth = colLineWidth;
          ctx.beginPath();
          ctx.moveTo(col.leftX, scanY);
          ctx.lineTo(col.leftX, scanY + colScanHeight);
          ctx.stroke();
          ctx.moveTo(col.rightX, scanY);
          ctx.lineTo(col.rightX, scanY + colScanHeight);
          ctx.stroke();

          // 只在选中时标注列号
          if (isSelected) {
            ctx.fillStyle = '#EF4444';
            ctx.font = '10px Arial';
            ctx.fillText(`列${col.colIndex}: x=${Math.round(col.leftX)}~${Math.round(col.rightX)}`, col.leftX + 3, scanY + 12);
          }
        });

        // 绘制红色框（使用边界检测计算的精确边界）
        // 🌟 新功能：过滤空图标（没有内容的方框）
        const validIcons = boundsIcons.filter((icon) => {
          if (!params.filterEmptyIcons) return true;

          // 🌟 计算方差时使用原始边界（不应用1:1强制）
          // 这样可以避免1:1偏移影响方差计算，过滤结果更准确
          const variance = calculateColorVariance(
            imageData,
            icon.leftX,    // 使用原始边界
            icon.topY,
            icon.width,
            icon.height
          );

          // 如果方差小于阈值，认为是空图标，过滤掉
          const isEmpty = variance < params.emptyIconVarianceThreshold;
          if (isEmpty) {
            console.log(`  [过滤空图标] [${icon.row},${icon.col}] 方差=${variance.toFixed(2)} < 阈值=${params.emptyIconVarianceThreshold}`);
          }

          return !isEmpty;
        });

        console.log(`[空图标过滤] 原始图标数=${boundsIcons.length}, 有效图标数=${validIcons.length}, 过滤掉=${boundsIcons.length - validIcons.length}个`);
        console.log(`[合成链信息] 该合成链包含 ${validIcons.length} 个合成物（小panel）`);
        console.log(`  🌟 合成物数量: ${validIcons.length} 个（过滤掉 ${boundsIcons.length - validIcons.length} 个空方框）`);
        console.log(`  📐 方差计算：基于原始边界（不应用1:1强制）`);
        console.log(`  📐 1:1强制：只在绘制和导出时应用`);
        if (params.forceSquareIcons) {
          console.log(`  📐 偏移校准：X=${params.forceSquareOffsetX}px, Y=${params.forceSquareOffsetY}px`);
        }

        // 只在选中时显示检测统计和调试信息（在validIcons声明之后）
        if (isSelected) {
          ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
          ctx.fillRect(scanX + scanWidth - 160, scanY, 160, 70);
          ctx.fillStyle = '#FFFFFF';
          ctx.font = '12px Arial';
          ctx.fillText(`检测到: ${bounds.rows.length}行 × ${bounds.cols.length}列`, scanX + scanWidth - 155, scanY + 15);
          ctx.fillText(`预计图标: ${bounds.rows.length * bounds.cols.length}个`, scanX + scanWidth - 155, scanY + 32);
          ctx.fillText(`合成物数量: ${validIcons.length}个`, scanX + scanWidth - 155, scanY + 49);
          ctx.fillText(`列扫描高度: ${Math.round(colScanHeight)}px`, scanX + scanWidth - 155, scanY + 66);
        }

        // 绘制有效的红色框
        validIcons.forEach((icon, iconIndex) => {
          const { leftX, topY, width, height, centerX, centerY, row, col } = icon;

          console.log(`  合成物 #${iconIndex}: 行${row}列${col}, 位置(${Math.round(centerX)}, ${Math.round(centerY)})`);

          // 如果强制1:1比例，使用行高度作为图标尺寸
          let drawLeftX = leftX;
          let drawTopY = topY;
          let drawWidth = width;
          let drawHeight = height;
          let drawCenterX = centerX;
          let drawCenterY = centerY;

          if (params.forceSquareIcons) {
            // 使用行高度作为正方形尺寸（通常行检测更稳定）
            const squareSize = height;

            // 重新计算位置，保持中心点不变
            drawWidth = squareSize;
            drawHeight = squareSize;
            drawLeftX = centerX - squareSize / 2;
            drawTopY = centerY - squareSize / 2;

            // 🌟 应用偏移校准
            drawLeftX += params.forceSquareOffsetX;
            drawTopY += params.forceSquareOffsetY;
          }

          ctx.strokeStyle = '#EF4444';
          ctx.lineWidth = 2;
          ctx.strokeRect(drawLeftX, drawTopY, drawWidth, drawHeight);

          // 🌟 绘制线性序号（从左到右、从上到下，从0开始）
          ctx.fillStyle = '#EF4444';
          ctx.font = 'bold 14px Arial';
          ctx.fillText(`${iconIndex}`, drawLeftX + 5, drawTopY + 18);

          // 绘制行列信息（小字，右下角）
          ctx.fillStyle = 'rgba(239, 68, 68, 0.6)';
          ctx.font = '8px monospace';
          ctx.fillText(`[${row},${col}]`, drawLeftX + drawWidth - 25, drawTopY + drawHeight - 3);

          // 绘制红框坐标
          ctx.fillStyle = '#EF4444';
          ctx.font = '9px monospace';
          ctx.fillText(
            `(${Math.round(drawLeftX)}, ${Math.round(drawTopY)}) ${Math.round(drawWidth)}x${Math.round(drawHeight)}`,
            drawLeftX + 3,
            drawTopY + drawHeight - 3
          );

          // 绘制中心点标记
          if (isSelected) {
            ctx.fillStyle = '#FF00FF';
            ctx.beginPath();
            ctx.arc(drawCenterX, drawCenterY, 3, 0, 2 * Math.PI);
            ctx.fill();
          }
        });

        // 生成 redBoxes 数据（用于导出）
        const redBoxes = validIcons.map((icon, iconIndex) => {
          const { leftX, topY, width, height, centerX, centerY, row, col } = icon;

          // 计算绘制时的实际坐标（考虑1:1强制）
          let drawLeftX = leftX;
          let drawTopY = topY;
          let drawWidth = width;
          let drawHeight = height;

          if (params.forceSquareIcons) {
            const squareSize = height;
            drawWidth = squareSize;
            drawHeight = squareSize;
            drawLeftX = centerX - squareSize / 2;
            drawTopY = centerY - squareSize / 2;

            // 🌟 应用偏移校准
            drawLeftX += params.forceSquareOffsetX;
            drawTopY += params.forceSquareOffsetY;
          }

          return {
            x: drawLeftX,
            y: drawTopY,
            width: drawWidth,
            height: drawHeight,
            iconIndex,  // 🌟 添加线性序号（从0开始）
            row,         // 保留行列信息
            col,
          };
        });

        // 更新 currentDetectedPanels[i].redBoxes
        currentDetectedPanels[i].redBoxes = redBoxes;

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

      // 🌟 宽度归一化
      if (currentDetectedPanels.length > 0) {
        const widthStats = normalizePanelWidths(currentDetectedPanels);
        if (widthStats.applied) {
          console.log(`[drawCanvas] ✅ 宽度归一化已应用：目标宽度 ${widthStats.targetWidth}px，影响 ${widthStats.affectedCount} 个面板`);

          // 🌟 更新 panelRanges，让 Canvas 绘制蓝框时使用归一化后的宽度
          for (let i = 0; i < currentDetectedPanels.length; i++) {
            const panel = currentDetectedPanels[i];
            if (panel.width !== panelRanges[i].width) {
              console.log(`[Canvas绘制] Panel ${i + 1}: 更新蓝框宽度 ${panelRanges[i].width}px → ${panel.width}px`);
              panelRanges[i].width = panel.width;
              panelRanges[i].endX = panelRanges[i].startX + panel.width;
            }
          }

          // 添加归一化日志
          const logMessages = [
            '',
            '='.repeat(60),
            '🎯 宽度归一化结果',
            '='.repeat(60),
            `目标宽度: ${widthStats.targetWidth}px`,
            `影响面板: ${widthStats.affectedCount} / ${currentDetectedPanels.length} 个`,
            '',
            '归一化详情:',
            ...widthStats.normalizedPanels.map(p => `  Panel ${p.panelIndex + 1} [${p.title}]: ${p.oldWidth}px → ${p.newWidth}px`),
            '='.repeat(60),
            ''
          ];
          logMessages.forEach(msg => console.log(msg));
        } else {
          console.log(`[drawCanvas] ⚠️ 宽度归一化未应用（不满足归一化条件）`);
        }
      }

      // 保存所有框体坐标到状态
      setDetectedPanels(currentDetectedPanels);
      console.log(`[drawCanvas] 已保存 ${currentDetectedPanels.length} 个面板的框体坐标`);

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
    };

    // 图片加载错误处理
    img.onerror = () => {
      console.error('图片加载失败:', imageUrl);
    };

    // 设置图片源（触发加载）
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
        logInfo('📋 当前检测参数:', params);
        const processRes = await fetch('/api/process-image-stream', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            filenames: [uploadedFilename],
            debug: true,
            params: params,  // 传递当前检测参数
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
        let fullSSEContent = '';  // 收集完整的 SSE 内容

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

        // 使用更健壮的 SSE 解析逻辑（与工作台一致）
        logInfo('开始解析 SSE 流...');

        // 按 SSE 协议规范解析：每个事件以 "event:" 开头，以空行结束
        const lines = fullSSEContent.split('\n');
        let currentEvent = '';
        let currentData = '';
        let isReadingData = false;

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
            // 空行表示事件结束，处理当前事件
            try {
              const data = JSON.parse(currentData);
              eventCount++;
              logInfo(`收到事件 ${eventCount}: ${currentEvent}`, data);

              if (currentEvent === 'debug_complete') {
                logInfo('✓ Debug模式完成，面板数据:', data.debugPanels);
                setDebugPanels(data.debugPanels);
                // 设置图片URL - 使用正确的API路由
                setImageUrl(`/api/uploads/wiki/${uploadedFilename}`);
                logInfo('✓ 图片URL已设置:', `/api/uploads/wiki/${uploadedFilename}`);
              } else if (currentEvent === 'error') {
                console.error('✗ 收到错误事件:', data);
                console.error('✗ 错误详情:', JSON.stringify(data));
                console.error('✗ 原始数据:', currentData);

                let errorMessage = data.message || '处理过程中发生错误';

                // 为Y轴检测失败添加友好提示
                if (errorMessage.includes('Y轴检测失败') || errorMessage.includes('未检测到任何面板')) {
                  errorMessage += '\n\n💡 建议：请调整检测参数后再试：\n' +
                    '1. 调整 scanLineX（当前值：' + params.scanLineX + '）：改变X轴扫描位置\n' +
                    '2. 调整 scanStartY（当前值：' + params.scanStartY + '）：改变Y轴扫描起始位置\n' +
                    '3. 调整 colorTolerance（当前值：' + params.colorTolerance + '）：调整颜色容差\n' +
                    '4. 调整 sustainedPixels（当前值：' + params.sustainedPixels + '）：调整连续像素阈值';
                }

                throw new Error(errorMessage);
              }
            } catch (e) {
              console.error(`Failed to parse SSE data for event ${currentEvent}:`, e, '原始数据:', currentData.substring(0, 100));
              throw e;
            }

            currentEvent = '';
            currentData = '';
            isReadingData = false;
          } else if (isReadingData && trimmedLine.startsWith('{')) {
            // 多行 JSON 数据（虽然当前后端不使用，但为了兼容性）
            currentData += '\n' + trimmedLine;
          }
        }

        // 处理最后一个事件（如果没有空行结束）
        if (currentEvent && currentData) {
          try {
            const data = JSON.parse(currentData);
            eventCount++;
            logInfo(`收到事件 ${eventCount}: ${currentEvent}`, data);

            if (currentEvent === 'debug_complete') {
              logInfo('✓ Debug模式完成，面板数据:', data.debugPanels);
              setDebugPanels(data.debugPanels);
              setImageUrl(`/api/uploads/wiki/${uploadedFilename}`);
              logInfo('✓ 图片URL已设置:', `/api/uploads/wiki/${uploadedFilename}`);
            } else if (currentEvent === 'error') {
              console.error('✗ 收到错误事件:', data);
              throw new Error(data.message || '处理过程中发生错误');
            }
          } catch (e) {
            console.error(`Failed to parse SSE data for event ${currentEvent}:`, e, '原始数据:', currentData.substring(0, 100));
            throw e;
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
  const handleParamChange = (key: keyof typeof DEFAULT_PARAMS, value: number | boolean) => {
    const newParams = { ...params, [key]: value };
    setParams(newParams);

    // 实时保存到 localStorage
    saveParamsToStorage(newParams);

    // 🌟 调试日志：记录参数变更
    console.log(`[参数变更] ${key}: ${params[key]} → ${value}`);

    // 🌟 立即验证 localStorage 是否正确保存
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        const savedValue = parsed[key];
        console.log(`[LocalStorage验证] ${key} 已保存为: ${savedValue}`);

        if (savedValue !== value) {
          console.error(`❌ [LocalStorage保存失败] 期望: ${value}, 实际: ${savedValue}`);
        }
      }
    } catch (e) {
      console.error('[LocalStorage验证] 检查失败:', e);
    }
  };

  // 恢复默认值
  const handleResetToDefault = () => {
    if (window.confirm('确定要恢复所有参数为默认值吗？')) {
      setParams(DEFAULT_PARAMS);
      // 清除 localStorage
      localStorage.removeItem(STORAGE_KEY);
    }
  };

  // 🌟 重置为新默认值（解决LocalStorage旧值覆盖问题）
  const handleResetToNewDefaults = () => {
    if (window.confirm('确定要重置为新默认值吗？\n\n这将清除旧配置并应用最新的默认参数（包括Y轴偏移=2）。')) {
      setParams(DEFAULT_PARAMS);
      // 清除 localStorage 中的旧配置
      localStorage.removeItem(STORAGE_KEY);
      // 重新保存新的默认值
      saveParamsToStorage(DEFAULT_PARAMS);
      alert('✅ 已重置为新默认值！\n\nY轴偏移已设置为 2px');
    }
  };

  // 应用优化参数（基于实际调试测试）
  const handleApplyOptimizedParams = () => {
    const OPTIMIZED_PARAMS = {
      boundsVarianceThresholdCol: 100,
      boundsMinRowHeight: 135,
      boundsMinColWidth: 135,
      forceSquareOffsetX: -6,
      forceSquareOffsetY: 0,
      emptyIconVarianceThreshold: 20,
    };

    if (window.confirm('确定要应用优化参数吗？\n\n这将更新以下参数：\n' +
      Object.entries(OPTIMIZED_PARAMS)
        .map(([key, value]) => `${key}: ${value}`)
        .join('\n'))) {
      const newParams = { ...params, ...OPTIMIZED_PARAMS };
      setParams(newParams);
      // 保存到 localStorage
      saveParamsToStorage(newParams);
      alert('优化参数已应用！');
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
          // 🌟 只合并当前调试台支持的参数，过滤废弃参数
          const validParams: Partial<typeof DEFAULT_PARAMS> = {};
          Object.keys(DEFAULT_PARAMS).forEach(key => {
            if (key in parsed.params) {
              validParams[key as keyof typeof DEFAULT_PARAMS] = parsed.params[key];
            }
          });

          const newParams = { ...DEFAULT_PARAMS, ...validParams };

          // 🌟 检测到废弃参数时给出提示
          const deprecatedKeys = Object.keys(parsed.params).filter(
            key => !(key in DEFAULT_PARAMS)
          );
          if (deprecatedKeys.length > 0) {
            console.warn('[导入配置] 检测到废弃参数，已忽略:', deprecatedKeys);
            alert(`配置导入成功！\n\n注意：已忽略 ${deprecatedKeys.length} 个废弃参数：\n${deprecatedKeys.join(', ')}`);
          } else {
            alert('配置导入成功！');
          }

          setParams(newParams);
          // 保存到 localStorage
          saveParamsToStorage(newParams);
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
    console.log('[导出函数] 开始执行');
    console.log(`[导出函数] imageUrl=${imageUrl}, debugPanels.length=${debugPanels.length}`);
    console.log(`[导出函数] detectedPanels.length=${detectedPanels.length}`);

    if (!imageUrl || debugPanels.length === 0) {
      alert('请先上传图片并完成面板调试');
      return;
    }

    if (detectedPanels.length === 0) {
      alert('未检测到任何框体坐标，请调整参数或重新上传图片');
      return;
    }

    console.log('[导出函数] 开始处理');
    setIsProcessing(true);

    try {
      // 直接使用 Canvas 上保存的框体坐标
      logInfo('\n========== 使用保存的框体坐标 ==========');
      logInfo(`已保存 ${detectedPanels.length} 个面板的框体坐标`);

      // 收集所有面板的坐标数据
      const exportPanels = detectedPanels.map((detectedPanel, i) => {
        const panel = debugPanels[i];

        // 详细日志
        logInfo(`\n========== 面板 ${i + 1} (${panel.title}) 坐标信息 ==========`);
        logInfo(`[蓝框坐标]`);
        logInfo(`  x=${detectedPanel.blueBox.x}, y=${detectedPanel.blueBox.y}`);
        logInfo(`  width=${detectedPanel.blueBox.width}, height=${detectedPanel.blueBox.height}`);
        logInfo(`[绿框坐标]`);
        logInfo(`  x=${detectedPanel.greenBox.x}, y=${detectedPanel.greenBox.y}`);
        logInfo(`  width=${detectedPanel.greenBox.width}, height=${detectedPanel.greenBox.height}`);
        logInfo(`[红框坐标]`);
        logInfo(`  检测到 ${detectedPanel.redBoxes.length} 个图标`);
        logInfo(`  🌟 合成物数量: ${detectedPanel.redBoxes.length} 个`);
        logInfo(`  最终坐标:`);
        logInfo(`    BlueBox: x=${Math.round(detectedPanel.blueBox.x)}, y=${Math.round(detectedPanel.blueBox.y)}, w=${Math.round(detectedPanel.blueBox.width)}, h=${Math.round(detectedPanel.blueBox.height)}`);
        logInfo(`    GreenBox: x=${Math.round(detectedPanel.greenBox.x)}, y=${Math.round(detectedPanel.greenBox.y)}, w=${Math.round(detectedPanel.greenBox.width)}, h=${Math.round(detectedPanel.greenBox.height)}`);
        logInfo(`    RedBox Count: ${detectedPanel.redBoxes.length}`);

        return {
          title: panel.title,
          x: detectedPanel.blueBox.x,
          y: detectedPanel.blueBox.y,
          width: detectedPanel.blueBox.width,
          height: detectedPanel.blueBox.height,
          rows: panel.rows,
          cols: panel.cols,
          total: panel.total,
          compositeCount: detectedPanel.redBoxes.length,  // 🌟 合成物数量（有效图标数量）
          imageUrl: imageUrl,
          blueBox: detectedPanel.blueBox,
          greenBox: detectedPanel.greenBox,
          redBoxes: detectedPanel.redBoxes,
        };
      });

      // 显示调试信息
      const debugInfo = exportPanels.map((p, i) =>
        `面板${i + 1}: x=${p.x}, y=${p.y}, w=${p.width}, h=${p.height}, 合成物=${p.compositeCount}个`
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

        // 🌟 从 imageUrl 中提取图片名称
        const imageName = imageUrl.includes('/')
          ? imageUrl.split('/').pop()?.split('.')[0]
          : 'default';

        alert(`裁切成功！共裁切 ${result.total} 个icon\n\n结果已保存到 public/wiki-cropped/${imageName}/`);
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
              <CardContent className="flex justify-center items-center">
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
                  {debugPanels.map((panel, idx) => {
                    const compositeCount = detectedPanels[idx]?.redBoxes?.length || 0;
                    return (
                      <Button
                        key={idx}
                        variant={selectedPanelIndex === idx ? 'default' : 'outline'}
                        onClick={() => setSelectedPanelIndex(idx)}
                        className="w-full justify-between"
                      >
                        <span>{panel.title} ({panel.rows}x{panel.cols})</span>
                        <span className="ml-2 bg-purple-100 text-purple-700 px-2 py-0.5 rounded text-xs">
                          {compositeCount}个合成物
                        </span>
                      </Button>
                    );
                  })}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>调试参数</CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* 蓝框坐标 - 自动检测 */}
                <div className="border-l-4 border-blue-500 pl-4 bg-blue-50 p-3 rounded">
                  <Label className="text-sm font-semibold text-blue-600 mb-3 block">
                    蓝框坐标（扫描线自动检测）
                  </Label>
                  <div className="text-sm text-gray-700 space-y-2">
                    <p>
                      <strong>X范围：</strong>
                      {selectedPanelIndex < detectedPanels.length ? (
                        <>
                          {Math.round(detectedPanels[selectedPanelIndex]?.blueBox.x || 0)} ~{' '}
                          {Math.round((detectedPanels[selectedPanelIndex]?.blueBox.x || 0) + (detectedPanels[selectedPanelIndex]?.blueBox.width || 0))}
                        </>
                      ) : '未检测'}
                    </p>
                    <p>
                      <strong>Y范围：</strong>
                      {selectedPanelIndex < detectedPanels.length ? (
                        <>
                          {Math.round(detectedPanels[selectedPanelIndex]?.blueBox.y || 0)} ~{' '}
                          {Math.round((detectedPanels[selectedPanelIndex]?.blueBox.y || 0) + (detectedPanels[selectedPanelIndex]?.blueBox.height || 0))}
                        </>
                      ) : '未检测'}
                    </p>
                    <p>
                      <strong>尺寸：</strong>
                      {selectedPanelIndex < detectedPanels.length ? (
                        <>
                          {Math.round(detectedPanels[selectedPanelIndex]?.blueBox.width || 0)} ×{' '}
                          {Math.round(detectedPanels[selectedPanelIndex]?.blueBox.height || 0)}
                        </>
                      ) : '未检测'}
                    </p>
                    <p>
                      <strong>🌟 合成物数量：</strong>
                      {selectedPanelIndex < detectedPanels.length ? (
                        <span className="text-purple-600 font-bold">
                          {detectedPanels[selectedPanelIndex]?.redBoxes?.length || 0} 个
                        </span>
                      ) : '未检测'}
                    </p>
                  </div>
                  <p className="text-xs text-blue-600 mt-2 italic">
                    注：蓝框坐标由扫描线自动检测，无需手动调整
                  </p>
                </div>

                {/* 绿框相关 */}
                <div className="border-l-4 border-green-500 pl-4">
                  <Label className="text-sm font-semibold text-green-600 mb-3 block">绿框相关 (Title)</Label>
                  <div className="space-y-4">
                    <div>
                      <Label className="text-xs font-medium text-gray-600">标题区域高度 (Grid Start Y)</Label>
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

                        <div className="border-t pt-4 mt-4">
                          <Label className="text-xs font-semibold text-orange-600 mb-3 block">多行图标检测 (Multi-row Icons)</Label>
                          <div className="space-y-4">
                            <div>
                              <Label className="text-xs font-medium text-gray-600">第一行图标线偏移 (Icon Line Offset)</Label>
                              <div className="flex items-center gap-3 mt-2">
                                <Slider
                                  value={[params.iconLineOffset]}
                                  onValueChange={([v]) => handleParamChange('iconLineOffset', v)}
                                  min={50}
                                  max={300}
                                  step={1}
                                  className="flex-1"
                                />
                                <Input
                                  type="number"
                                  value={params.iconLineOffset}
                                  onChange={(e) => handleParamChange('iconLineOffset', parseInt(e.target.value) || 0)}
                                  className="w-20 text-center text-sm"
                                />
                              </div>
                              <p className="text-xs text-gray-500 mt-1">第一行icon检测线相对于panel顶部的偏移</p>
                            </div>

                            <div>
                              <Label className="text-xs font-medium text-gray-600">多行图标线间距 (Icon Line Gap)</Label>
                              <div className="flex items-center gap-3 mt-2">
                                <Slider
                                  value={[params.iconLineGap]}
                                  onValueChange={([v]) => handleParamChange('iconLineGap', v)}
                                  min={100}
                                  max={300}
                                  step={1}
                                  className="flex-1"
                                />
                                <Input
                                  type="number"
                                  value={params.iconLineGap}
                                  onChange={(e) => handleParamChange('iconLineGap', parseInt(e.target.value) || 0)}
                                  className="w-20 text-center text-sm"
                                />
                              </div>
                              <p className="text-xs text-gray-500 mt-1">多行icon检测线之间的间距</p>
                            </div>

                            <div>
                              <Label className="text-xs font-medium text-gray-600">每行最小图标数量 (Min Icons Per Line)</Label>
                              <div className="flex items-center gap-3 mt-2">
                                <Slider
                                  value={[params.minIconsPerLine]}
                                  onValueChange={([v]) => handleParamChange('minIconsPerLine', v)}
                                  min={1}
                                  max={10}
                                  step={1}
                                  className="flex-1"
                                />
                                <Input
                                  type="number"
                                  value={params.minIconsPerLine}
                                  onChange={(e) => handleParamChange('minIconsPerLine', parseInt(e.target.value) || 0)}
                                  className="w-20 text-center text-sm"
                                />
                              </div>
                              <p className="text-xs text-gray-500 mt-1">达到此数量才检测下一行</p>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Bounds Detection */}
                <div className="border-l-4 border-indigo-500 pl-4 bg-indigo-50 p-3 rounded">
                  <Label className="text-sm font-semibold text-indigo-600 mb-3 block">Bounds Detection</Label>
                  <p className="text-xs text-indigo-700 mb-3">
                    Use sliding window color variance to detect row and column boundaries precisely.
                  </p>

                  <div className="space-y-4">
                    <div>
                      <Label className="text-xs font-medium text-gray-600">检测窗口高度 (Window Height)</Label>
                      <div className="flex items-center gap-3 mt-2">
                        <Slider
                          value={[params.boundsWindowHeight]}
                          onValueChange={([v]) => handleParamChange('boundsWindowHeight', v)}
                          min={1}
                          max={20}
                          step={1}
                          className="flex-1"
                        />
                        <Input
                          type="number"
                          value={params.boundsWindowHeight}
                          onChange={(e) => handleParamChange('boundsWindowHeight', parseInt(e.target.value) || 0)}
                          className="w-20 text-center text-sm"
                        />
                      </div>
                      <p className="text-xs text-gray-500 mt-1">纵向检测窗口高度（像素），用于检测单行</p>
                    </div>

                    <div>
                      <Label className="text-xs font-medium text-gray-600">检测窗口宽度 (Window Width)</Label>
                      <div className="flex items-center gap-3 mt-2">
                        <Slider
                          value={[params.boundsWindowWidth]}
                          onValueChange={([v]) => handleParamChange('boundsWindowWidth', v)}
                          min={1}
                          max={20}
                          step={1}
                          className="flex-1"
                        />
                        <Input
                          type="number"
                          value={params.boundsWindowWidth}
                          onChange={(e) => handleParamChange('boundsWindowWidth', parseInt(e.target.value) || 0)}
                          className="w-20 text-center text-sm"
                        />
                      </div>
                      <p className="text-xs text-gray-500 mt-1">横向检测窗口宽度（像素），用于检测单列</p>
                    </div>

                    <div>
                      <Label className="text-xs font-medium text-gray-600">行检测方差阈值 (Row Variance)</Label>
                      <div className="flex items-center gap-3 mt-2">
                        <Slider
                          value={[params.boundsVarianceThresholdRow]}
                          onValueChange={([v]) => handleParamChange('boundsVarianceThresholdRow', v)}
                          min={10}
                          max={200}
                          step={5}
                          className="flex-1"
                        />
                        <Input
                          type="number"
                          value={params.boundsVarianceThresholdRow}
                          onChange={(e) => handleParamChange('boundsVarianceThresholdRow', parseInt(e.target.value) || 0)}
                          className="w-20 text-center text-sm"
                        />
                      </div>
                      <p className="text-xs text-gray-500 mt-1">判断是否为行区域的最小方差值（阈值越高越严格）</p>
                    </div>

                    <div>
                      <Label className="text-xs font-medium text-gray-600">列检测方差阈值 (Col Variance)</Label>
                      <div className="flex items-center gap-3 mt-2">
                        <Slider
                          value={[params.boundsVarianceThresholdCol]}
                          onValueChange={([v]) => handleParamChange('boundsVarianceThresholdCol', v)}
                          min={10}
                          max={200}
                          step={5}
                          className="flex-1"
                        />
                        <Input
                          type="number"
                          value={params.boundsVarianceThresholdCol}
                          onChange={(e) => handleParamChange('boundsVarianceThresholdCol', parseInt(e.target.value) || 0)}
                          className="w-20 text-center text-sm"
                        />
                      </div>
                      <p className="text-xs text-gray-500 mt-1">判断是否为列区域的最小方差值（阈值越高越严格）</p>
                    </div>

                    <div>
                      <Label className="text-xs font-medium text-gray-600">扫描步长 (Step Size)</Label>
                      <div className="flex items-center gap-3 mt-2">
                        <Slider
                          value={[params.boundsStepSize]}
                          onValueChange={([v]) => handleParamChange('boundsStepSize', v)}
                          min={1}
                          max={10}
                          step={1}
                          className="flex-1"
                        />
                        <Input
                          type="number"
                          value={params.boundsStepSize}
                          onChange={(e) => handleParamChange('boundsStepSize', parseInt(e.target.value) || 0)}
                          className="w-20 text-center text-sm"
                        />
                      </div>
                      <p className="text-xs text-gray-500 mt-1">滑动窗口每次移动的像素数（步长越小越精确但越慢）</p>
                    </div>

                    <div>
                      <Label className="text-xs font-medium text-gray-600">最小行高 (Min Row Height)</Label>
                      <div className="flex items-center gap-3 mt-2">
                        <Slider
                          value={[params.boundsMinRowHeight]}
                          onValueChange={([v]) => handleParamChange('boundsMinRowHeight', v)}
                          min={5}
                          max={100}
                          step={5}
                          className="flex-1"
                        />
                        <Input
                          type="number"
                          value={params.boundsMinRowHeight}
                          onChange={(e) => handleParamChange('boundsMinRowHeight', parseInt(e.target.value) || 0)}
                          className="w-20 text-center text-sm"
                        />
                      </div>
                      <p className="text-xs text-gray-500 mt-1">过滤噪声的最小行高（像素）</p>
                    </div>

                    <div>
                      <Label className="text-xs font-medium text-gray-600">最小列宽 (Min Col Width)</Label>
                      <div className="flex items-center gap-3 mt-2">
                        <Slider
                          value={[params.boundsMinColWidth]}
                          onValueChange={([v]) => handleParamChange('boundsMinColWidth', v)}
                          min={5}
                          max={100}
                          step={5}
                          className="flex-1"
                        />
                        <Input
                          type="number"
                          value={params.boundsMinColWidth}
                          onChange={(e) => handleParamChange('boundsMinColWidth', parseInt(e.target.value) || 0)}
                          className="w-20 text-center text-sm"
                        />
                      </div>
                      <p className="text-xs text-gray-500 mt-1">过滤噪声的最小列宽（像素）</p>
                    </div>

                    <div className="pt-4 border-t border-indigo-200">
                      <Label className="text-xs font-semibold text-indigo-700 mb-3 block">图标形状设置</Label>
                      <div className="flex items-center justify-between p-3 bg-indigo-100 rounded mb-3">
                        <div>
                          <Label className="text-sm font-medium text-indigo-800">强制1:1比例</Label>
                          <p className="text-xs text-indigo-600 mt-1">输出1:1正方形图标（基于行高度）</p>
                        </div>
                        <input
                          type="checkbox"
                          id="forceSquareIcons"
                          checked={params.forceSquareIcons}
                          onChange={(e) => handleParamChange('forceSquareIcons', e.target.checked)}
                          className="w-5 h-5 text-indigo-600 rounded cursor-pointer"
                        />
                      </div>
                      {params.forceSquareIcons && (
                        <>
                          <div className="p-3 bg-indigo-50 rounded mb-3">
                            <p className="text-xs text-indigo-600">
                              <strong>工作原理：</strong>基于原始边界计算方差和过滤，只在绘制和导出时应用1:1收束，确保输出正方形图标。
                            </p>
                          </div>
                          <div className="p-3 bg-blue-50 rounded mb-3 space-y-3">
                            <Label className="text-sm font-medium text-blue-800 block mb-2">偏移校准（像素）</Label>
                            <div>
                              <div className="flex items-center justify-between mb-1">
                                <Label className="text-xs font-medium text-blue-700">X轴偏移</Label>
                                <span className="text-xs font-bold text-blue-700">{params.forceSquareOffsetX}px</span>
                              </div>
                              <Slider
                                value={[params.forceSquareOffsetX]}
                                onValueChange={(value) => handleParamChange('forceSquareOffsetX', value[0])}
                                min={-20}
                                max={20}
                                step={1}
                                className="w-full"
                              />
                              <p className="text-xs text-blue-600 mt-1">正值向右，负值向左</p>
                            </div>
                            <div>
                              <div className="flex items-center justify-between mb-1">
                                <Label className="text-xs font-medium text-blue-700">Y轴偏移</Label>
                                <span className="text-xs font-bold text-blue-700">{params.forceSquareOffsetY}px</span>
                              </div>
                              <Slider
                                value={[params.forceSquareOffsetY]}
                                onValueChange={(value) => handleParamChange('forceSquareOffsetY', value[0])}
                                min={-20}
                                max={20}
                                step={1}
                                className="w-full"
                              />
                              <p className="text-xs text-blue-600 mt-1">正值向下，负值向上</p>
                            </div>
                          </div>
                        </>
                      )}
                      <div className="space-y-3">
                        <div className="flex items-center justify-between p-3 bg-purple-50 rounded">
                          <div>
                            <Label className="text-sm font-medium text-purple-800">过滤空图标</Label>
                            <p className="text-xs text-purple-600 mt-1">自动过滤没有内容的方框</p>
                          </div>
                          <input
                            type="checkbox"
                            id="filterEmptyIcons"
                            checked={params.filterEmptyIcons}
                            onChange={(e) => handleParamChange('filterEmptyIcons', e.target.checked)}
                            className="w-5 h-5 text-purple-600 rounded cursor-pointer"
                          />
                        </div>
                        {params.filterEmptyIcons && (
                          <div className="p-3 bg-purple-50 rounded">
                            <div className="flex items-center justify-between mb-2">
                              <Label className="text-sm font-medium text-purple-800">空图标方差阈值</Label>
                              <span className="text-sm font-bold text-purple-700">{params.emptyIconVarianceThreshold}</span>
                            </div>
                            <Slider
                              value={[params.emptyIconVarianceThreshold]}
                              onValueChange={(value) => handleParamChange('emptyIconVarianceThreshold', value[0])}
                              min={5}
                              max={100}
                              step={5}
                              className="w-full"
                            />
                            <p className="text-xs text-purple-600 mt-1">
                              方差低于此值的方框会被过滤掉（建议值：15-30）
                            </p>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* 预设管理 */}
                <div className="pt-4 border-t">
                  <Label className="text-sm font-semibold mb-3 block">预设管理</Label>
                  <div className="flex gap-2 flex-wrap mb-3">
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
                      onClick={handleResetToNewDefaults}
                      className="flex-1 min-w-[120px] bg-blue-50 dark:bg-blue-950 border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300"
                    >
                      🔄 重置为新默认值
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
                  <div className="flex gap-2 flex-wrap mb-3">
                    <Button
                      variant="default"
                      size="sm"
                      onClick={handleApplyOptimizedParams}
                      className="flex-1 min-w-[120px] bg-green-600 hover:bg-green-700 text-white"
                    >
                      ✨ 应用优化参数
                    </Button>
                  </div>
                  <div className="bg-yellow-50 dark:bg-yellow-950 border border-yellow-200 dark:border-yellow-800 p-3 rounded mb-2">
                    <p className="text-xs text-yellow-800 dark:text-yellow-300 mb-1">
                      <strong>💡 提示：</strong>如果Y轴偏移无法保存，点击"🔄 重置为新默认值"按钮清除旧配置。
                    </p>
                    <p className="text-xs text-gray-600 dark:text-gray-400">
                      旧配置（LocalStorage中的值）会覆盖新的默认值，需要手动清除。
                    </p>
                  </div>
                  <p className="text-xs text-gray-500 mt-2">
                    应用基于实际调试测试的优化参数（偏移校准、边界检测等）
                  </p>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".json"
                    onChange={handleFileSelect}
                    className="hidden"
                  />
                </div>

                {/* 🌟 当前参数状态 */}
                <div className="pt-4 border-t">
                  <div className="flex items-center justify-between mb-3">
                    <Label className="text-sm font-semibold">当前参数状态</Label>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          const currentState = localStorage.getItem(STORAGE_KEY);
                          alert(`LocalStorage中的当前配置：\n\n${currentState}`);
                        }}
                        className="text-xs"
                      >
                        检查 LocalStorage
                      </Button>
                    </div>
                  </div>
                  <div className="bg-gray-50 dark:bg-gray-900 p-3 rounded text-xs space-y-1 max-h-40 overflow-y-auto">
                    <div className="font-semibold mb-2">偏移校准参数：</div>
                    <div className="flex items-center justify-between">
                      <span>X轴偏移: <span className="font-mono text-blue-600 dark:text-blue-400">{params.forceSquareOffsetX}</span></span>
                      {params.forceSquareOffsetX !== DEFAULT_PARAMS.forceSquareOffsetX && (
                        <span className="text-xs bg-orange-100 dark:bg-orange-900 text-orange-700 dark:text-orange-300 px-2 py-0.5 rounded">已修改</span>
                      )}
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Y轴偏移: <span className="font-mono text-blue-600 dark:text-blue-400">{params.forceSquareOffsetY}</span></span>
                      {params.forceSquareOffsetY !== DEFAULT_PARAMS.forceSquareOffsetY && (
                        <span className="text-xs bg-orange-100 dark:bg-orange-900 text-orange-700 dark:text-orange-300 px-2 py-0.5 rounded">已修改</span>
                      )}
                    </div>
                    <div className="font-semibold mb-2 mt-2">边界检测参数：</div>
                    <div className="flex items-center justify-between">
                      <span>行检测阈值: <span className="font-mono text-green-600 dark:text-green-400">{params.boundsVarianceThresholdRow}</span></span>
                      {params.boundsVarianceThresholdRow !== DEFAULT_PARAMS.boundsVarianceThresholdRow && (
                        <span className="text-xs bg-orange-100 dark:bg-orange-900 text-orange-700 dark:text-orange-300 px-2 py-0.5 rounded">已修改</span>
                      )}
                    </div>
                    <div className="flex items-center justify-between">
                      <span>列检测阈值: <span className="font-mono text-green-600 dark:text-green-400">{params.boundsVarianceThresholdCol}</span></span>
                      {params.boundsVarianceThresholdCol !== DEFAULT_PARAMS.boundsVarianceThresholdCol && (
                        <span className="text-xs bg-orange-100 dark:bg-orange-900 text-orange-700 dark:text-orange-300 px-2 py-0.5 rounded">已修改</span>
                      )}
                    </div>
                    <div className="flex items-center justify-between">
                      <span>最小行高: <span className="font-mono text-green-600 dark:text-green-400">{params.boundsMinRowHeight}</span></span>
                      {params.boundsMinRowHeight !== DEFAULT_PARAMS.boundsMinRowHeight && (
                        <span className="text-xs bg-orange-100 dark:bg-orange-900 text-orange-700 dark:text-orange-300 px-2 py-0.5 rounded">已修改</span>
                      )}
                    </div>
                    <div className="flex items-center justify-between">
                      <span>最小列宽: <span className="font-mono text-green-600 dark:text-green-400">{params.boundsMinColWidth}</span></span>
                      {params.boundsMinColWidth !== DEFAULT_PARAMS.boundsMinColWidth && (
                        <span className="text-xs bg-orange-100 dark:bg-orange-900 text-orange-700 dark:text-orange-300 px-2 py-0.5 rounded">已修改</span>
                      )}
                    </div>
                  </div>
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
                <span>蓝色框：Panel外边缘（扫描线自动检测）</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 border-2 border-green-500" />
                <span>绿色框：顶部标题区域</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 border-2 border-red-500" />
                <span>红色框：图标裁切区域（滑动窗口检测）</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 border-2 border-red-500 border-dashed" />
                <span>红色虚线框：滑动窗口-行检测（横向矩形）</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 border-2 border-blue-500 border-dashed" />
                <span>蓝色虚线框：滑动窗口-列检测（竖向矩形）</span>
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
            <div className="mt-4 p-3 bg-purple-50 rounded border border-purple-200">
              <p className="text-sm text-purple-900">
                <strong>🔍 滑动窗口检测（主要方法）：</strong>使用滑动窗口平均算法自动检测多行多列图标布局，无需手动调整间距。红色横向矩形窗口检测行，蓝色竖向矩形窗口检测列，窗口中心点作为图标起始坐标。
              </p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
