import { NextRequest } from 'next/server';
import sharp from 'sharp';
import path from 'path';
import fs from 'fs/promises';
import { cwd } from 'process';
import { LLMClient, Config, HeaderUtils } from 'coze-coding-dev-sdk';

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

            console.log(`  Image metadata: ${metadata.width}x${metadata.height}, format=${metadata.format}`);

            const image = sharp(imageBuffer);

            // 阶段3：一级裁切（使用LLM识别大板块）
            sendEvent(controller, 'progress', {
              step: 'detecting_panels',
              message: `🔍 图片 ${i + 1}/${filenames.length} - 一级裁切：正在识别大板块（LLM视觉识别）...`,
              currentImage: i + 1,
              totalImages: filenames.length,
              filename: filename,
              subStep: 'panel_detection'
            });

            const panelData = await detectPanelsWithLLM(imageBuffer, metadata, filename);
            console.log(`  LLM detected ${panelData.panels.length} panels`);

            // 创建大panel缓存目录
            const bigPanelDir = path.join(cwd(), 'public', 'wiki-big-cropped', actualWikiName);
            try {
              await fs.rm(bigPanelDir, { recursive: true, force: true });
            } catch (error) {
              // 忽略错误
            }
            await fs.mkdir(bigPanelDir, { recursive: true });

            // 保存一级裁切的大panel图片（用于调试）
            for (let j = 0; j < panelData.panels.length; j++) {
              const panel = panelData.panels[j];
              const title = panel.title || `板块_${j + 1}`;

              // 边界检查和修正
              const correctedX = Math.max(0, Math.min(panel.x, metadata.width! - 1));
              const correctedY = Math.max(0, Math.min(panel.y, metadata.height! - 1));
              const correctedWidth = Math.max(1, Math.min(panel.width, metadata.width! - correctedX));
              const correctedHeight = Math.max(1, Math.min(panel.height, metadata.height! - correctedY));

              // 保存大panel图片
              const panelImagePath = path.join(bigPanelDir, `${title}.png`);
              try {
                await sharp(imageBuffer)
                  .extract({ left: correctedX, top: correctedY, width: correctedWidth, height: correctedHeight })
                  .png()
                  .toFile(panelImagePath);
                console.log(`  Saved big panel: ${title}.png (${correctedWidth}x${correctedHeight})`);
              } catch (e) {
                console.error(`  Failed to save big panel ${title}:`, e);
              }
            }

            // 阶段4：二级裁切（使用LLM识别每个板块的图标底座）
            sendEvent(controller, 'progress', {
              step: 'cutting_icons',
              message: `✂️ 图片 ${i + 1}/${filenames.length} - 二级裁切：正在处理 ${panelData.panels.length} 个板块...`,
              currentImage: i + 1,
              totalImages: filenames.length,
              totalPanels: panelData.panels.length,
              filename: filename,
              subStep: 'icon_cutting'
            });

            // 处理每个板块
            const crops: WikiCroppedImage[] = [];

            for (let j = 0; j < panelData.panels.length; j++) {
              const panel = panelData.panels[j];
              const title = panel.title || `板块_${j + 1}`;

              sendEvent(controller, 'progress', {
                step: 'processing_panel',
                message: `🎨 图片 ${i + 1}/${filenames.length} - 板块 ${j + 1}/${panelData.panels.length}：${title}`,
                currentImage: i + 1,
                totalImages: filenames.length,
                currentPanel: j + 1,
                totalPanels: panelData.panels.length,
                panelTitle: title,
                filename: filename,
                subStep: 'panel_processing'
              });

              // 使用图像处理算法精确检测浅米色圆角矩形框
              const panelRegion: BoundingBox = {
                x: panel.x,
                y: panel.y,
                width: panel.width,
                height: panel.height
              };

              const beigeRectangles = await detectBeigeRectangles(imageBuffer, panelRegion);
              console.log(`  Panel ${j} (${title}): detected ${beigeRectangles.length} beige rectangles`);

              if (beigeRectangles.length === 0) {
                console.warn(`  No beige rectangles found for panel "${title}", skipping...`);
                continue;
              }

              // 根据坐标对浅米色矩形框进行排序（从上到下，从左到右）
              // 使用聚类算法将矩形框分配到网格位置
              const gridItems = clusterIconBasesToGrid(beigeRectangles, panel.rows, panel.cols);

              console.log(`  Grid items: ${gridItems.length}, rows=${panel.rows}, cols=${panel.cols}`);

              // 计算总行数和总列数
              const totalRows = gridItems.length > 0 ? Math.max(...gridItems.map(g => g.row)) + 1 : 1;
              const totalCols = gridItems.length > 0 ? Math.max(...gridItems.map(g => g.col)) + 1 : 1;

              // 统一裁切尺寸：130x130
              // 注意：这里使用矩形框的精确边界，而不是固定的130x130
              // 如果矩形框接近130x130，就使用矩形框的边界
              // 否则使用130x130并以矩形框中心为基准
              const targetSize = 130;

              // 裁切图标（使用矩形框的精确边界）
              for (const gridItem of gridItems) {
                const base = gridItem.box;

                // 计算图标序号（行优先）
                const iconIndex = gridItem.row * totalCols + gridItem.col;
                const iconFileName = `${title}_icon_${iconIndex}.png`;
                const iconPath = path.join(wikiDir, iconFileName);

                // 使用矩形框的精确边界进行裁切
                // 添加一点边距（2像素）以包含完整的圆角
                const padding = 2;
                let cropX = Math.max(0, Math.round(base.x - padding));
                let cropY = Math.max(0, Math.round(base.y - padding));
                let cropWidth = Math.min(base.width + padding * 2, metadata.width - cropX);
                let cropHeight = Math.min(base.height + padding * 2, metadata.height - cropY);

                // 如果矩形框尺寸接近130x130，直接使用矩形框边界
                // 否则，以矩形框中心为基准，裁切130x130
                const isNearTargetSize =
                  Math.abs(base.width - targetSize) < 20 &&
                  Math.abs(base.height - targetSize) < 20;

                if (!isNearTargetSize) {
                  // 使用固定尺寸130x130，以矩形框中心为基准
                  const centerX = base.x + base.width / 2;
                  const centerY = base.y + base.height / 2;

                  cropX = Math.max(0, Math.round(centerX - targetSize / 2));
                  cropY = Math.max(0, Math.round(centerY - targetSize / 2));
                  cropWidth = Math.min(targetSize, metadata.width - cropX);
                  cropHeight = Math.min(targetSize, metadata.height - cropY);
                }

                console.log(`  Icon ${iconIndex}: rect=(${Math.round(base.x)},${Math.round(base.y)},${Math.round(base.width)},${Math.round(base.height)}), crop=(${cropX},${cropY},${cropWidth},${cropHeight})`);

                // 边界检查（确保裁切区域不超出原图）
                if (cropX >= 0 && cropY >= 0 && cropX + cropWidth <= metadata.width && cropY + cropHeight <= metadata.height) {
                  try {
                    await sharp(imageBuffer)
                      .extract({ left: cropX, top: cropY, width: cropWidth, height: cropHeight })
                      .png()
                      .toFile(iconPath);

                    crops.push({
                      path: iconFileName,
                      name: `${title}_icon_${iconIndex}`,
                      row: gridItem.row,
                      col: gridItem.col,
                      totalRows: totalRows,
                      totalCols: totalCols,
                      x: cropX,
                      y: cropY,
                      width: cropWidth,
                      height: cropHeight,
                      panelName: title,
                      title: title,
                      wikiName: actualWikiName,
                      id: `${actualWikiName}_${iconFileName}`,
                      imageUrl: `/api/crops/${actualWikiName}/${iconFileName}`
                    });

                    console.log(`  Saved icon: ${iconFileName} (row=${gridItem.row}, col=${gridItem.col}, size=${cropWidth}x${cropHeight})`);
                  } catch (e) {
                    console.error(`  Failed to save icon ${iconFileName}:`, e);
                  }
                } else {
                  console.warn(`  Icon ${iconIndex} out of bounds, skipping`);
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

// ========== LLM视觉识别函数 ==========

// 使用LLM识别Wiki图中的所有大板块
interface PanelInfo {
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rows: number;
  cols: number;
}

interface PanelDetectionResult {
  panels: PanelInfo[];
}

async function detectPanelsWithLLM(
  imageBuffer: Buffer,
  metadata: sharp.Metadata,
  filename: string
): Promise<PanelDetectionResult> {
  // 如果图片太大，先缩放到合理尺寸（避免超出LLM token限制）
  let processBuffer = imageBuffer;
  const maxWidth = 2000;
  if (metadata.width && metadata.width > maxWidth) {
    const scale = maxWidth / metadata.width;
    processBuffer = await sharp(imageBuffer)
      .resize(maxWidth, null)
      .toBuffer();
  }

  // 转换为base64
  const base64Image = processBuffer.toString('base64');
  const dataUri = `data:image/png;base64,${base64Image}`;

  // LLM提示词（识别所有大板块）
  const prompt = `识别图片中所有板块。每个板块由三部分组成：1）顶部英文标题（如"Bag"）；2）标题下方的水平分隔线；3）下方的图标网格（多个方形图标底座排列成多行多列）。返回JSON数组，每个元素包含：title（板块标题）、x（板块左上角X坐标）、y（板块左上角Y坐标）、width（板块宽度，通常从左边界到右边界）、height（板块高度，从标题到图标网格底部）、rows（图标网格的行数）、cols（图标网格的列数）。注意：height必须足够大以包含整个图标网格，每个图标通常约130像素高。例如：[{"title":"Bag","x":10,"y":20,"width":900,"height":400,"rows":2,"cols":5}]`;

  try {
    // 调用LLM API
    const config = new Config();
    const client = new LLMClient(config);

    const messages = [
      {
        role: "user" as const,
        content: [
          { type: "text" as const, text: prompt },
          {
            type: "image_url" as const,
            image_url: {
              url: dataUri,
              detail: "high" as const
            }
          }
        ]
      }
    ];

    const response = await client.invoke(messages, {
      model: "doubao-seed-1-6-vision-250815",
      temperature: 0.3
    });

    console.log(`  LLM response for panel detection:`, response.content.substring(0, 500));

    // 解析LLM返回的JSON
    let jsonText = response.content.trim();

    // 尝试多种JSON提取方式
    let jsonMatch = jsonText.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      // 尝试去掉markdown代码块标记
      const codeBlockMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      if (codeBlockMatch) {
        jsonText = codeBlockMatch[1].trim();
        jsonMatch = jsonText.match(/\[[\s\S]*\]/);
      }
    }

    if (!jsonMatch) {
      console.error(`  Failed to parse LLM response for panel detection:`, response.content);
      throw new Error('无法解析LLM返回的JSON，返回内容不符合预期格式');
    }

    let panels;
    try {
      panels = JSON.parse(jsonMatch[0]);
    } catch (parseError) {
      console.error(`  JSON parse error for panel detection:`, parseError);
      console.error(`  JSON text:`, jsonMatch[0]);
      throw new Error(`JSON解析失败: ${parseError instanceof Error ? parseError.message : '未知错误'}`);
    }

    console.log(`  LLM detected ${panels.length} panels:`, panels.map((p: any) => p.title).join(', '));

    // 验证板块高度是否合理
    panels.forEach((panel: any) => {
      const expectedMinHeight = 50 + (panel.rows * 130); // 标题50像素 + 每个图标130像素
      if (panel.height < expectedMinHeight) {
        console.warn(`  Panel "${panel.title}" height (${panel.height}) may be too small. Expected at least ${expectedMinHeight} for ${panel.rows} rows.`);
        console.warn(`  Panel coords: x=${panel.x}, y=${panel.y}, width=${panel.width}, height=${panel.height}, rows=${panel.rows}, cols=${panel.cols}`);
      }
    });

    return { panels };

  } catch (error) {
    console.error('LLM panel detection failed:', error);
    throw new Error(`LLM板块识别失败: ${error instanceof Error ? error.message : '未知错误'}`);
  }
}

// 使用LLM识别板块内的图标底座
async function detectIconBasesWithLLM(
  imageBuffer: Buffer,
  metadata: sharp.Metadata,
  panel: PanelInfo,
  filename: string
): Promise<BoundingBox[]> {
  // 边界检查和修正
  const imgWidth = metadata.width!;
  const imgHeight = metadata.height!;

  console.log(`  Image size: ${imgWidth}x${imgHeight}`);
  console.log(`  Panel ${panel.title}: x=${panel.x}, y=${panel.y}, width=${panel.width}, height=${panel.height}`);

  // 计算修正后的裁切区域（确保不超出图片边界）
  const correctedX = Math.max(0, Math.min(panel.x, imgWidth - 1));
  const correctedY = Math.max(0, Math.min(panel.y, imgHeight - 1));
  const correctedWidth = Math.max(1, Math.min(panel.width, imgWidth - correctedX));
  const correctedHeight = Math.max(1, Math.min(panel.height, imgHeight - correctedY));

  console.log(`  Corrected panel: x=${correctedX}, y=${correctedY}, width=${correctedWidth}, height=${correctedHeight}`);

  // 检查是否有大幅修正
  if (correctedWidth !== panel.width || correctedHeight !== panel.height ||
      correctedX !== panel.x || correctedY !== panel.y) {
    console.warn(`  Panel "${panel.title}" coordinates were corrected to fit within image boundaries.`);
    console.warn(`  Original: x=${panel.x}, y=${panel.y}, w=${panel.width}, h=${panel.height}`);
    console.warn(`  Corrected: x=${correctedX}, y=${correctedY}, w=${correctedWidth}, h=${correctedHeight}`);
  }

  // 检查修正后的尺寸是否太小（如果小于预期的一半，可能LLM识别有误）
  const expectedMinWidth = panel.cols * 100; // 每列至少100像素
  const expectedMinHeight = 50 + panel.rows * 100; // 标题50像素 + 每行至少100像素

  if (correctedWidth < expectedMinWidth / 2 || correctedHeight < expectedMinHeight / 2) {
    console.warn(`  Panel "${panel.title}" size after correction is too small: ${correctedWidth}x${correctedHeight}`);
    console.warn(`  Expected at least: ${expectedMinWidth / 2}x${expectedMinHeight / 2}`);
    console.warn(`  This panel may have been incorrectly detected. Skipping...`);
    return [];
  }

  // 提取板块区域
  const panelBuffer = await sharp(imageBuffer)
    .extract({ left: correctedX, top: correctedY, width: correctedWidth, height: correctedHeight })
    .jpeg({ quality: 80 })
    .toBuffer();

  console.log(`  Panel buffer size: ${panelBuffer.length} bytes`);

  // 转换为base64
  const base64Image = panelBuffer.toString('base64');
  const dataUri = `data:image/jpeg;base64,${base64Image}`;

  console.log(`  Data URI length: ${dataUri.length} chars`);

  // LLM提示词（识别图标底座）
  const prompt = `识别图片中所有图标底座。图片中包含多个正方形的图标底座（浅米色背景的方块，约130x130像素），每个底座中心有一个图标。请按从上到下、从左到右的顺序识别所有底座的位置和尺寸。返回JSON数组：[{"x":10,"y":20,"width":130,"height":130},{"x":150,"y":20,"width":130,"height":130}]。注意：只返回有效的图标底座（方形、尺寸约130像素），忽略其他元素（文字、分隔线等）。`;

  try {
    // 调用LLM API
    const config = new Config();
    const client = new LLMClient(config);

    const messages = [
      {
        role: "user" as const,
        content: [
          { type: "text" as const, text: prompt },
          {
            type: "image_url" as const,
            image_url: {
              url: dataUri,
              detail: "high" as const
            }
          }
        ]
      }
    ];

    const response = await client.invoke(messages, {
      model: "doubao-seed-1-6-vision-250815",
      temperature: 0.3
    });

    console.log(`  LLM response for panel "${panel.title}":`, response.content);

    // 解析LLM返回的JSON
    let jsonText = response.content.trim();

    // 尝试多种JSON提取方式
    let jsonMatch = jsonText.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      // 尝试去掉markdown代码块标记
      const codeBlockMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      if (codeBlockMatch) {
        jsonText = codeBlockMatch[1].trim();
        jsonMatch = jsonText.match(/\[[\s\S]*\]/);
      }
    }

    if (!jsonMatch) {
      console.error(`  Failed to parse LLM response for panel "${panel.title}":`, response.content);
      throw new Error('无法解析LLM返回的JSON，返回内容不符合预期格式');
    }

    let iconBases;
    try {
      iconBases = JSON.parse(jsonMatch[0]);
    } catch (parseError) {
      console.error(`  JSON parse error for panel "${panel.title}":`, parseError);
      console.error(`  JSON text:`, jsonMatch[0]);
      throw new Error(`JSON解析失败: ${parseError instanceof Error ? parseError.message : '未知错误'}`);
    }

    // 过滤不合理的识别结果
    iconBases = iconBases.filter((base: any) => {
      // 检查宽度和高度是否接近（正方形比例）
      const aspectRatio = Math.max(base.width, base.height) / Math.min(base.width, base.height);
      const isSquare = aspectRatio < 2; // 宽高比不超过2:1

      // 检查尺寸是否合理（50-200像素）
      const minSize = 50;
      const maxSize = 200;
      const isReasonableSize = base.width >= minSize && base.width <= maxSize &&
                             base.height >= minSize && base.height <= maxSize;

      // 检查坐标是否为正整数
      const hasValidCoords = Number.isInteger(base.x) && Number.isInteger(base.y) &&
                            Number.isInteger(base.width) && Number.isInteger(base.height) &&
                            base.x >= 0 && base.y >= 0 &&
                            base.width > 0 && base.height > 0;

      if (!isSquare) {
        console.warn(`  Filtered out non-square base: ${base.width}x${base.height}`);
      }
      if (!isReasonableSize) {
        console.warn(`  Filtered out unreasonable size: ${base.width}x${base.height}`);
      }
      if (!hasValidCoords) {
        console.warn(`  Filtered out invalid coords: x=${base.x}, y=${base.y}, w=${base.width}, h=${base.height}`);
      }

      return isSquare && isReasonableSize && hasValidCoords;
    });

    console.log(`  LLM detected ${iconBases.length} icon bases for panel "${panel.title}" (after filtering)`);

    // 转换为全局坐标
    return iconBases.map((base: any) => ({
      x: panel.x + base.x,
      y: panel.y + base.y,
      width: base.width,
      height: base.height
    }));

  } catch (error) {
    console.error('LLM icon base detection failed:', error);
    throw new Error(`LLM图标底座识别失败: ${error instanceof Error ? error.message : '未知错误'}`);
  }
}

// 将图标底座聚类到网格位置（从上到下，从左到右）
function clusterIconBasesToGrid(
  iconBases: BoundingBox[],
  expectedRows: number,
  expectedCols: number
): GridItem[] {
  console.log(`  Clustering ${iconBases.length} icon bases to ${expectedRows}x${expectedCols} grid...`);

  if (iconBases.length === 0) {
    return [];
  }

  // 计算每个底座的中心点
  const centers = iconBases.map(base => ({
    x: base.x + base.width / 2,
    y: base.y + base.height / 2,
    box: base
  }));

  console.log(`  Icon centers:`, centers.map((c, i) => `#${i}(${Math.round(c.x)},${Math.round(c.y)})`).join(', '));

  // 按y坐标排序（从上到下）
  centers.sort((a, b) => a.y - b.y);

  // 根据y坐标聚类到行
  const rows: Array<{ y: number; items: typeof centers }> = [];
  const yTolerance = 50; // y坐标容差（像素）

  for (const center of centers) {
    // 查找是否有匹配的行
    const matchingRow = rows.find(r => Math.abs(center.y - r.y) < yTolerance);

    if (matchingRow) {
      matchingRow.items.push(center);
      // 更新行的平均y坐标
      matchingRow.y = matchingRow.items.reduce((sum, item) => sum + item.y, 0) / matchingRow.items.length;
    } else {
      rows.push({ y: center.y, items: [center] });
    }
  }

  console.log(`  Detected ${rows.length} rows`);

  // 对每一行内的图标按x坐标排序（从左到右）
  const gridItems: GridItem[] = [];
  let globalIndex = 0;

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
    const row = rows[rowIndex];

    // 按x坐标排序
    row.items.sort((a, b) => a.x - b.x);

    console.log(`  Row ${rowIndex}: ${row.items.length} items at y=${Math.round(row.y)}`);

    for (let colIndex = 0; colIndex < row.items.length; colIndex++) {
      const item = row.items[colIndex];
      gridItems.push({
        row: rowIndex,
        col: colIndex,
        box: item.box
      });

      console.log(`    [${rowIndex},${colIndex}] #${globalIndex} center=(${Math.round(item.x)},${Math.round(item.y)})`);
      globalIndex++;
    }
  }

  console.log(`  Total grid items: ${gridItems.length}`);

  return gridItems;
}

// 检测浅米色矩形框的精确边界
interface ColorThreshold {
  rMin: number;
  rMax: number;
  gMin: number;
  gMax: number;
  bMin: number;
  bMax: number;
}

async function detectBeigeRectangles(
  imageBuffer: Buffer,
  region: BoundingBox
): Promise<BoundingBox[]> {
  console.log(`  Detecting beige rectangles in region: x=${region.x}, y=${region.y}, width=${region.width}, height=${region.height}`);

  // 裁切指定区域
  const croppedBuffer = await sharp(imageBuffer)
    .extract({
      left: Math.round(region.x),
      top: Math.round(region.y),
      width: Math.round(region.width),
      height: Math.round(region.height)
    })
    .raw()
    .toBuffer();

  const width = region.width;
  const height = region.height;
  const pixels = new Uint8ClampedArray(croppedBuffer);

  console.log(`  Region size: ${width}x${height}, pixels: ${pixels.length}`);

  // 浅米色阈值（根据实际图片调整）
  const beigeThreshold: ColorThreshold = {
    rMin: 200, rMax: 255,
    gMin: 190, gMax: 245,
    bMin: 170, bMax: 230
  };

  // 创建二值化图像（浅米色为1，其他为0）
  const binaryImage = new Uint8Array(width * height);
  for (let i = 0; i < pixels.length; i += 4) {
    const r = pixels[i];
    const g = pixels[i + 1];
    const b = pixels[i + 2];

    const isBeige =
      r >= beigeThreshold.rMin && r <= beigeThreshold.rMax &&
      g >= beigeThreshold.gMin && g <= beigeThreshold.gMax &&
      b >= beigeThreshold.bMin && b <= beigeThreshold.bMax;

    binaryImage[i / 4] = isBeige ? 1 : 0;
  }

  // 使用连通区域分析找到独立的矩形框
  const rectangles = findConnectedComponentRectangles(binaryImage, width, height);

  console.log(`  Found ${rectangles.length} beige rectangles`);

  // 转换为全局坐标
  return rectangles.map(rect => ({
    x: region.x + rect.x,
    y: region.y + rect.y,
    width: rect.width,
    height: rect.height
  }));
}

// 使用连通区域分析找到矩形框
function findConnectedComponentRectangles(
  binaryImage: Uint8Array,
  width: number,
  height: number
): BoundingBox[] {
  const visited = new Set<number>();
  const rectangles: BoundingBox[] = [];
  const minArea = 2500; // 最小面积（50x50）
  const maxArea = 50000; // 最大面积（200x250）

  // 8方向偏移（包括对角线）
  const directions = [
    [-1, -1], [-1, 0], [-1, 1],
    [0, -1],          [0, 1],
    [1, -1],  [1, 0], [1, 1]
  ];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x;

      if (binaryImage[index] === 1 && !visited.has(index)) {
        // 找到新的连通区域，使用BFS遍历
        const queue: [number, number][] = [[x, y]];
        visited.add(index);

        let minX = x, maxX = x;
        let minY = y, maxY = y;
        let pixelCount = 0;

        while (queue.length > 0) {
          const [cx, cy] = queue.shift()!;
          pixelCount++;

          // 更新边界
          minX = Math.min(minX, cx);
          maxX = Math.max(maxX, cx);
          minY = Math.min(minY, cy);
          maxY = Math.max(maxY, cy);

          // 检查8个邻居
          for (const [dx, dy] of directions) {
            const nx = cx + dx;
            const ny = cy + dy;

            if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
              const nIndex = ny * width + nx;
              if (binaryImage[nIndex] === 1 && !visited.has(nIndex)) {
                visited.add(nIndex);
                queue.push([nx, ny]);
              }
            }
          }
        }

        // 计算面积
        const area = (maxX - minX + 1) * (maxY - minY + 1);

        // 过滤掉太小或太大的区域
        if (area >= minArea && area <= maxArea) {
          rectangles.push({
            x: minX,
            y: minY,
            width: maxX - minX + 1,
            height: maxY - minY + 1
          });
          console.log(`    Rectangle: (${minX},${minY}) size=${maxX - minX + 1}x${maxY - minY + 1}, area=${area}, pixels=${pixelCount}`);
        }
      }
    }
  }

  return rectangles;
}
