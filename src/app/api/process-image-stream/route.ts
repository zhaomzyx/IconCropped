import { NextRequest } from 'next/server';
import sharp from 'sharp';
import path from 'path';
import fs from 'fs/promises';
import { cwd } from 'process';

// 发送SSE事件
function sendEvent(stream: ReadableStreamDefaultController<any>, event: string, data: any) {
  const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  stream.enqueue(new TextEncoder().encode(message));
}

// 接口定义
interface WikiCroppedImage {
  path: string;
  name: string;
  row: number;
  col: number;
  totalRows: number;
  totalCols: number;
  x?: number;
  y?: number;
  size?: number;
  width?: number;
  height?: number;
  panelName?: string;
  wikiName?: string;
  id?: string;
  imageUrl?: string;
  title?: string;
}

interface Panel {
  x: number;
  y: number;
  width: number;
  height: number;
  index: number;
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

// SSE版本的process-image API
export async function POST(request: NextRequest) {
  const body = await request.json();
  const { filenames, wikiName, gridSize } = body;

  if (!filenames || !Array.isArray(filenames) || filenames.length === 0) {
    return new Response(JSON.stringify({ error: 'Missing or invalid filenames parameter' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  console.log(`Processing ${filenames.length} wiki files with SSE streaming (color-based detection)`);

  // 创建SSE流
  const stream = new ReadableStream({
    async start(controller) {
      try {
        // 阶段1：整体梳理
        sendEvent(controller, 'progress', {
          step: 'preparing',
          message: `📊 正在梳理图片资源（共${filenames.length}张）...`,
          totalImages: filenames.length
        });

        await new Promise(resolve => setTimeout(resolve, 500));

        let allCrops: WikiCroppedImage[] = [];
        let totalCropsCount = 0;

        // 逐张处理
        for (let i = 0; i < filenames.length; i++) {
          const filename = filenames[i];

          // 阶段2：开始处理单张图片
          sendEvent(controller, 'progress', {
            step: 'processing_image',
            message: `🖼️ 正在处理第 ${i + 1}/${filenames.length} 张图片...`,
            currentImage: i + 1,
            totalImages: filenames.length,
            filename: filename
          });

          try {
            // 构建Wiki图片路径
            let wikiFilePath: string;
            let actualWikiName: string;

            if (wikiName) {
              wikiFilePath = path.join(cwd(), 'public', 'WikiPic', wikiName, filename);
              actualWikiName = wikiName;
            } else {
              wikiFilePath = `/tmp/uploads/wiki/${filename}`;
              actualWikiName = filename.replace(/\.[^/.]+$/, '');
            }

            console.log(`Reading Wiki image from: ${wikiFilePath}`);

            // 检查文件是否存在
            await fs.access(wikiFilePath);

            // 创建Wiki目录路径
            const wikiDir = path.join(cwd(), 'public', 'wiki-cropped', actualWikiName);

            // 清理上一轮的缓存
            try {
              await fs.rm(wikiDir, { recursive: true, force: true });
            } catch (error) {
              // 忽略错误
            }

            await fs.mkdir(wikiDir, { recursive: true });

            // 读取图片
            const imageBuffer = await fs.readFile(wikiFilePath);
            const metadata = await sharp(imageBuffer).metadata();

            if (!metadata.width || !metadata.height) {
              throw new Error(`Invalid image metadata`);
            }

            const image = sharp(imageBuffer);

            // 阶段3：一级裁切（使用颜色检测大板）
            sendEvent(controller, 'progress', {
              step: 'detecting_panels',
              message: `🔍 图片 ${i + 1}/${filenames.length} - 一级裁切：正在检测大板...`,
              currentImage: i + 1,
              totalImages: filenames.length,
              filename: filename,
              subStep: 'panel_detection'
            });

            const panels = await detectPanels(image, metadata);
            console.log(`  Detected ${panels.length} panels`);

            // 阶段4：使用LLM只检测标题
            sendEvent(controller, 'progress', {
              step: 'detecting_titles',
              message: `📝 图片 ${i + 1}/${filenames.length} - 正在识别板块标题...`,
              currentImage: i + 1,
              totalImages: filenames.length,
              totalPanels: panels.length,
              filename: filename,
              subStep: 'title_detection'
            });

            const panelTitles = await detectPanelTitlesWithLLM(imageBuffer, metadata, panels);
            console.log(`  LLM detected ${panelTitles.length} titles`);

            // 阶段5：二级裁切（使用颜色检测小板）
            sendEvent(controller, 'progress', {
              step: 'cutting_icons',
              message: `✂️ 图片 ${i + 1}/${filenames.length} - 二级裁切：正在处理 ${panels.length} 个板块...`,
              currentImage: i + 1,
              totalImages: filenames.length,
              totalPanels: panels.length,
              filename: filename,
              subStep: 'icon_cutting'
            });

            // 处理每个板块
            const crops: WikiCroppedImage[] = [];
            
            for (let j = 0; j < panels.length; j++) {
              const panel = panels[j];
              const title = panelTitles[j] || `板块_${j + 1}`;

              sendEvent(controller, 'progress', {
                step: 'processing_panel',
                message: `🎨 图片 ${i + 1}/${filenames.length} - 板块 ${j + 1}/${panels.length}：${title}`,
                currentImage: i + 1,
                totalImages: filenames.length,
                currentPanel: j + 1,
                totalPanels: panels.length,
                panelTitle: title,
                filename: filename,
                subStep: 'panel_processing'
              });

              // 在板块内检测小板（图标底座）
              const iconBases = await detectIconBasesInPanel(imageBuffer, metadata, panel);
              console.log(`  Panel ${j}: detected ${iconBases.length} icons`);

              // 聚类成网格
              const gridItems = clusterToGrid(iconBases);

              // 裁切图标
              for (const gridItem of gridItems) {
                const base = gridItem.box;
                const iconFileName = `${title}_${gridItem.col}.png`;
                const iconPath = path.join(wikiDir, iconFileName);

                // 裁切区域（稍微扩大10%以包含完整内容）
                const padding = Math.round(Math.max(base.width, base.height) * 0.1);
                const cropX = Math.max(0, base.x - padding);
                const cropY = Math.max(0, base.y - padding);
                const cropWidth = base.width + padding * 2;
                const cropHeight = base.height + padding * 2;

                // 边界检查
                const finalX = Math.min(cropX, metadata.width - cropWidth);
                const finalY = Math.min(cropY, metadata.height - cropHeight);
                const finalWidth = Math.min(cropWidth, metadata.width - finalX);
                const finalHeight = Math.min(cropHeight, metadata.height - finalY);

                if (finalWidth > 20 && finalHeight > 20) {
                  try {
                    await sharp(imageBuffer)
                      .extract({ left: finalX, top: finalY, width: finalWidth, height: finalHeight })
                      .png()
                      .toFile(iconPath);

                    crops.push({
                      path: iconFileName,
                      name: `${title}_${gridItem.col}`,
                      row: gridItem.row,
                      col: gridItem.col,
                      totalRows: gridItems.length > 0 ? Math.max(...gridItems.map(g => g.row)) + 1 : 1,
                      totalCols: gridItems.length > 0 ? Math.max(...gridItems.map(g => g.col)) + 1 : 1,
                      x: finalX,
                      y: finalY,
                      width: finalWidth,
                      height: finalHeight,
                      panelName: title,
                      title: title,
                      wikiName: actualWikiName,
                      id: `${actualWikiName}_${iconFileName}`,
                      imageUrl: `/api/crops/${actualWikiName}/${iconFileName}`
                    });

                    console.log(`  Saved icon: ${iconFileName}`);
                  } catch (e) {
                    console.error(`  Failed to save icon ${iconFileName}:`, e);
                  }
                }
              }
            }

            allCrops = allCrops.concat(crops);
            totalCropsCount += crops.length;

            sendEvent(controller, 'image_complete', {
              message: `✓ 图片 ${i + 1}/${filenames.length} 处理完成，已切割 ${crops.length} 个图标`,
              currentImage: i + 1,
              totalImages: filenames.length,
              filename: filename,
              cropsCount: crops.length,
              totalCropsCount: totalCropsCount
            });

          } catch (error: any) {
            console.error(`Failed to process image ${i}:`, error);
            sendEvent(controller, 'error', {
              message: `✗ 图片 ${i + 1}/${filenames.length} 处理失败：${error.message}`,
              currentImage: i + 1,
              totalImages: filenames.length,
              filename: filename
            });
          }
        }

        // 阶段6：全部完成
        sendEvent(controller, 'progress', {
          step: 'complete',
          message: `✅ 全部完成！共处理 ${totalCropsCount} 个图标`,
          totalImages: filenames.length,
          totalCrops: totalCropsCount
        });

        sendEvent(controller, 'complete', {
          success: true,
          crops: allCrops,
          wikiName: wikiName
        });

        controller.close();

      } catch (error: any) {
        console.error('Process image stream error:', error);
        sendEvent(controller, 'error', {
          message: error.message || '处理失败',
          stack: error.stack
        });
        controller.close();
      }
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    }
  });
}

// ========== 颜色检测函数 ==========

// 检测背景颜色
function detectBackgroundColor(
  data: Buffer,
  width: number,
  height: number,
  channels: number
): { r: number; g: number; b: number } {
  const rValues: number[] = [];
  const gValues: number[] = [];
  const bValues: number[] = [];
  const margin = 5;

  // 采样边缘像素
  for (let y = 0; y < margin && y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * channels;
      rValues.push(data[idx]);
      gValues.push(data[idx + 1]);
      bValues.push(data[idx + 2]);
    }
  }

  // 使用中位数
  rValues.sort((a, b) => a - b);
  gValues.sort((a, b) => a - b);
  bValues.sort((a, b) => a - b);

  return {
    r: rValues[Math.floor(rValues.length / 2)],
    g: gValues[Math.floor(gValues.length / 2)],
    b: bValues[Math.floor(bValues.length / 2)]
  };
}

// 计算自适应阈值（使用Otsu方法）
function calculateAdaptiveThreshold(
  data: Buffer,
  width: number,
  height: number,
  channels: number,
  backgroundColor: { r: number; g: number; b: number },
  targetType: 'panel' | 'icon' = 'panel'
): number {
  // 计算所有像素与背景色的差异
  const colorDiffs: number[] = [];
  const sampleRate = Math.max(1, Math.floor((width * height) / 10000)); // 采样最多10000个像素

  for (let i = 0; i < width * height; i += sampleRate) {
    const r = data[i * channels];
    const g = data[i * channels + 1];
    const b = data[i * channels + 2];

    const diff = Math.abs(r - backgroundColor.r) +
                  Math.abs(g - backgroundColor.g) +
                  Math.abs(b - backgroundColor.b);
    colorDiffs.push(diff);
  }

  colorDiffs.sort((a, b) => a - b);

  const p25 = colorDiffs[Math.floor(colorDiffs.length * 0.25)];
  const p50 = colorDiffs[Math.floor(colorDiffs.length * 0.5)];
  const p75 = colorDiffs[Math.floor(colorDiffs.length * 0.75)];

  console.log(`  Color diff stats: 25%=${p25}, 50%=${p50}, 75%=${p75}`);

  // 使用Otsu方法计算最佳阈值
  let maxVariance = 0;
  let bestThreshold = 0;
  const histogram = new Array(766).fill(0); // 最大可能的颜色差异是 255*3=765

  // 构建直方图
  for (const diff of colorDiffs) {
    const idx = Math.min(Math.floor(diff), 765);
    histogram[idx]++;
  }

  const totalPixels = colorDiffs.length;
  let sum = 0;
  for (let i = 0; i < 766; i++) {
    sum += i * histogram[i];
  }

  let sumB = 0;
  let wB = 0;
  for (let t = 0; t < 766; t++) {
    wB += histogram[t];
    if (wB === 0) continue;

    const wF = totalPixels - wB;
    if (wF === 0) break;

    sumB += t * histogram[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;

    const variance = wB * wF * (mB - mF) * (mB - mF);
    if (variance > maxVariance) {
      maxVariance = variance;
      bestThreshold = t;
    }
  }

  console.log(`  Otsu threshold: ${bestThreshold}`);

  // 根据目标类型调整阈值
  if (targetType === 'panel') {
    // 对于大板检测：使用Otsu阈值，稍微降低以增加检测敏感度
    const adaptiveThreshold = Math.max(60, Math.floor(bestThreshold * 0.7));
    console.log(`  Panel threshold: ${adaptiveThreshold} (adjusted from Otsu)`);
    return adaptiveThreshold;
  } else {
    // 对于小板检测：使用更高的Otsu阈值，更精确的检测
    const adaptiveThreshold = Math.max(80, Math.floor(bestThreshold * 1.2));
    console.log(`  Icon threshold: ${adaptiveThreshold} (adjusted from Otsu)`);
    return adaptiveThreshold;
  }
}

// 检测大板块（颜色检测）
async function detectPanels(image: sharp.Sharp, metadata: sharp.Metadata): Promise<Panel[]> {
  const { width, height } = metadata;

  // 缩放以提高处理速度
  const scaleFactor = Math.min(1, 800 / Math.max(width, height));
  const scaledWidth = Math.round(width * scaleFactor);
  const scaledHeight = Math.round(height * scaleFactor);

  const { data, info } = await image
    .resize(scaledWidth, scaledHeight, { fit: 'inside' })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const channels = info.channels;

  // 检测背景颜色
  const backgroundColor = detectBackgroundColor(data, scaledWidth, scaledHeight, channels);
  console.log(`  Background: RGB(${backgroundColor.r},${backgroundColor.g},${backgroundColor.b})`);

  // 计算自适应阈值
  const threshold = calculateAdaptiveThreshold(data, scaledWidth, scaledHeight, channels, backgroundColor, 'panel');

  // 创建板块掩码（浅色区域）
  const mask = Buffer.alloc(scaledWidth * scaledHeight);

  for (let i = 0; i < scaledWidth * scaledHeight; i++) {
    const r = data[i * channels];
    const g = data[i * channels + 1];
    const b = data[i * channels + 2];

    const colorDiff = Math.abs(r - backgroundColor.r) +
                      Math.abs(g - backgroundColor.g) +
                      Math.abs(b - backgroundColor.b);

    if (colorDiff > threshold) {
      mask[i] = 1;
    } else {
      mask[i] = 0;
    }
  }

  // 连通区域分析
  const boundingBoxes = findBoundingBoxes(mask, scaledWidth, scaledHeight);

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

// 检测板块内的图标底座（颜色检测）
async function detectIconBasesInPanel(
  imageBuffer: Buffer,
  metadata: sharp.Metadata,
  panel: Panel
): Promise<BoundingBox[]> {
  // 提取板块区域
  const { data, info } = await sharp(imageBuffer)
    .extract({ left: panel.x, top: panel.y, width: panel.width, height: panel.height })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const channels = info.channels;
  const w = info.width;
  const h = info.height;

  // 检测板块背景颜色
  const backgroundColor = detectBackgroundColor(data, w, h, channels);
  console.log(`    Icon base background: RGB(${backgroundColor.r},${backgroundColor.g},${backgroundColor.b})`);

  // 计算自适应阈值
  const threshold = calculateAdaptiveThreshold(data, w, h, channels, backgroundColor, 'icon');

  // 创建底座掩码（深色区域）
  const mask = Buffer.alloc(w * h);

  for (let i = 0; i < w * h; i++) {
    const r = data[i * channels];
    const g = data[i * channels + 1];
    const b = data[i * channels + 2];

    const colorDiff = Math.abs(r - backgroundColor.r) +
                      Math.abs(g - backgroundColor.g) +
                      Math.abs(b - backgroundColor.b);

    if (colorDiff > threshold) {
      mask[i] = 1;
    } else {
      mask[i] = 0;
    }
  }

  // 连通区域分析
  const boundingBoxes = findBoundingBoxes(mask, w, h);

  // 转换回全局坐标
  return boundingBoxes.map(box => ({
    x: panel.x + Math.round(box.x),
    y: panel.y + Math.round(box.y),
    width: Math.round(box.width),
    height: Math.round(box.height)
  }));
}

// 找到连通区域
function findBoundingBoxes(mask: Buffer, width: number, height: number): BoundingBox[] {
  const visited = Buffer.alloc(width * height, 0);
  const boxes: BoundingBox[] = [];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (mask[idx] === 1 && visited[idx] === 0) {
        const box = findConnectedComponent(mask, visited, width, height, x, y);
        if (box.width > 10 && box.height > 10) {
          boxes.push(box);
        }
      }
    }
  }

  return boxes;
}

// 找到连通区域（BFS）
function findConnectedComponent(
  mask: Buffer,
  visited: Buffer,
  width: number,
  height: number,
  startX: number,
  startY: number
): BoundingBox {
  const queue = [[startX, startY]];
  visited[startY * width + startX] = 1;

  let minX = startX, maxX = startX;
  let minY = startY, maxY = startY;

  while (queue.length > 0) {
    const [x, y] = queue.shift()!;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);

    // 检查8邻域
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx;
        const ny = y + dy;

        if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
          const idx = ny * width + nx;
          if (mask[idx] === 1 && visited[idx] === 0) {
            visited[idx] = 1;
            queue.push([nx, ny]);
          }
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

// 将边界框聚类到网格
function clusterToGrid(boxes: BoundingBox[]): GridItem[] {
  if (boxes.length === 0) return [];

  // 按Y坐标排序
  const sortedByY = [...boxes].sort((a, b) => a.y - b.y);

  // 检测行
  const rows: BoundingBox[][] = [];
  const avgHeight = boxes.reduce((sum, b) => sum + b.height, 0) / boxes.length;

  for (let i = 0; i < sortedByY.length; i++) {
    if (rows.length === 0) {
      rows.push([sortedByY[i]]);
    } else {
      const lastRow = rows[rows.length - 1];
      const centerY1 = lastRow[0].y + lastRow[0].height / 2;
      const centerY2 = sortedByY[i].y + sortedByY[i].height / 2;

      if (Math.abs(centerY2 - centerY1) < avgHeight * 0.5) {
        lastRow.push(sortedByY[i]);
      } else {
        rows.push([sortedByY[i]]);
      }
    }
  }

  // 检测列
  const gridItems: GridItem[] = [];
  for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
    const row = rows[rowIdx];
    const sortedByX = [...row].sort((a, b) => a.x - b.x);
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

// ========== LLM标题检测（只检测标题） ==========

async function detectPanelTitlesWithLLM(
  imageBuffer: Buffer,
  metadata: sharp.Metadata,
  panels: Panel[]
): Promise<string[]> {
  // 提取前3个板块的标题区域用于LLM识别
  const samplePanels = panels.slice(0, 3);

  if (samplePanels.length === 0) {
    return panels.map((_, i) => `板块_${i + 1}`);
  }

  // 构建拼接图片（包含多个板块的标题区域）
  const titleImages: Buffer[] = [];
  for (const panel of samplePanels) {
    const titleHeight = Math.floor(panel.height * 0.15); // 标题区域占板块的15%
    if (titleHeight > 0) {
      const titleBuffer = await sharp(imageBuffer)
        .extract({ left: panel.x, top: panel.y, width: panel.width, height: titleHeight })
        .png()
        .toBuffer();
      titleImages.push(titleBuffer);
    }
  }

  if (titleImages.length === 0) {
    return panels.map((_, i) => `板块_${i + 1}`);
  }

  // 拼接标题图片（垂直拼接）
  let concatenatedImage: Buffer;
  if (titleImages.length === 1) {
    concatenatedImage = titleImages[0];
  } else {
    // 获取每个图片的尺寸
    const sizes = await Promise.all(titleImages.map(b => sharp(b).metadata()));
    const maxWidth = Math.max(...sizes.map(s => s.width || 0));
    const totalHeight = sizes.reduce((sum, s) => sum + (s.height || 0), 0);

    // 创建白色背景
    concatenatedImage = await sharp({
      create: {
        width: maxWidth,
        height: totalHeight,
        channels: 3,
        background: { r: 255, g: 255, b: 255 }
      }
    }).composite(titleImages.map((buf, i) => ({
      input: buf,
      top: sizes.slice(0, i).reduce((sum, s) => sum + (s.height || 0), 0),
      left: 0
    }))).png().toBuffer();
  }

  // 转换为base64
  const base64Image = concatenatedImage.toString('base64');
  const dataUri = `data:image/png;base64,${base64Image}`;

  // LLM提示词（只识别标题）
  const prompt = `请识别这些Wiki板块的标题。

请只返回标题列表，格式如下：
["标题1", "标题2", "标题3"]

要求：
1. 只返回JSON数组，不要其他文字
2. 标题使用英文（如果图片是英文）
3. 精确识别文字`;

  // 这里需要调用LLM API
  // 如果失败，返回默认标题
  try {
    // TODO: 实际调用LLM
    return samplePanels.map((_, i) => `板块_${i + 1}`);
  } catch (error) {
    console.error('LLM title detection failed:', error);
    return panels.map((_, i) => `板块_${i + 1}`);
  }
}
