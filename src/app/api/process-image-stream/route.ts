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

              // 使用LLM识别板块内的图标底座
              const iconBases = await detectIconBasesWithLLM(imageBuffer, metadata, panel, filename);
              console.log(`  Panel ${j} (${title}): detected ${iconBases.length} icons`);

              // LLM已经按顺序返回了图标，不需要再聚类
              const gridItems = iconBases.map((box, index) => ({
                row: Math.floor(index / panel.cols),
                col: index % panel.cols,
                box: box
              }));

              // 计算总行数和总列数
              const totalRows = gridItems.length > 0 ? Math.max(...gridItems.map(g => g.row)) + 1 : 1;
              const totalCols = gridItems.length > 0 ? Math.max(...gridItems.map(g => g.col)) + 1 : 1;

              // 裁切图标（按底座四条边裁切1:1正方形）
              for (const gridItem of gridItems) {
                const base = gridItem.box;

                // 计算图标序号（行优先）
                const iconIndex = gridItem.row * totalCols + gridItem.col;
                const iconFileName = `${title}_icon_${iconIndex}.png`;
                const iconPath = path.join(wikiDir, iconFileName);

                // 按底座四条边裁切，确保1:1正方形
                // 取宽度和高度的最大值作为正方形边长
                const squareSize = Math.max(base.width, base.height);

                // 以底座中心为基准，计算正方形裁切区域
                const centerX = base.x + base.width / 2;
                const centerY = base.y + base.height / 2;

                const cropX = Math.max(0, Math.round(centerX - squareSize / 2));
                const cropY = Math.max(0, Math.round(centerY - squareSize / 2));

                // 边界检查（确保裁切区域不超出原图）
                const finalX = Math.min(cropX, metadata.width - squareSize);
                const finalY = Math.min(cropY, metadata.height - squareSize);

                // 检查是否有足够空间裁切
                if (finalX + squareSize <= metadata.width && finalY + squareSize <= metadata.height && squareSize > 0) {
                  try {
                    await sharp(imageBuffer)
                      .extract({ left: finalX, top: finalY, width: squareSize, height: squareSize })
                      .png()
                      .toFile(iconPath);

                    crops.push({
                      path: iconFileName,
                      name: `${title}_icon_${iconIndex}`,
                      row: gridItem.row,
                      col: gridItem.col,
                      totalRows: totalRows,
                      totalCols: totalCols,
                      x: finalX,
                      y: finalY,
                      width: squareSize,
                      height: squareSize,
                      panelName: title,
                      title: title,
                      wikiName: actualWikiName,
                      id: `${actualWikiName}_${iconFileName}`,
                      imageUrl: `/api/crops/${actualWikiName}/${iconFileName}`
                    });

                    console.log(`  Saved icon: ${iconFileName} (row=${gridItem.row}, col=${gridItem.col}, size=${squareSize}x${squareSize})`);
                  } catch (e) {
                    console.error(`  Failed to save icon ${iconFileName}:`, e);
                  }
                } else {
                  console.warn(`  Icon ${iconIndex} at (${Math.round(base.x)},${Math.round(base.y)}, size=${base.width}x${base.height}) out of bounds, skipping`);
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
  const prompt = `请识别这张游戏Wiki页面中的所有大板块。

每个板块包含：
1. 顶部有标题（英文，如"Bag"、"Shells"等）
2. 标题下方有一条分隔线
3. 分隔线下方是图标网格区域（有浅米色圆角底座）

请按从上到下、从左到右的顺序识别所有板块，返回每个板块的以下信息：
- title: 板块标题
- x, y, width, height: 板块在图片中的位置和尺寸
- rows: 图标区域的行数
- cols: 图标区域的列数

请只返回JSON数组，格式如下：
[
  {
    "title": "Bag",
    "x": 10,
    "y": 20,
    "width": 300,
    "height": 200,
    "rows": 2,
    "cols": 5
  },
  ...
]

要求：
1. 只返回JSON数组，不要其他文字
2. 坐标和尺寸使用整数
3. 标题使用英文，首字母大写（保持原始大小写）
4. 如果某个板块没有标题，使用"Unknown_N"，其中N是板块序号（从1开始）
5. 精确识别每个板块的边界`;

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
  // 提取板块区域
  const panelBuffer = await sharp(imageBuffer)
    .extract({ left: panel.x, top: panel.y, width: panel.width, height: panel.height })
    .jpeg({ quality: 80 })
    .toBuffer();

  console.log(`  Panel buffer size: ${panelBuffer.length} bytes`);

  // 转换为base64
  const base64Image = panelBuffer.toString('base64');
  const dataUri = `data:image/jpeg;base64,${base64Image}`;

  console.log(`  Data URI length: ${dataUri.length} chars`);

  // LLM提示词（识别图标底座）
  const prompt = `识别图片中所有图标底座的位置和尺寸。返回JSON数组，每个元素包含x, y, width, height。例如：[{"x":10,"y":20,"width":60,"height":60},{"x":80,"y":20,"width":60,"height":60}]`;;

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

    console.log(`  LLM detected ${iconBases.length} icon bases for panel "${panel.title}"`);

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
