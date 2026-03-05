import { NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';
import path from 'path';
import fs from 'fs/promises';
import { LLMClient, Config } from 'coze-coding-dev-sdk';

// 接口定义
interface WikiCroppedImage {
  path: string;
  name: string;
  row: number;
  col: number;
  totalRows: number;
  totalCols: number;
  x?: number;  // 精确的裁剪X坐标
  y?: number;  // 精确的裁剪Y坐标
  size?: number;  // 精确的裁剪尺寸（用于正方形裁切）
  width?: number;  // 裁切宽度（用于非正方形裁切）
  height?: number;  // 裁切高度（用于非正方形裁切）
  panelName?: string;  // 所属板块名称
  wikiName?: string;  // Wiki名称
  id?: string;  // 唯一标识
  imageUrl?: string;  // 图片URL
  title?: string;  // 板块标题
  isLLMDetected?: boolean;  // 是否由LLM识别的位置（跳过二次检测）
}

// LLM分析结果接口
interface LLMPanelInfo {
  title: string;
  y: number;
  height: number;
  icons: {
    x: number;
    y: number;
    width: number;
    height: number;
    index: number;
  }[];
}

interface LLMAnalysisResult {
  panels: LLMPanelInfo[];
  imageWidth: number;
  imageHeight: number;
}

interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface GridItem {
  row: number;
  col: number;
  box: BoundingBox;
}

interface Panel {
  x: number;
  y: number;
  width: number;
  height: number;
  index: number;
}

/**
 * 检测背景颜色（使用边缘像素的统计值）
 */
function detectBackgroundColor(
  data: Buffer,
  width: number,
  height: number,
  channels: number
): { r: number; g: number; b: number } {
  // 采样边缘像素的R、G、B值
  const rValues: number[] = [];
  const gValues: number[] = [];
  const bValues: number[] = [];
  const margin = 5;

  // 采样上边缘
  for (let y = 0; y < margin && y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * channels;
      rValues.push(data[idx]);
      gValues.push(data[idx + 1]);
      bValues.push(data[idx + 2]);
    }
  }

  // 采样下边缘
  for (let y = Math.max(0, height - margin); y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * channels;
      rValues.push(data[idx]);
      gValues.push(data[idx + 1]);
      bValues.push(data[idx + 2]);
    }
  }

  // 采样左边缘
  for (let x = 0; x < margin && x < width; x++) {
    for (let y = margin; y < height - margin; y++) { // 避免重复采样上下边缘
      const idx = (y * width + x) * channels;
      rValues.push(data[idx]);
      gValues.push(data[idx + 1]);
      bValues.push(data[idx + 2]);
    }
  }

  // 采样右边缘
  for (let x = Math.max(0, width - margin); x < width; x++) {
    for (let y = margin; y < height - margin; y++) { // 避免重复采样上下边缘
      const idx = (y * width + x) * channels;
      rValues.push(data[idx]);
      gValues.push(data[idx + 1]);
      bValues.push(data[idx + 2]);
    }
  }

  // 计算中位数
  rValues.sort((a, b) => a - b);
  gValues.sort((a, b) => a - b);
  bValues.sort((a, b) => a - b);

  const mid = Math.floor(rValues.length / 2);

  return {
    r: rValues[mid],
    g: gValues[mid],
    b: bValues[mid]
  };
}

/**
 * 检测图片中图标的精确边界（去除背景）
 * 返回图标的最小包围框
 */
async function detectIconBounds(
  imageBuffer: Buffer,
  x: number,
  y: number,
  width: number,
  height: number,
  padding: number = 5
): Promise<{ x: number; y: number; width: number; height: number } | null> {
  try {
    // 边界检查：确保提取区域在图片范围内
    const { width: imgWidth, height: imgHeight } = await sharp(imageBuffer).metadata();
    
    // 确保坐标为非负数
    const safeX = Math.max(0, x);
    const safeY = Math.max(0, y);
    
    // 确保提取区域不超出图片范围
    const safeWidth = Math.min(width, imgWidth - safeX);
    const safeHeight = Math.min(height, imgHeight - safeY);
    
    // 如果有效尺寸太小，返回null
    if (safeWidth <= 0 || safeHeight <= 0) {
      console.warn(`Invalid extract area: (${safeX},${safeY}) ${safeWidth}x${safeHeight}`);
      return null;
    }
    
    // 提取区域（扩大采样范围，确保包含完整图标）
    const { data, info } = await sharp(imageBuffer)
      .extract({ left: safeX, top: safeY, width: safeWidth, height: safeHeight })
      .raw()
      .toBuffer({ resolveWithObject: true });

    const channels = info.channels;
    const w = info.width;
    const h = info.height;

    // 改进：从四条边的中段采样背景颜色（避免角落和边缘的图标内容）
    const bgR: number[] = [], bgG: number[] = [], bgB: number[] = [];
    const edgeMargin = Math.floor(Math.min(w, h) * 0.1); // 边缘10%
    const sampleSize = Math.floor(Math.min(w, h) * 0.2); // 采样区域20%
    
    // 上边中段
    for (let i = Math.floor(w * 0.4); i < Math.floor(w * 0.6); i++) {
      for (let j = 0; j < edgeMargin; j++) {
        const idx = j * w + i;
        bgR.push(data[idx * channels]);
        bgG.push(data[idx * channels + 1]);
        bgB.push(data[idx * channels + 2]);
      }
    }
    
    // 下边中段
    for (let i = Math.floor(w * 0.4); i < Math.floor(w * 0.6); i++) {
      for (let j = h - edgeMargin; j < h; j++) {
        const idx = j * w + i;
        bgR.push(data[idx * channels]);
        bgG.push(data[idx * channels + 1]);
        bgB.push(data[idx * channels + 2]);
      }
    }
    
    // 左边中段
    for (let i = 0; i < edgeMargin; i++) {
      for (let j = Math.floor(h * 0.4); j < Math.floor(h * 0.6); j++) {
        const idx = j * w + i;
        bgR.push(data[idx * channels]);
        bgG.push(data[idx * channels + 1]);
        bgB.push(data[idx * channels + 2]);
      }
    }
    
    // 右边中段
    for (let i = w - edgeMargin; i < w; i++) {
      for (let j = Math.floor(h * 0.4); j < Math.floor(h * 0.6); j++) {
        const idx = j * w + i;
        bgR.push(data[idx * channels]);
        bgG.push(data[idx * channels + 1]);
        bgB.push(data[idx * channels + 2]);
      }
    }

    // 计算中位数作为背景颜色
    bgR.sort((a, b) => a - b);
    bgG.sort((a, b) => a - b);
    bgB.sort((a, b) => a - b);
    const mid = Math.floor(bgR.length / 2);
    const bgColor = { r: bgR[mid], g: bgG[mid], b: bgB[mid] };
    
    console.log(`    Detected background: RGB(${bgColor.r},${bgColor.g},${bgColor.b})`);

    // 提高阈值，避免误判
    const threshold = 40; // 颜色差异阈值（提高到40）
    let minX = w, maxX = 0, minY = h, maxY = 0;
    let hasContent = false;
    let contentPixels = 0;

    for (let py = 0; py < h; py++) {
      for (let px = 0; px < w; px++) {
        const idx = (py * w + px) * channels;
        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];

        const diff = Math.abs(r - bgColor.r) + Math.abs(g - bgColor.g) + Math.abs(b - bgColor.b);
        if (diff > threshold) {
          hasContent = true;
          contentPixels++;
          minX = Math.min(minX, px);
          maxX = Math.max(maxX, px);
          minY = Math.min(minY, py);
          maxY = Math.max(maxY, py);
        }
      }
    }

    if (!hasContent) {
      console.log(`    No content detected, returning null`);
      return null; // 没有内容
    }
    
    const contentRatio = contentPixels / (w * h);
    console.log(`    Content pixels: ${contentPixels} (${(contentRatio * 100).toFixed(1)}%)`);
    console.log(`    Bounds before padding: (${minX},${minY}) to (${maxX},${maxY})`);

    // 添加padding
    minX = Math.max(0, minX - padding);
    maxX = Math.min(w - 1, maxX + padding);
    minY = Math.max(0, minY - padding);
    maxY = Math.min(h - 1, maxY + padding);

    const contentWidth = maxX - minX + 1;
    const contentHeight = maxY - minY + 1;

    console.log(`    Final bounds: (${minX},${minY}) ${contentWidth}x${contentHeight}`);

    // 如果内容区域太小，返回null
    if (contentWidth < 15 || contentHeight < 15) {
      console.log(`    Content too small, returning null`);
      return null;
    }

    return {
      x: safeX + minX,
      y: safeY + minY,
      width: contentWidth,
      height: contentHeight
    };
  } catch (error) {
    console.error(`    Error in detectIconBounds:`, error);
    return null;
  }
}

/**
 * 检测图片是否是纯色或接近纯色（无实际内容）
 * 返回 true 表示是纯色，应该跳过
 */
async function isSolidColor(
  imageBuffer: Buffer,
  x: number,
  y: number,
  width: number,
  height: number,
  threshold: number = 30
): Promise<boolean> {
  try {
    // 提取裁剪区域
    const { data, info } = await sharp(imageBuffer)
      .extract({ left: x, top: y, width, height })
      .raw()
      .toBuffer({ resolveWithObject: true });

    const channels = info.channels;
    const pixelCount = width * height;

    // 计算所有像素的平均颜色
    let sumR = 0, sumG = 0, sumB = 0;
    for (let i = 0; i < pixelCount; i++) {
      sumR += data[i * channels];
      sumG += data[i * channels + 1];
      sumB += data[i * channels + 2];
    }

    const avgR = sumR / pixelCount;
    const avgG = sumG / pixelCount;
    const avgB = sumB / pixelCount;

    // 计算每个像素与平均颜色的差异，统计差异大于阈值的像素数量
    let significantPixels = 0;
    for (let i = 0; i < pixelCount; i++) {
      const r = data[i * channels];
      const g = data[i * channels + 1];
      const b = data[i * channels + 2];

      const diff = Math.abs(r - avgR) + Math.abs(g - avgG) + Math.abs(b - avgB);
      if (diff > threshold) {
        significantPixels++;
      }
    }

    // 如果有内容的像素少于15%（即纯色区域>85%），认为是纯色废图
    const contentRatio = significantPixels / pixelCount;
    return contentRatio < 0.15;
  } catch (error) {
    // 如果检测失败，保守起见不跳过
    return false;
  }
}

/**
 * 使用LLM视觉模型分析图片，识别板块标题（用于图标命名）
 */
async function analyzeImageWithLLM(
  imageBuffer: Buffer,
  metadata: sharp.Metadata
): Promise<string[]> {
  const config = new Config();
  const client = new LLMClient(config);

  // 转换为base64
  const base64Image = imageBuffer.toString('base64');
  const ext = metadata.format || 'png';
  const dataUri = `data:image/${ext};base64,${base64Image}`;

  const prompt = `识别这张游戏Wiki页面图片中每个板块的标题。

图片尺寸: ${metadata.width}x${metadata.height}

请只返回板块标题列表，格式：
{"titles":["标题1","标题2",...]}

要求：
1. 只返回标题英文原文（如"Shells"、"Beach Bucket"）
2. 按从上到下顺序排列
3. 只返回JSON，不要其他文字
4. 标题数量应该与图片中的板块数量一致`;

  const messages = [
    {
      role: 'user' as const,
      content: [
        { type: 'text' as const, text: prompt },
        {
          type: 'image_url' as const,
          image_url: {
            url: dataUri,
            detail: 'high' as const,
          },
        },
      ],
    },
  ];

  console.log('Calling LLM for panel title analysis...');
  const response = await client.invoke(messages, {
    model: 'doubao-seed-1-6-vision-250815',
    temperature: 0.2,
  });

  console.log('LLM response length:', response.content.length);

  // 解析LLM返回的JSON
  try {
    let jsonStr = response.content;
    
    const codeBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) {
      jsonStr = codeBlockMatch[1].trim();
    } else {
      const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        jsonStr = jsonMatch[0];
      }
    }
    
    jsonStr = jsonStr.replace(/,\s*([}\]])/g, '$1');
    
    let openBraces = (jsonStr.match(/\{/g) || []).length;
    let closeBraces = (jsonStr.match(/\}/g) || []).length;
    let openBrackets = (jsonStr.match(/\[/g) || []).length;
    let closeBrackets = (jsonStr.match(/\]/g) || []).length;
    
    while (openBrackets > closeBrackets) {
      jsonStr += ']';
      closeBrackets++;
    }
    while (openBraces > closeBraces) {
      jsonStr += '}';
      closeBraces++;
    }
    
    const parsed = JSON.parse(jsonStr);
    const titles: string[] = parsed.titles || [];
    console.log(`Successfully parsed ${titles.length} panel titles: ${titles.join(', ')}`);
    
    return titles;
  } catch (parseError) {
    console.error('Failed to parse LLM response:', parseError);
    return [];
  }
}

/**
 * 使用LLM视觉模型分析单个板块内的图标位置
 * @deprecated 已弃用，改用深色小底板检测
 */
/*
async function analyzePanelWithLLM(
  imageBuffer: Buffer,
  panelX: number,
  panelY: number,
  panelWidth: number,
  panelHeight: number,
  fullImageWidth: number,
  fullImageHeight: number
): Promise<{ title: string; icons: Array<{ x: number; y: number; width: number; height: number }> }> {
  const config = new Config();
  const client = new LLMClient(config);

  // 提取板块区域
  const panelBuffer = await sharp(imageBuffer)
    .extract({ left: panelX, top: panelY, width: panelWidth, height: panelHeight })
    .toBuffer();

  // 转换为base64
  const base64Image = panelBuffer.toString('base64');
  const dataUri = `data:image/png;base64,${base64Image}`;

  const prompt = `分析这个游戏Wiki板块，识别板块标题和每个图标的精确位置。

板块尺寸: ${panelWidth}x${panelHeight}

请返回JSON格式：
{
  "title": "板块标题",
  "icons": [
    {"x": 图标左上角X坐标, "y": 图标左上角Y坐标, "width": 图标宽度, "height": 图标高度},
    ...
  ]
}

要求：
1. title是该板块的英文标题（如"Shells"）
2. icons数组包含所有可见的物品图标
3. 坐标是相对于这个板块图片的坐标（0,0是左上角）
4. 只包含实际的物品图标，不包含标题文字区域
5. 图标应该是完整的正方形或圆角方形
6. 包含图标的背景框（浅米色的圆角方框），不要只裁剪物品本身
7. 确保每个图标都是完整的，不要截断
8. 只返回JSON，不要其他文字`;

  const messages = [
    {
      role: 'user' as const,
      content: [
        { type: 'text' as const, text: prompt },
        {
          type: 'image_url' as const,
          image_url: {
            url: dataUri,
            detail: 'high' as const,
          },
        },
      ],
    },
  ];

  try {
    const response = await client.invoke(messages, {
      model: 'doubao-seed-1-6-vision-250815',
      temperature: 0.1,
    });

    // 解析JSON
    let jsonStr = response.content;
    const codeBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) {
      jsonStr = codeBlockMatch[1].trim();
    } else {
      const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        jsonStr = jsonMatch[0];
      }
    }

    // 修复JSON
    jsonStr = jsonStr.replace(/,\s*([}\]])/g, '$1');
    let openBraces = (jsonStr.match(/\{/g) || []).length;
    let closeBraces = (jsonStr.match(/\}/g) || []).length;
    while (openBraces > closeBraces) {
      jsonStr += '}';
      closeBraces++;
    }

    const parsed = JSON.parse(jsonStr);
    
    // 验证和修正图标位置
    const icons = (parsed.icons || []).map((icon: any) => ({
      x: Math.max(0, Math.min(icon.x, panelWidth - 1)),
      y: Math.max(0, Math.min(icon.y, panelHeight - 1)),
      width: Math.max(10, Math.min(icon.width, panelWidth)),
      height: Math.max(10, Math.min(icon.height, panelHeight))
    }));

    console.log(`    LLM detected ${icons.length} icons in panel, title: "${parsed.title}"`);
    
    return {
      title: parsed.title || '',
      icons: icons
    };
  } catch (error) {
    console.error('    LLM panel analysis failed:', error);
    return {
      title: '',
      icons: []
    };
  }
}
*/

/**
 * 使用BFS找到连通区域
 */
function findConnectedComponent(
  mask: Buffer,
  visited: Buffer,
  width: number,
  height: number,
  startX: number,
  startY: number
): BoundingBox {
  const queue: [number, number][] = [[startX, startY]];
  visited[startY * width + startX] = 1;

  let minX = startX, maxX = startX;
  let minY = startY, maxY = startY;

  const directions = [[-1, 0], [1, 0], [0, -1], [0, 1]];

  while (queue.length > 0) {
    const [x, y] = queue.shift()!;

    for (const [dx, dy] of directions) {
      const nx = x + dx;
      const ny = y + dy;

      if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
        const idx = ny * width + nx;
        if (mask[idx] === 1 && visited[idx] === 0) {
          visited[idx] = 1;
          queue.push([nx, ny]);

          minX = Math.min(minX, nx);
          maxX = Math.max(maxX, nx);
          minY = Math.min(minY, ny);
          maxY = Math.max(maxY, ny);
        }
      }
    }
  }

  return {
    x: minX,
    y: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1
  };
}

/**
 * 找到所有连通区域（物品）
 */
function findBoundingBoxes(mask: Buffer, width: number, height: number): BoundingBox[] {
  const visited = Buffer.alloc(width * height, 0);
  const boxes: BoundingBox[] = [];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (mask[idx] === 1 && visited[idx] === 0) {
        // 找到新的物品，使用BFS找到连通区域
        const box = findConnectedComponent(mask, visited, width, height, x, y);
        if (box.width > 10 && box.height > 10) {
          boxes.push(box);
        }
      }
    }
  }

  return boxes;
}

/**
 * 将边界框聚类到规则网格中
 */
function clusterToGrid(boxes: BoundingBox[]): GridItem[] {
  if (boxes.length === 0) return [];

  // 按中心点Y坐标排序
  const sortedByY = [...boxes].sort((a, b) => (a.y + a.height / 2) - (b.y + b.height / 2));

  // 检测行
  const rows: BoundingBox[][] = [];
  let currentRow: BoundingBox[] = [sortedByY[0]];
  const avgHeight = boxes.reduce((sum, b) => sum + b.height, 0) / boxes.length;

  for (let i = 1; i < sortedByY.length; i++) {
    const currentCenterY = sortedByY[i].y + sortedByY[i].height / 2;
    const lastCenterY = currentRow[currentRow.length - 1].y + currentRow[currentRow.length - 1].height / 2;

    if (Math.abs(currentCenterY - lastCenterY) < avgHeight * 0.5) {
      currentRow.push(sortedByY[i]);
    } else {
      rows.push(currentRow);
      currentRow = [sortedByY[i]];
    }
  }
  if (currentRow.length > 0) rows.push(currentRow);

  // 检测列（每行内部）
  const gridItems: GridItem[] = [];
  for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
    const row = rows[rowIdx];
    const sortedByX = [...row].sort((a, b) => (a.x + a.width / 2) - (b.x + b.width / 2));
    const avgWidth = row.reduce((sum, b) => sum + b.width, 0) / row.length;

    let colIdx = 0;
    gridItems.push({
      row: rowIdx,
      col: colIdx++,
      box: sortedByX[0]
    });

    for (let i = 1; i < sortedByX.length; i++) {
      const currentCenterX = sortedByX[i].x + sortedByX[i].width / 2;
      const lastCenterX = sortedByX[i - 1].x + sortedByX[i - 1].width / 2;

      if (Math.abs(currentCenterX - lastCenterX) > avgWidth * 0.5) {
        colIdx++;
      }
      gridItems.push({
        row: rowIdx,
        col: colIdx,
        box: sortedByX[i]
      });
    }
  }

  return gridItems;
}

/**
 * 检测大板块（第一级切割）
 */
async function detectPanels(image: sharp.Sharp, metadata: sharp.Metadata): Promise<Panel[]> {
  const { width, height } = metadata;

  console.log(`  Detecting panels: ${width}x${height}`);

  // 缩放以提高处理速度
  const scaleFactor = Math.min(1, 800 / Math.max(width, height));
  const scaledWidth = Math.round(width * scaleFactor);
  const scaledHeight = Math.round(height * scaleFactor);

  const { data, info } = await image
    .resize(scaledWidth, scaledHeight, { fit: 'inside' })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const channels = info.channels;

  // 检测背景颜色（使用窗口背景）
  const backgroundColor = detectBackgroundColor(data, scaledWidth, scaledHeight, channels);
  console.log(`  Background color: RGB(${backgroundColor.r},${backgroundColor.g},${backgroundColor.b})`);

  // 创建板块掩码（浅色区域）
  const threshold = 60; // 更宽松的阈值，检测浅色板块
  const mask = Buffer.alloc(scaledWidth * scaledHeight);
  let panelPixels = 0;

  for (let i = 0; i < scaledWidth * scaledHeight; i++) {
    const r = data[i * channels];
    const g = data[i * channels + 1];
    const b = data[i * channels + 2];

    const colorDiff = Math.abs(r - backgroundColor.r) +
                      Math.abs(g - backgroundColor.g) +
                      Math.abs(b - backgroundColor.b);

    // 检测与背景有差异的区域（板块）
    if (colorDiff > threshold) {
      mask[i] = 1;
      panelPixels++;
    } else {
      mask[i] = 0;
    }
  }

  const panelPixelRatio = panelPixels / (scaledWidth * scaledHeight);
  console.log(`  Panel pixels: ${panelPixels} (${(panelPixelRatio * 100).toFixed(2)}%)`);

  // 连通区域分析，找到每个板块的边界框
  const boundingBoxes = findBoundingBoxes(mask, scaledWidth, scaledHeight);
  console.log(`  Found ${boundingBoxes.length} panels`);

  // 转换回原始尺寸
  const panels: Panel[] = boundingBoxes.map((box, index) => ({
    x: Math.round(box.x / scaleFactor),
    y: Math.round(box.y / scaleFactor),
    width: Math.round(box.width / scaleFactor),
    height: Math.round(box.height / scaleFactor),
    index
  }));

  return panels;
}

/**
 * 检测板块内的标题区域高度
 */
async function detectTitleHeight(
  image: sharp.Sharp,
  metadata: sharp.Metadata,
  panel: Panel
): Promise<number> {
  try {
    // 提取板块顶部区域（前30%）
    const titleZoneHeight = Math.floor(panel.height * 0.3);
    const { data, info } = await sharp(await image.toBuffer())
      .extract({ left: panel.x, top: panel.y, width: panel.width, height: titleZoneHeight })
      .raw()
      .toBuffer({ resolveWithObject: true });

    const channels = info.channels;
    const w = info.width;
    const h = info.height;

    // 检测背景颜色（板块背景）
    const bgColors: number[][] = [];
    for (let i = 0; i < Math.min(10, w); i++) {
      const idx = i;
      bgColors.push([data[idx * channels], data[idx * channels + 1], data[idx * channels + 2]]);
    }
    const bgColor = bgColors[Math.floor(bgColors.length / 2)];

    // 扫描每一行，找到第一个内容密集的行（图标开始）
    const threshold = 40;
    let firstIconRow = h; // 默认标题占满整个区域

    for (let y = Math.floor(h * 0.1); y < h; y++) { // 跳过前10%（肯定是标题）
      let contentPixels = 0;
      for (let x = 0; x < w; x++) {
        const idx = (y * w + x) * channels;
        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];
        const diff = Math.abs(r - bgColor[0]) + Math.abs(g - bgColor[1]) + Math.abs(b - bgColor[2]);
        if (diff > threshold) {
          contentPixels++;
        }
      }
      
      // 如果这一行的内容像素超过10%，认为是图标开始
      if (contentPixels > w * 0.1) {
        firstIconRow = y;
        break;
      }
    }

    console.log(`    Detected title height: ${firstIconRow}px (${(firstIconRow / panel.height * 100).toFixed(1)}% of panel)`);
    return Math.min(firstIconRow, Math.floor(panel.height * 0.25)); // 最多25%
  } catch (error) {
    console.log(`    Title detection failed, using default 15%`);
    return Math.floor(panel.height * 0.15);
  }
}

/**
 * 移除重复的图片
 * 使用感知哈希检测重复图片
 */
async function removeDuplicateImages(crops: WikiCroppedImage[]): Promise<number> {
  const hashes: Map<string, string[]> = new Map(); // hash -> filePaths
  let removedCount = 0;

  for (const crop of crops) {
    const filePath = path.join(process.cwd(), 'public', 'wiki-cropped', crop.wikiName || '', crop.path);
    
    try {
      // 计算感知哈希
      const buffer = await fs.readFile(filePath);
      const hash = await sharp(buffer)
        .resize(16, 16, { fit: 'fill' })
        .grayscale()
        .raw()
        .toBuffer();
      
      let hashString = '';
      for (let i = 0; i < hash.length; i++) {
        hashString += hash[i].toString(16).padStart(2, '0');
      }

      // 检查是否已有相同哈希
      if (hashes.has(hashString)) {
        const existingFiles = hashes.get(hashString)!;
        console.log(`  Found duplicate: ${crop.path} matches ${existingFiles.join(', ')}`);
        
        // 删除重复文件
        await fs.unlink(filePath);
        console.log(`  Removed duplicate: ${filePath}`);
        removedCount++;
      } else {
        hashes.set(hashString, [crop.path]);
      }
    } catch (error) {
      console.error(`Failed to check duplicate for ${crop.path}:`, error);
    }
  }

  return removedCount;
}

/**
 * 在指定板块内检测深色小底板（图标底座）
 * 通过颜色差异检测相对于米白色背景更深的小矩形
 */
async function detectIconBasesInPanel(
  imageBuffer: Buffer,
  panel: Panel
): Promise<Array<{ x: number; y: number; width: number; height: number }>> {
  const image = sharp(imageBuffer);
  
  // 获取图片尺寸
  const { width: imgWidth, height: imgHeight } = await image.metadata();
  
  // 边界检查：确保板块区域在图片范围内
  const safePanelX = Math.max(0, panel.x);
  const safePanelY = Math.max(0, panel.y);
  const safePanelWidth = Math.min(panel.width, imgWidth - safePanelX);
  const safePanelHeight = Math.min(panel.height, imgHeight - safePanelY);
  
  // 如果有效尺寸太小，返回空数组
  if (safePanelWidth <= 0 || safePanelHeight <= 0) {
    console.warn(`Invalid panel area: (${safePanelX},${safePanelY}) ${safePanelWidth}x${safePanelHeight}`);
    return [];
  }
  
  // 提取板块区域
  const { data, info } = await image
    .extract({
      left: safePanelX,
      top: safePanelY,
      width: safePanelWidth,
      height: safePanelHeight
    })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const width = info.width;
  const height = info.height;
  const channels = info.channels;

  console.log(`    Panel image size: ${width}x${height}`);

  // 检测板块背景颜色（米白色）
  const panelBgColors: number[][] = [];
  for (let i = 0; i < Math.min(50, width * height); i++) {
    const idx = i * channels;
    panelBgColors.push([data[idx], data[idx + 1], data[idx + 2]]);
  }
  panelBgColors.sort((a, b) => 
    (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2
  );
  const panelBgColor = panelBgColors[Math.floor(panelBgColors.length / 2)];

  console.log(`    Panel background: RGB(${panelBgColor[0]},${panelBgColor[1]},${panelBgColor[2]})`);

  // 创建深色小底板掩码
  const darkerThreshold = 25; // 比背景深的阈值
  const lighterThreshold = 15; // 同时也不能太亮（排除白色文字等）
  const mask = Buffer.alloc(width * height);
  
  for (let i = 0; i < width * height; i++) {
    const r = data[i * channels];
    const g = data[i * channels + 1];
    const b = data[i * channels + 2];

    const rDiff = panelBgColor[0] - r;
    const gDiff = panelBgColor[1] - g;
    const bDiff = panelBgColor[2] - b;

    // 检测比背景深且有一定对比度的区域（深色小底板）
    if (rDiff > darkerThreshold || gDiff > darkerThreshold || bDiff > darkerThreshold) {
      // 同时也不能太亮（避免误判）
      if (r < panelBgColor[0] - lighterThreshold && 
          g < panelBgColor[1] - lighterThreshold && 
          b < panelBgColor[2] - lighterThreshold) {
        mask[i] = 1;
      } else {
        mask[i] = 0;
      }
    } else {
      mask[i] = 0;
    }
  }

  // 统计检测到的像素数量
  const detectedPixels = mask.reduce((sum, val) => sum + val, 0);
  console.log(`    Panel background: RGB(${panelBgColor[0]},${panelBgColor[1]},${panelBgColor[2]})`);
  console.log(`    Thresholds: darker=${darkerThreshold}, lighter=${lighterThreshold}`);
  console.log(`    Detected ${detectedPixels} pixels (${(detectedPixels / (width * height) * 100).toFixed(2)}% of panel)`);

  // 连通区域分析
  const visited = Buffer.alloc(width * height);
  const boxes: BoundingBox[] = [];

  const minBaseSize = 40; // 最小底板尺寸
  const maxBaseSize = 150; // 最大底板尺寸

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (mask[idx] === 1 && visited[idx] === 0) {
        const box = findConnectedComponent(mask, visited, width, height, x, y);
        
        // 过滤尺寸
        if (box.width >= minBaseSize && box.width <= maxBaseSize &&
            box.height >= minBaseSize && box.height <= maxBaseSize) {
          boxes.push(box);
        } else {
          console.log(`      Filtered box: ${box.width}x${box.height} (out of range)`);
        }
      }
    }
  }

  console.log(`    Found ${boxes.length} icon bases after size filtering`);

  // 去重：移除重叠或过于接近的底板
  const filteredBoxes: BoundingBox[] = [];
  const minDistance = 30; // 最小距离阈值（像素）

  boxes.sort((a, b) => (a.y - b.y) || (a.x - b.x)); // 按Y坐标排序，然后按X坐标

  for (const box of boxes) {
    let isDuplicate = false;
    
    // 检查是否与已保留的底板重叠或过于接近
    for (const existing of filteredBoxes) {
      // 计算中心点距离
      const centerX1 = box.x + box.width / 2;
      const centerY1 = box.y + box.height / 2;
      const centerX2 = existing.x + existing.width / 2;
      const centerY2 = existing.y + existing.height / 2;
      
      const distance = Math.sqrt(
        Math.pow(centerX1 - centerX2, 2) + Math.pow(centerY1 - centerY2, 2)
      );
      
      if (distance < minDistance) {
        console.log(`      Filtering duplicate box: distance=${distance.toFixed(1)}px`);
        isDuplicate = true;
        break;
      }
    }
    
    if (!isDuplicate) {
      filteredBoxes.push(box);
    }
  }

  console.log(`    After deduplication: ${filteredBoxes.length} icon bases (removed ${boxes.length - filteredBoxes.length} duplicates)`);

  // 转换为全图坐标（使用safePanelX和safePanelY）
  return filteredBoxes.map(box => ({
    x: safePanelX + box.x,
    y: safePanelY + box.y,
    width: box.width,
    height: box.height
  }));
}

/**
 * 在指定板块内切割物品图标（第二级切割）
 * 使用颜色差异检测深色小底板，然后截取包含完整图标的区域
 */
async function detectAndCropIconsInPanel(
  imageBuffer: Buffer,
  metadata: sharp.Metadata,
  panel: Panel,
  wikiName: string
): Promise<{ crops: WikiCroppedImage[]; title: string }> {
  const crops: WikiCroppedImage[] = [];

  console.log(`  Analyzing panel ${panel.index}: (${panel.x},${panel.y}) ${panel.width}x${panel.height}`);

  // 检测深色小底板
  console.log(`    Detecting icon bases by color difference...`);
  const iconBases = await detectIconBasesInPanel(imageBuffer, panel);

  if (iconBases.length === 0) {
    console.log(`    No icon bases detected in panel ${panel.index}`);
    return { crops: [], title: '' };
  }

  // 计算合适的图标尺寸（基于小底板的平均尺寸）
  const avgBaseWidth = iconBases.reduce((sum, b) => sum + b.width, 0) / iconBases.length;
  const avgBaseHeight = iconBases.reduce((sum, b) => sum + b.height, 0) / iconBases.length;
  const baseSize = Math.max(avgBaseWidth, avgBaseHeight);

  // 修改策略：只裁切深色小底板区域，稍微扩大10-15%以包含完整内容
  const padding = Math.round(baseSize * 0.1); // 10%的底板尺寸作为留白

  console.log(`    Average base size: ${baseSize.toFixed(1)}px, Padding: ${padding}px`);

  // 聚类成行（按Y坐标分组）
  const avgHeight = iconBases.reduce((sum, b) => sum + b.height, 0) / iconBases.length;
  const rows: Array<Array<{ x: number; y: number; width: number; height: number }>> = [];
  
  // 按Y坐标排序
  const sortedByY = [...iconBases].sort((a, b) => a.y - b.y);
  
  // 分组成行
  if (sortedByY.length > 0) {
    let currentRow: { x: number; y: number; width: number; height: number }[] = [sortedByY[0]];
    
    for (let i = 1; i < sortedByY.length; i++) {
      const centerY1 = currentRow[0].y + currentRow[0].height / 2;
      const centerY2 = sortedByY[i].y + sortedByY[i].height / 2;
      
      // 如果Y坐标差异小于平均高度的一半，认为是同一行
      if (Math.abs(centerY2 - centerY1) < avgHeight * 0.5) {
        currentRow.push(sortedByY[i]);
      } else {
        rows.push(currentRow);
        currentRow = [sortedByY[i]];
      }
    }
    rows.push(currentRow);
  }

  console.log(`    Cluster icons into ${rows.length} rows`);

  // 为每个图标分配row和col（行优先顺序）
  let globalIconIndex = 0;
  rows.forEach((rowItems, rowIndex) => {
    // 每行内按X坐标排序
    const sortedByX = [...rowItems].sort((a, b) => a.x - b.x);
    
    sortedByX.forEach((base, colIndex) => {
      // 修改策略：直接使用深色小底板的区域，稍微扩大10%以包含完整内容
      const cropX = Math.max(0, base.x - padding);
      const cropY = Math.max(0, base.y - padding);
      const cropWidth = base.width + padding * 2;
      const cropHeight = base.height + padding * 2;

      // 确保不越界
      const finalX = Math.min(cropX, (metadata.width || 0) - cropWidth);
      const finalY = Math.min(cropY, (metadata.height || 0) - cropHeight);
      const finalWidth = Math.min(cropWidth, (metadata.width || 0) - finalX);
      const finalHeight = Math.min(cropHeight, (metadata.height || 0) - finalY);

      // 如果裁切区域太小，跳过
      if (finalWidth < 20 || finalHeight < 20) {
        console.log(`      Skipping icon ${globalIconIndex}: too small (${finalWidth}x${finalHeight})`);
        globalIconIndex++;
        return;
      }

      crops.push({
        path: `panel_${panel.index}_icon_${globalIconIndex}.png`,
        name: `panel_${panel.index}_icon_${globalIconIndex}`,
        row: rowIndex,
        col: colIndex,
        totalRows: rows.length,
        totalCols: sortedByX.length,
        x: finalX,
        y: finalY,
        size: Math.max(finalWidth, finalHeight), // 使用实际裁切尺寸
        width: finalWidth,
        height: finalHeight,
        panelName: `${wikiName}_panel_${panel.index}`,
        isLLMDetected: true  // 标记为直接检测的，跳过二次检测
      });
      
      console.log(`      Icon ${globalIconIndex}: (${finalX},${finalY}) ${finalWidth}x${finalHeight}`);
      globalIconIndex++;
    });
  });

  console.log(`    Generated ${crops.length} icons in panel ${panel.index}`);
  return { crops, title: '' };
}

/**
 * 智能识别图片中的物品位置并切割成1:1的icon
 */
async function detectAndCropItems(
  image: sharp.Sharp,
  metadata: sharp.Metadata,
  wikiName: string
): Promise<WikiCroppedImage[]> {
  const { width, height } = metadata;
  const crops: WikiCroppedImage[] = [];

  console.log(`Analyzing image: ${width}x${height}`);

  // 保存原始图像buffer（用于后续LLM分析）
  const originalImageBuffer = await image.clone().png().toBuffer();

  // 缩放图片以提高处理速度，但保持足够的精度
  const scaleFactor = Math.min(1, 1200 / Math.max(width, height));
  const scaledWidth = Math.round(width * scaleFactor);
  const scaledHeight = Math.round(height * scaleFactor);

  const { data, info } = await image
    .resize(scaledWidth, scaledHeight, { fit: 'inside' })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const channels = info.channels;

  // 识别背景颜色（使用主色调）
  const backgroundColor = detectBackgroundColor(data, scaledWidth, scaledHeight, channels);
  console.log(`Background color: R=${backgroundColor.r}, G=${backgroundColor.g}, B=${backgroundColor.b}`);

  // 3. 创建物品掩码（非背景像素）
  const threshold = 40; // 颜色差异阈值
  const mask = Buffer.alloc(scaledWidth * scaledHeight);
  let itemPixels = 0;

  for (let i = 0; i < scaledWidth * scaledHeight; i++) {
    const r = data[i * channels];
    const g = data[i * channels + 1];
    const b = data[i * channels + 2];

    const colorDiff = Math.abs(r - backgroundColor.r) +
                      Math.abs(g - backgroundColor.g) +
                      Math.abs(b - backgroundColor.b);

    if (colorDiff > threshold) {
      mask[i] = 1;
      itemPixels++;
    } else {
      mask[i] = 0;
    }
  }

  const itemPixelRatio = itemPixels / (scaledWidth * scaledHeight);
  console.log(`Item pixels: ${itemPixels} (${(itemPixelRatio * 100).toFixed(2)}%)`);
  console.log(`Threshold: ${threshold}, Background: RGB(${backgroundColor.r},${backgroundColor.g},${backgroundColor.b})`);

  // 检测是否为多板块垂直长图（如Wiki收集页面）
  // 特征：图片是垂直长图（高度 > 2倍宽度）
  const isVerticalLongImage = height > 2 * width;

  if (isVerticalLongImage) {
    console.log('Detected vertical long image, using two-stage cropping (panels → icons)');

    // 第一级：检测大板块
    const panels = await detectPanels(image, metadata);

    if (panels.length === 0) {
      console.log('No panels detected, falling back to single-stage detection');
      // 继续执行单级检测
    } else {
      console.log(`Detected ${panels.length} panels, proceeding to icon extraction`);

      // 第二级：在每个板块内切割图标（使用LLM视觉识别）
      const allCrops: WikiCroppedImage[] = [];
      const panelTitles: string[] = [];
      
      for (let i = 0; i < panels.length; i++) {
        const panel = panels[i];
        console.log(`  Processing panel ${i}: ${panel.width}x${panel.height} at (${panel.x},${panel.y})`);
        const result = await detectAndCropIconsInPanel(
          originalImageBuffer,
          metadata,
          panel,
          wikiName
        );
        console.log(`  Panel ${i} result: ${result.crops.length} icons`);
        allCrops.push(...result.crops);
        if (result.title) {
          panelTitles.push(result.title);
        }
      }

      console.log(`Total icons extracted: ${allCrops.length} from ${panels.length} panels`);
      console.log(`Panel titles detected: ${panelTitles.join(', ')}`);
      
      if (allCrops.length > 0) {
        return allCrops;
      } else {
        console.log('Warning: No icons extracted from any panel, falling back to single-stage detection');
        // 继续执行单级检测
      }
    }
  }

  // 如果物品像素太少，可能是阈值太高或背景检测有问题
  if (itemPixelRatio < 0.01) {
    console.log('Warning: Very few item pixels detected, trying adaptive threshold');
    
    // 尝试自适应阈值：使用Otsu方法或简单的统计方法
    const allDiffs: number[] = [];
    for (let i = 0; i < scaledWidth * scaledHeight; i++) {
      const r = data[i * channels];
      const g = data[i * channels + 1];
      const b = data[i * channels + 2];
      const colorDiff = Math.abs(r - backgroundColor.r) +
                        Math.abs(g - backgroundColor.g) +
                        Math.abs(b - backgroundColor.b);
      allDiffs.push(colorDiff);
    }
    
    allDiffs.sort((a, b) => a - b);
    const adaptiveThreshold = allDiffs[Math.floor(allDiffs.length * 0.8)]; // 使用80%分位数
    console.log(`Adaptive threshold: ${adaptiveThreshold}`);
    
    // 重新计算掩码
    itemPixels = 0;
    for (let i = 0; i < scaledWidth * scaledHeight; i++) {
      const r = data[i * channels];
      const g = data[i * channels + 1];
      const b = data[i * channels + 2];
      const colorDiff = Math.abs(r - backgroundColor.r) +
                        Math.abs(g - backgroundColor.g) +
                        Math.abs(b - backgroundColor.b);
      
      if (colorDiff > adaptiveThreshold) {
        mask[i] = 1;
        itemPixels++;
      } else {
        mask[i] = 0;
      }
    }
    
    console.log(`Item pixels after adaptive threshold: ${itemPixels} (${(itemPixels / (scaledWidth * scaledHeight) * 100).toFixed(2)}%)`);
  }

  // 4. 连通区域分析，找到每个物品的边界框
  const boundingBoxes = findBoundingBoxes(mask, scaledWidth, scaledHeight);
  console.log(`Found ${boundingBoxes.length} bounding boxes`);

  if (boundingBoxes.length === 0) {
    // 如果没有检测到物品，返回整个图片
    return [{
      path: '',
      name: 'full',
      row: 0,
      col: 0,
      totalRows: 1,
      totalCols: 1
    }];
  }

  // 5. 将边界框聚类到网格中
  const gridItems = clusterToGrid(boundingBoxes);
  console.log(`Clustered to grid: ${gridItems.length} items`);

  // 6. 切割每个物品为1:1的icon
  for (const item of gridItems) {
    // 计算缩放比例
    const box = item.box;
    const originalBox = {
      x: Math.round(box.x / scaleFactor),
      y: Math.round(box.y / scaleFactor),
      width: Math.round(box.width / scaleFactor),
      height: Math.round(box.height / scaleFactor)
    };

    // 计算正方形尺寸（取宽高中较大的）
    const iconSize = Math.max(originalBox.width, originalBox.height);

    // 计算裁剪区域（居中裁剪）
    const cropX = Math.max(0, originalBox.x - Math.round((iconSize - originalBox.width) / 2));
    const cropY = Math.max(0, originalBox.y - Math.round((iconSize - originalBox.height) / 2));
    const cropWidth = iconSize;
    const cropHeight = iconSize;

    console.log(`  Item [${item.row},${item.col}]: box=(${originalBox.x},${originalBox.y},${originalBox.width}x${originalBox.height}) crop=(${cropX},${cropY},${iconSize}x${iconSize})`);

    crops.push({
      path: `crop_${item.row}_${item.col}.png`,
      name: `item_${item.row}_${item.col}`,
      row: item.row,
      col: item.col,
      totalRows: Math.max(...gridItems.map(i => i.row)) + 1,
      totalCols: Math.max(...gridItems.map(i => i.col)) + 1,
      x: cropX,
      y: cropY,
      size: iconSize
    });
  }

  return crops;
}

// API路由处理函数
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { filenames, wikiName, gridSize } = body;

    if (!filenames || !Array.isArray(filenames) || filenames.length === 0) {
      return NextResponse.json({ error: 'Missing or invalid filenames parameter' }, { status: 400 });
    }

    console.log(`Processing ${filenames.length} wiki files with LLM vision analysis (parallel)`);
    if (wikiName) {
      console.log(`Wiki name: ${wikiName}`);
    }

    let allCrops: WikiCroppedImage[] = [];

    // 并行处理每个Wiki图片
    const processSingleWikiFile = async (filename: string): Promise<WikiCroppedImage[]> => {
      // 构建Wiki图片路径（支持两种来源）
      let wikiFilePath: string;
      let actualWikiName: string;

      if (wikiName) {
        // 新格式：从 public/WikiPic/{wikiName}/ 读取
        wikiFilePath = path.join(process.cwd(), 'public', 'WikiPic', wikiName, filename);
        actualWikiName = wikiName;
      } else {
        // 旧格式：从 /tmp/uploads/wiki/ 读取
        wikiFilePath = `/tmp/uploads/wiki/${filename}`;
        actualWikiName = filename.replace(/\.[^/.]+$/, '');
      }

      console.log(`Reading Wiki image from: ${wikiFilePath}`);

      // 检查文件是否存在
      try {
        await fs.access(wikiFilePath);
      } catch (error) {
        console.error(`Wiki file not found: ${wikiFilePath}`);
        return [];
      }

      // 创建Wiki目录路径
      const wikiDir = path.join(process.cwd(), 'public', 'wiki-cropped', actualWikiName);
      
      // 清理上一轮的缓存（如果存在）
      try {
        const dirExists = await fs.access(wikiDir).then(() => true).catch(() => false);
        if (dirExists) {
          console.log(`Cleaning up previous cache: ${wikiDir}`);
          await fs.rm(wikiDir, { recursive: true, force: true });
          console.log(`Previous cache cleaned successfully`);
        }
      } catch (error) {
        console.error(`Failed to clean previous cache:`, error);
        // 继续执行，即使清理失败
      }
      
      // 创建Wiki目录
      await fs.mkdir(wikiDir, { recursive: true });
      
      console.log(`Wiki directory created: ${wikiDir}`);

      // 读取图片
      const imageBuffer = await fs.readFile(wikiFilePath);
      const metadata = await sharp(imageBuffer).metadata();

      if (!metadata.width || !metadata.height) {
        console.error(`Invalid image metadata for ${filename}`);
        return [];
      }

      console.log(`Processing ${filename}: ${metadata.width}x${metadata.height}`);

      // 使用LLM视觉分析识别板块标题（用于命名）
      console.log(`Step 1: Analyzing panel titles with LLM vision...`);
      const llmTitles = await analyzeImageWithLLM(imageBuffer, metadata);
      console.log(`  LLM detected ${llmTitles.length} panel titles`);

      // 使用两级切割策略：检测板块，再检测图标底座
      console.log(`Step 2: Detecting panels and icons...`);
      const image = sharp(Buffer.from(imageBuffer));
      const crops = await detectAndCropItems(image, metadata, wikiName);
      console.log(`  Detected ${crops.length} items`);

      // 获取检测到的板块列表（通过crops的panelName去重）
      const detectedPanels = [...new Set(crops.map(c => c.panelName).filter((p): p is string => Boolean(p)))];
      console.log(`  Detected ${detectedPanels.length} panels, LLM titles: ${llmTitles.length}`);

      // 创建板块名称到标题的映射
      const panelTitleMap: Record<string, string> = {};
      
      // 处理panel索引偏移：如果detectedPanels比llmTitles多1个，说明panel_0是额外的（如COLLECTION）
      let titleIndex = 0;
      let panelIndex = 0; // 板块从0开始编号
      
      // 按panel索引排序detectedPanels
      const sortedPanels = [...detectedPanels].sort((a, b) => {
        const matchA = a.match(/_panel_(\d+)$/);
        const matchB = b.match(/_panel_(\d+)$/);
        const indexA = matchA ? parseInt(matchA[1]) : 0;
        const indexB = matchB ? parseInt(matchB[1]) : 0;
        return indexA - indexB;
      });
      
      sortedPanels.forEach((panelName) => {
        // 从panelName提取panel索引（如 "xxx_panel_3" → 3）
        const panelMatch = panelName.match(/_panel_(\d+)$/);
        const detectedPanelIndex = panelMatch ? parseInt(panelMatch[1]) : -1;
        
        // 如果panel_0且llmTitles数量少1，跳过它（可能是COLLECTION标题）
        if (detectedPanelIndex === 0 && detectedPanels.length === llmTitles.length + 1) {
          console.log(`  Skipping panel_0 (extra panel, likely COLLECTION)`);
          panelIndex++; // 仍然计数，但不分配标题
          return;
        }
        
        if (llmTitles[titleIndex]) {
          // 使用LLM标题，但板子编号从0开始
          panelTitleMap[panelName] = llmTitles[titleIndex];
          titleIndex++;
        } else {
          // 如果LLM标题不够，使用默认名称
          panelTitleMap[panelName] = `Chain_${panelIndex}`;
        }
        panelIndex++;
      });
      
      console.log(`  Panel title mapping:`, JSON.stringify(panelTitleMap));

      // 处理裁剪
      let successfulCrops = 0;
      const savedCrops: WikiCroppedImage[] = [];
      let skippedCrops = 0;
      let failedCrops = 0;

      // 按照从上到下、从左到右的顺序排序crops
      // 1. 先按panel的index排序（从上到下）
      // 2. 在同一panel内，按row和col排序（从左到右）
      const sortedCrops = [...crops].sort((a, b) => {
        // 提取panel索引
        const panelMatchA = a.panelName?.match(/_panel_(\d+)$/);
        const panelMatchB = b.panelName?.match(/_panel_(\d+)$/);
        const panelIndexA = panelMatchA ? parseInt(panelMatchA[1]) : 0;
        const panelIndexB = panelMatchB ? parseInt(panelMatchB[1]) : 0;

        // 先按panel排序
        if (panelIndexA !== panelIndexB) {
          return panelIndexA - panelIndexB;
        }

        // 在同一panel内，按row和col排序
        if (a.row !== b.row) {
          return a.row - b.row;
        }
        return a.col - b.col;
      });
      
      console.log(`  Starting to process ${sortedCrops.length} crops`);

      // 按面板分组crops，并跟踪每个面板内的序号（从0开始）
      const panelIconIndex: Record<string, number> = {};

      for (const crop of sortedCrops) {
        if (crop.path === '') {
          continue;
        }

        const panelName = crop.panelName || '';
        const title = panelTitleMap[panelName] || panelName;

        // 初始化或递增面板内的图标序号（每个面板从0开始）
        if (panelIconIndex[panelName] === undefined) {
          panelIconIndex[panelName] = 0;
        }
        const iconIndex = panelIconIndex[panelName]++;

        // 清理标题用于文件名
        const safeTitle = title.replace(/[^a-zA-Z0-9_-]/g, '_');

        const cropPath = path.join(wikiDir, crop.path);
        
        console.log(`  Saving crop: ${crop.path}`);
        console.log(`    cropPath: ${cropPath}`);
        console.log(`    safeTitle: ${safeTitle}, iconIndex: ${iconIndex}`);

        let cropX: number;
        let cropY: number;
        let cropWidth: number;
        let cropHeight: number;

        // 优先使用精确的宽度和高度，否则使用size（正方形）
        if (crop.x !== undefined && crop.y !== undefined && crop.width !== undefined && crop.height !== undefined) {
          cropX = crop.x;
          cropY = crop.y;
          cropWidth = crop.width;
          cropHeight = crop.height;
        } else if (crop.x !== undefined && crop.y !== undefined && crop.size !== undefined) {
          cropX = crop.x;
          cropY = crop.y;
          cropWidth = crop.size;
          cropHeight = crop.size;
        } else {
          const cellWidth = metadata.width / crop.totalCols;
          const cellHeight = metadata.height / crop.totalRows;
          cropX = Math.round(crop.col * cellWidth);
          cropY = Math.round(crop.row * cellHeight);
          cropWidth = Math.max(cellWidth, cellHeight);
          cropHeight = cropWidth; // 正方形
        }

        const safeX = Math.max(0, Math.min(cropX, metadata.width - 1));
        const safeY = Math.max(0, Math.min(cropY, metadata.height - 1));
        const maxWidth = metadata.width - safeX;
        const maxHeight = metadata.height - safeY;
        const safeWidth = Math.min(cropWidth, maxWidth);
        const safeHeight = Math.min(cropHeight, maxHeight);

        if (safeWidth < 10 || safeHeight < 10) {
          console.log(`  Skipping crop: size too small (${safeWidth}x${safeHeight})`);
          skippedCrops++;
          continue;
        }

        let finalX: number, finalY: number, finalWidth: number, finalHeight: number;
        
        // 如果是LLM识别的图标，直接使用原始坐标，不做二次检测
        if (crop.isLLMDetected) {
          finalX = safeX;
          finalY = safeY;
          finalWidth = safeWidth;
          finalHeight = safeHeight;
          console.log(`  Using LLM detected position for ${safeTitle}_${iconIndex}`);
        } else {
          // 检测图标的精确边界（去除背景）
          const iconBounds = await detectIconBounds(imageBuffer, safeX, safeY, safeWidth, safeHeight);
          
          if (iconBounds) {
            finalX = iconBounds.x;
            finalY = iconBounds.y;
            finalWidth = iconBounds.width;
            finalHeight = iconBounds.height;
          } else {
            finalX = safeX;
            finalY = safeY;
            finalWidth = safeWidth;
            finalHeight = safeHeight;
          }

          // 检测精确区域是否是纯色
          const solidColor = await isSolidColor(imageBuffer, finalX, finalY, finalWidth, finalHeight);
          if (solidColor) {
            console.log(`  Skipping solid color icon ${safeTitle}_${iconIndex}`);
            skippedCrops++;
            continue;
          }
        }

        // 最终边界检查：确保裁剪区域在图片范围内
        const maxX = metadata.width || 0;
        const maxY = metadata.height || 0;
        
        // 确保坐标非负
        const clampedX = Math.max(0, finalX);
        const clampedY = Math.max(0, finalY);
        
        // 确保尺寸不超过剩余空间
        const clampedWidth = Math.min(finalWidth, maxX - clampedX);
        const clampedHeight = Math.min(finalHeight, maxY - clampedY);
        
        // 如果有效尺寸太小，跳过
        if (clampedWidth <= 0 || clampedHeight <= 0) {
          console.log(`  Skipping crop: invalid size (${clampedWidth}x${clampedHeight})`);
          skippedCrops++;
          continue;
        }

        try {
          await sharp(imageBuffer)
            .extract({ left: clampedX, top: clampedY, width: clampedWidth, height: clampedHeight })
            .png()
            .toFile(cropPath);

          console.log(`  Successfully saved: ${cropPath}`);

          successfulCrops++;

          // 重命名文件以使用标题
          const newFileName = `${safeTitle}_${iconIndex}.png`;
          const newPath = path.join(wikiDir, newFileName);
          
          console.log(`  Renaming to: ${newPath}`);
          await fs.rename(cropPath, newPath);
          
          console.log(`  Successfully renamed to: ${newFileName}`);

          savedCrops.push({
            path: newFileName,
            name: `${title}_${iconIndex}`,
            row: crop.row,
            col: crop.col,
            totalRows: crop.totalRows,
            totalCols: crop.totalCols,
            x: finalX,
            y: finalY,
            size: Math.max(finalWidth, finalHeight),
            panelName: panelName,
            title: title,
            wikiName,
            id: `${wikiName}_${newFileName}`,
            imageUrl: `/api/crops/${wikiName}/${newFileName}`
          });
        } catch (e) {
          console.error(`Failed to save crop ${crop.path}:`, e);
          console.error(`  Error details:`, JSON.stringify(e, Object.getOwnPropertyNames(e)));
        }
      }

      console.log(`Successfully processed ${successfulCrops}/${crops.length} items`);
      console.log(`  Skipped: ${skippedCrops}, Failed: ${failedCrops}`);
      return savedCrops;
    };

    // 并行处理所有Wiki文件（限制并发数为3以避免LLM API速率限制）
    const CONCURRENT_LIMIT = 3;
    const results: WikiCroppedImage[][] = [];
    
    for (let i = 0; i < filenames.length; i += CONCURRENT_LIMIT) {
      const batch = filenames.slice(i, i + CONCURRENT_LIMIT);
      console.log(`Processing batch ${Math.floor(i / CONCURRENT_LIMIT) + 1}: ${batch.join(', ')}`);
      const batchResults = await Promise.all(batch.map(filename => processSingleWikiFile(filename)));
      results.push(...batchResults);
    }
    
    // 合并所有结果
    allCrops = results.flat();
    console.log(`Total crops across all files: ${allCrops.length}`);

    console.log(`Total crops across all files: ${allCrops.length}`);

    if (allCrops.length === 0) {
      console.log('Warning: No crops were generated. This could be due to:');
      console.log('  - No panels detected');
      console.log('  - No icon bases detected in panels');
      console.log('  - All filtered out by solid color check');
      console.log('  - All crops failed to save (check error logs above)');
    }
    
    // 检查实际保存的文件
    const savedFiles: string[] = [];
    try {
      for (const wikiName of new Set(allCrops.map(c => c.wikiName).filter((w): w is string => Boolean(w)))) {
        const wikiDir = path.join(process.cwd(), 'public', 'wiki-cropped', wikiName);
        try {
          const files = await fs.readdir(wikiDir);
          savedFiles.push(...files.map(f => path.join(wikiName, f)));
        } catch (e) {
          console.error(`Failed to read wiki directory ${wikiDir}:`, e);
        }
      }
      console.log(`Actual saved files: ${savedFiles.length}`);
      if (savedFiles.length > 0) {
        console.log(`  Sample files: ${savedFiles.slice(0, 5).join(', ')}`);
      }
    } catch (e) {
      console.error(`Failed to check saved files:`, e);
    }

    // 重复图片检测
    console.log('Starting duplicate detection...');
    const duplicatesRemoved = await removeDuplicateImages(allCrops);
    if (duplicatesRemoved > 0) {
      console.log(`Removed ${duplicatesRemoved} duplicate images`);
      // 重新过滤allCrops，只保留未删除的
      const remainingFiles: string[] = [];
      for (const wikiName of new Set(allCrops.map(c => c.wikiName).filter((w): w is string => Boolean(w)))) {
        const wikiDir = path.join(process.cwd(), 'public', 'wiki-cropped', wikiName);
        try {
          const files = await fs.readdir(wikiDir);
          remainingFiles.push(...files.map(f => path.join(wikiName, f)));
        } catch (e) {
          console.error(`Failed to read wiki directory ${wikiDir}:`, e);
        }
      }
      allCrops = allCrops.filter(crop => {
        const filePath = path.join(crop.wikiName || '', crop.path);
        return remainingFiles.includes(filePath);
      });
      console.log(`Remaining crops after duplicate removal: ${allCrops.length}`);
    }

    // 统计合成链数量和详细信息
    const chains: Record<string, { title: string; iconCount: number; icons: WikiCroppedImage[] }> = {};
    
    console.log(`Starting chain counting, total crops: ${allCrops.length}`);
    
    allCrops.forEach((crop, index) => {
      const panelName = crop.panelName || '';
      const title = crop.title || panelName;
      
      console.log(`  Processing crop ${index}: panelName="${panelName}", title="${title}"`);
      
      if (!panelName) {
        console.warn(`  Warning: Crop has empty panelName, skipping chain counting`);
        return;
      }
      
      if (!chains[panelName]) {
        chains[panelName] = {
          title: title,
          iconCount: 0,
          icons: []
        };
        console.log(`    Creating new chain for panel: ${panelName} with title: ${title}`);
      }
      
      chains[panelName].iconCount++;
      chains[panelName].icons.push(crop);
    });

    const chainCount = Object.keys(chains).length;
    
    console.log(`Chain counting complete. Total chains: ${chainCount}`);
    console.log(`Chain details:`, Object.keys(chains).map(name => ({
      name,
      title: chains[name].title,
      iconCount: chains[name].iconCount
    })));

    return NextResponse.json({
      success: true,
      crops: allCrops,
      totalCrops: allCrops.length,
      chainCount: chainCount,
      chains: chains  // 每个合成链的详细信息
    });

  } catch (error: any) {
    console.error('Error processing wiki images:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to process wiki images' },
      { status: 500 }
    );
  }
}

/**
 * 回退方法：使用传统检测处理crops
 */
async function processCropsWithFallback(
  crops: WikiCroppedImage[],
  wikiDir: string,
  wikiName: string,
  imageBuffer: Buffer,
  metadata: sharp.Metadata,
  allCrops: WikiCroppedImage[]
) {
  let successfulCrops = 0;

  for (const crop of crops) {
    if (crop.path === '') {
      continue;
    }

    const cropPath = path.join(wikiDir, crop.path);

    let cropX: number;
    let cropY: number;
    let cropSize: number;

    if (crop.x !== undefined && crop.y !== undefined && crop.size !== undefined) {
      cropX = crop.x;
      cropY = crop.y;
      cropSize = crop.size;
    } else {
      const cellWidth = metadata.width / crop.totalCols;
      const cellHeight = metadata.height / crop.totalRows;
      cropX = Math.round(crop.col * cellWidth);
      cropY = Math.round(crop.row * cellHeight);
      cropSize = Math.max(cellWidth, cellHeight);
    }

    const safeX = Math.max(0, Math.min(cropX, metadata.width - 1));
    const safeY = Math.max(0, Math.min(cropY, metadata.height - 1));
    const maxWidth = metadata.width - safeX;
    const maxHeight = metadata.height - safeY;
    const safeSize = Math.min(cropSize, maxWidth, maxHeight);

    if (safeSize < 10) continue;

    const solidColor = await isSolidColor(imageBuffer, safeX, safeY, safeSize, safeSize);
    if (solidColor) continue;

    try {
      await sharp(imageBuffer)
        .extract({ left: safeX, top: safeY, width: safeSize, height: safeSize })
        .png()
        .toFile(cropPath);

      successfulCrops++;
      allCrops.push({
        ...crop,
        wikiName,
        id: `${wikiName}_${crop.path}`,
        imageUrl: `/api/crops/${wikiName}/${crop.path}`
      });
    } catch (e) {
      console.error(`Failed to save crop ${crop.path}:`, e);
    }
  }

  console.log(`Fallback processing: ${successfulCrops}/${crops.length} items`);
}
