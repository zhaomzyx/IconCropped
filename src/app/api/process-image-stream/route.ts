import { NextRequest } from 'next/server';
import sharp from 'sharp';
import path from 'path';
import fs from 'fs/promises';
import { cwd } from 'process';
import { LLMClient, Config, HeaderUtils } from 'coze-coding-dev-sdk';
import { detectPanels, DEFAULT_DETECTION_PARAMS, DetectedPanel } from '@/lib/panel-detection';

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
  const { filenames, wikiName, gridSize, debug = false, params: customParams } = body;

  if (!filenames || !Array.isArray(filenames) || filenames.length === 0) {
    return new Response(JSON.stringify({ error: 'Missing or invalid filenames parameter' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  console.log(`Processing ${filenames.length} wiki files with SSE streaming (debug=${debug})`);

  // 创建SSE流
  const stream = new ReadableStream({
    async start(controller) {
      try {
        // 阶段1：整体梳理
        sendEvent(controller, 'progress', {
          step: 'preparing',
          message: `📊 正在梳理图片资源（共${filenames.length}张）...`,
          totalImages: filenames.length,
          debugMode: debug
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

            // 不清理缓存，保留所有历史裁切结果
            await fs.mkdir(wikiDir, { recursive: true });

            // 读取图片
            const imageBuffer = await fs.readFile(wikiFilePath);
            const metadata = await sharp(imageBuffer).metadata();

            if (!metadata.width || !metadata.height) {
              throw new Error(`Invalid image metadata`);
            }

            console.log(`  Image metadata: ${metadata.width}x${metadata.height}, format=${metadata.format}`);

            const image = sharp(imageBuffer);

            // 阶段3：使用LLM识别大板块（职责：建表，提供元数据）
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

            // Debug模式：返回Panel元数据和裁切坐标
            if (debug) {
              const debugPanels = panelData.panels.map((panel, idx) => {
                return {
                  title: panel.title || `板块_${idx + 1}`,
                  x: 0,  // LLM的X不准，后端会覆盖
                  y: 0,  // LLM的Y不准，后端会覆盖
                  width: 0,  // LLM的width不准，后端会覆盖
                  height: 0,  // LLM的height不准，后端会覆盖
                  rows: panel.rows,  // 保留：用于后端双层for循环
                  cols: panel.cols,  // 保留：用于后端双层for循环
                  total: panel.total ?? (panel.rows * panel.cols),  // 保留：用于后端双层for循环
                  imageUrl: ''  // 不需要保存大panel图片
                };
              });

              console.log(`  Debug模式：返回 ${debugPanels.length} 个Panel的元数据（title, rows, cols）`);

              // 使用 A 计划检测面板坐标（传入 imageBuffer 和 customParams）
              console.log(`  Debug模式：调用 detectPanels 获取裁切坐标`);
              const detectedPanels = await detectPanels(imageBuffer, debugPanels, customParams);

              console.log(`  Debug模式：检测到 ${detectedPanels.length} 个面板的裁切坐标`);

              // 🌟 将检测到的坐标更新回 debugPanels
              detectedPanels.forEach((detectedPanel, idx) => {
                if (idx < debugPanels.length) {
                  debugPanels[idx].x = detectedPanel.blueBox.x;
                  debugPanels[idx].y = detectedPanel.blueBox.y;
                  debugPanels[idx].width = detectedPanel.blueBox.width;
                  debugPanels[idx].height = detectedPanel.blueBox.height;
                }
              });

              const debugCompleteData = {
                debugPanels: debugPanels,
                detectedPanels: detectedPanels,  // 返回裁切坐标
                imageMetadata: {
                  width: metadata.width,
                  height: metadata.height
                }
              };

              console.log(`  Debug模式：准备发送 debug_complete 事件，数据:`, JSON.stringify(debugCompleteData, null, 2));
              sendEvent(controller, 'debug_complete', debugCompleteData);
              console.log(`  Debug模式：debug_complete 事件已发送`);

              controller.close();
              return;
            }

            // 生产模式：使用 A 计划切图方案进行检测和裁切
            console.log(`\n========== 生产模式：使用 A 计划切图方案 ==========`);

            // 准备面板元数据（从 LLM 获取）
            const debugPanels = panelData.panels.map((panel, idx) => ({
              title: panel.title || `板块_${idx + 1}`,
              x: panel.x,
              y: panel.y,
              width: panel.width,
              height: panel.height,
              rows: panel.rows,
              cols: panel.cols,
              total: panel.total ?? (panel.rows * panel.cols),
            }));

            console.log(`准备的面板元数据 (${debugPanels.length} 个):`);
            debugPanels.forEach((panel, idx) => {
              console.log(`  Panel ${idx + 1}: ${panel.title}, rows=${panel.rows}, cols=${panel.cols}, total=${panel.total}`);
            });

            console.log(`使用的自定义检测参数:`, customParams);

            // 使用 A 计划检测面板坐标（传入 imageBuffer 和 customParams）
            const detectedPanels = await detectPanels(imageBuffer, debugPanels, customParams);

            console.log(`\n========== A 计划检测完成，开始裁切图标 ==========`);

            // 阶段4：裁切图标（使用 A 计划检测到的坐标）
            sendEvent(controller, 'progress', {
              step: 'cutting_icons',
              message: `✂️ 图片 ${i + 1}/${filenames.length} - 二级裁切：正在处理 ${detectedPanels.length} 个板块...`,
              currentImage: i + 1,
              totalImages: filenames.length,
              totalPanels: detectedPanels.length,
              filename: filename,
              subStep: 'icon_cutting'
            });

            // 处理每个板块
            const crops: WikiCroppedImage[] = [];

            for (let j = 0; j < detectedPanels.length; j++) {
              const detectedPanel = detectedPanels[j];
              const title = detectedPanel.title;

              // 计算当前面板的实际行数和列数（从 redBoxes 中计算）
              const maxRow = Math.max(...detectedPanel.redBoxes.map(b => b.row), 0);
              const maxCol = Math.max(...detectedPanel.redBoxes.map(b => b.col), 0);
              const totalRows = maxRow + 1;
              const totalCols = maxCol + 1;

              sendEvent(controller, 'progress', {
                step: 'processing_panel',
                message: `🎨 图片 ${i + 1}/${filenames.length} - 板块 ${j + 1}/${detectedPanels.length}：${title}`,
                currentImage: i + 1,
                totalImages: filenames.length,
                currentPanel: j + 1,
                totalPanels: detectedPanels.length,
                panelTitle: title,
                filename: filename,
                subStep: 'panel_processing'
              });

              console.log(`  处理面板 ${j + 1}/${detectedPanels.length}: ${title}`);
              console.log(`    蓝框: x=${detectedPanel.blueBox.x}, y=${detectedPanel.blueBox.y}, w=${detectedPanel.blueBox.width}, h=${detectedPanel.blueBox.height}`);
              console.log(`    绿框: x=${detectedPanel.greenBox.x}, y=${detectedPanel.greenBox.y}, w=${detectedPanel.greenBox.width}, h=${detectedPanel.greenBox.height}`);
              console.log(`    红框数量: ${detectedPanel.redBoxes.length}`);
              console.log(`    实际行数: ${totalRows}, 实际列数: ${totalCols}`);

              // 裁切图标（使用 A 计划检测到的坐标）
              for (const redBox of detectedPanel.redBoxes) {
                const iconIndex = redBox.row * totalCols + redBox.col;
                const iconFileName = `${title}_${redBox.row}_${redBox.col}.png`;
                const iconPath = path.join(wikiDir, iconFileName);

                console.log(`  裁切图标 [${redBox.row},${redBox.col}]: x=${redBox.x}, y=${redBox.y}, size=${redBox.width}x${redBox.height}`);

                // 边界检查
                if (redBox.x >= 0 && redBox.y >= 0 &&
                    redBox.x + redBox.width <= metadata.width &&
                    redBox.y + redBox.height <= metadata.height) {
                  try {
                    await sharp(imageBuffer)
                      .extract({
                        left: redBox.x,
                        top: redBox.y,
                        width: redBox.width,
                        height: redBox.height
                      })
                      .png()
                      .toFile(iconPath);

                    crops.push({
                      path: iconFileName,
                      name: `${title}_icon_${iconIndex}`,
                      row: redBox.row,
                      col: redBox.col,
                      totalRows: totalRows,
                      totalCols: totalCols,
                      x: redBox.x,
                      y: redBox.y,
                      width: redBox.width,
                      height: redBox.height,
                      panelName: title,
                      title: title,
                      wikiName: actualWikiName,
                      id: `${actualWikiName}_${iconFileName}`,
                      imageUrl: `/api/crops/${actualWikiName}/${iconFileName}`
                    });

                    console.log(`  Saved icon: ${iconFileName} (row=${redBox.row}, col=${redBox.col}, size=${redBox.width}x${redBox.height})`);
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
  total?: number; // 实际图标总数
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
  const prompt = `识别图片中所有板块。每个板块由三部分组成：1）顶部英文标题（如"Bag"、"Energy"、"Coins"等，通常是1-3个单词）；2）标题下方的水平分隔线；3）下方的图标网格（多个方形图标底座排列成多行多列）。

任务要求：
1. 仔细识别每个板块顶部的英文标题，确保准确无误
2. 标题通常是游戏资源名称（如建筑材料、工具、货币等）

返回格式：纯JSON数组，不要包含任何markdown代码块标记或其他文本

每个对象包含以下7个字段（必须严格按照此顺序和格式）：
- title: 板块英文标题（字符串）
- x: 板块左上角X坐标（整数）
- y: 板块左上角Y坐标（整数）
- width: 板块宽度（整数）
- height: 板块高度（整数）
- rows: 图标网格的行数（整数）
- cols: 图标网格的列数（整数）

JSON格式要求：
- 必须是有效的JSON格式
- 每个字段必须有正确的冒号（:）分隔
- 每个字段值后面必须有逗号（,），最后一个字段除外
- 字符串必须用双引号包裹
- 数字不需要引号

注意事项：
- height必须足够大以包含整个图标网格，每个图标通常约130像素高
- 只返回你能明确识别的板块，不要猜测或杜撰标题
- 如果某个标题无法识别，使用 "Unknown_N"（N为序号）

正确的示例格式：
[{"title":"Bag","x":10,"y":20,"width":900,"height":400,"rows":2,"cols":5},{"title":"Energy","x":10,"y":420,"width":900,"height":210,"rows":1,"cols":5}]

错误格式示例（不要这样）：
- {"title":"Bag","x":10,"y":20,"width":900}  <- 缺少字段
- {"title":"Bag","x":10,"y":20  "width":900}  <- 缺少逗号
- {"title":"Bag","x":10,\"20\",\"width":900}  <- 格式错误

请返回纯JSON数组，不要包含任何其他文字说明。`;

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

      // 🔧 尝试修复常见的JSON格式错误
      let fixedJsonText = jsonMatch[0];

      // 修复1: 将 "x":123,"456" 替换为 "x":123,"y":456
      fixedJsonText = fixedJsonText.replace(/"x"\s*:\s*(\d+)\s*,\s*"(\d+)"/g, '"x":$1,"y":$2');

      // 修复2: 将 "title":"XXX","123","456" 替换为 "title":"XXX","x":123,"y":456
      fixedJsonText = fixedJsonText.replace(/"title"\s*:\s*"([^"]+)"\s*,\s*"(\d+)"\s*,\s*"(\d+)"/g, '"title":"$1","x":$2,"y":$3');

      // 修复3: 将 "title":"XXX","x":123,"456" 替换为 "title":"XXX","x":123,"y":456
      fixedJsonText = fixedJsonText.replace(/"title"\s*:\s*"([^"]+)"\s*,\s*"x"\s*:\s*(\d+)\s*,\s*"(\d+)"/g, '"title":"$1","x":$2,"y":$3');

      console.log(`  尝试修复后的JSON:`, fixedJsonText.substring(0, 500));

      try {
        panels = JSON.parse(fixedJsonText);
        console.log(`  ✅ JSON修复成功！`);
      } catch (retryError) {
        console.error(`  JSON修复后仍然失败:`, retryError);
        throw new Error(`JSON解析失败: ${parseError instanceof Error ? parseError.message : '未知错误'}`);
      }
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
  const prompt = `识别图片中所有图标底座。图片中包含多个正方形的图标底座（浅米色背景的方块，约130x130像素），每个底座中心有一个图标。

任务要求：
按从上到下、从左到右的顺序识别所有底座的位置和尺寸。

返回格式：纯JSON数组，不要包含任何markdown代码块标记或其他文本

每个对象包含以下4个字段（必须严格按照此顺序和格式）：
- x: 底座左上角X坐标（整数）
- y: 底座左上角Y坐标（整数）
- width: 底座宽度（整数，约130像素）
- height: 底座高度（整数，约130像素）

JSON格式要求：
- 必须是有效的JSON格式
- 每个字段必须有正确的冒号（:）分隔
- 每个字段值后面必须有逗号（,），最后一个字段除外
- 所有数字不需要引号

注意事项：
- 只返回有效的图标底座（方形、尺寸约130像素）
- 忽略其他元素（文字、分隔线、标题等）
- 确保坐标准确，不要重叠或遗漏

正确的示例格式：
[{"x":10,"y":20,"width":130,"height":130},{"x":150,"y":20,"width":130,"height":130}]

错误格式示例（不要这样）：
- {"x":10,"y":20}  <- 缺少字段
- {"x":10,"y":20  "width":130}  <- 缺少逗号
- {"x":10,\"20\",\"width":130}  <- 格式错误

请返回纯JSON数组，不要包含任何其他文字说明。`;

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
  region: BoundingBox,
  useBigPanelThreshold: boolean = false
): Promise<BoundingBox[]> {
  console.log(`  Detecting beige rectangles in region: x=${region.x}, y=${region.y}, width=${region.width}, height=${region.height}`);

  // 获取图片元数据
  const metadata = await sharp(imageBuffer).metadata();
  const imgWidth = metadata.width!;
  const imgHeight = metadata.height!;

  // 边界检查和修正
  const correctedX = Math.max(0, Math.min(region.x, imgWidth - 1));
  const correctedY = Math.max(0, Math.min(region.y, imgHeight - 1));
  const correctedWidth = Math.max(1, Math.min(region.width, imgWidth - correctedX));
  const correctedHeight = Math.max(1, Math.min(region.height, imgHeight - correctedY));

  console.log(`  Corrected region: x=${correctedX}, y=${correctedY}, width=${correctedWidth}, height=${correctedHeight}`);

  // 裁切指定区域
  const croppedBuffer = await sharp(imageBuffer)
    .extract({
      left: correctedX,
      top: correctedY,
      width: correctedWidth,
      height: correctedHeight
    })
    .raw()
    .toBuffer();

  const width = correctedWidth;
  const height = correctedHeight;
  const pixels = new Uint8ClampedArray(croppedBuffer);

  console.log(`  Region size: ${width}x${height}, pixels: ${pixels.length}`);

  // 采样像素颜色，用于调试
  const sampleColors: number[][] = [];
  const sampleStep = Math.max(1, Math.floor((width * height) / 100)); // 采样约100个像素
  for (let i = 0; i < pixels.length; i += sampleStep) {
    sampleColors.push([pixels[i], pixels[i + 1], pixels[i + 2]]);
  }
  console.log(`  Sampled ${sampleColors.length} pixels for color analysis`);

  // 计算平均颜色
  const avgColor = [
    Math.round(sampleColors.reduce((sum, c) => sum + c[0], 0) / sampleColors.length),
    Math.round(sampleColors.reduce((sum, c) => sum + c[1], 0) / sampleColors.length),
    Math.round(sampleColors.reduce((sum, c) => sum + c[2], 0) / sampleColors.length)
  ];
  console.log(`  Average color: RGB(${avgColor.join(', ')})`);

  // 浅米色阈值（根据实际图片调整）
  // 一级裁切（大panel）：浅米色，约 247, 231, 207
  // 二级裁切（小panel）：深米色，实际采样显示约 222, 177, 129
  let beigeThreshold: ColorThreshold;

  if (useBigPanelThreshold) {
    // 大panel阈值（用于一级裁切）
    beigeThreshold = {
      rMin: 230, rMax: 255,  // 247 ± 17
      gMin: 215, gMax: 245,  // 231 ± 16
      bMin: 190, bMax: 220   // 207 ± 17
    };
    console.log(`  Using big panel threshold (247, 231, 207 ± variance)`);
  } else {
    // 小panel阈值（用于二级裁切）- 深米色
    // 根据实际采样结果调整：RGB(222, 177, 129)
    beigeThreshold = {
      rMin: 200, rMax: 245,  // 222 ± 22
      gMin: 155, gMax: 200,  // 177 ± 22
      bMin: 105, bMax: 160   // 129 ± 24
    };
    console.log(`  Using small panel threshold (222, 177, 129 ± variance, dark beige)`);
  }

  // 创建二值化图像（浅米色为1，其他为0）
  const binaryImage = new Uint8Array(width * height);
  let beigePixelCount = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    const r = pixels[i];
    const g = pixels[i + 1];
    const b = pixels[i + 2];

    const isBeige =
      r >= beigeThreshold.rMin && r <= beigeThreshold.rMax &&
      g >= beigeThreshold.gMin && g <= beigeThreshold.gMax &&
      b >= beigeThreshold.bMin && b <= beigeThreshold.bMax;

    if (isBeige) {
      beigePixelCount++;
    }

    binaryImage[i / 4] = isBeige ? 1 : 0;
  }

  console.log(`  Beige pixels: ${beigePixelCount} / ${pixels.length / 4} (${(beigePixelCount / (pixels.length / 4) * 100).toFixed(2)}%)`);

  // 使用连通区域分析找到独立的矩形框
  const rectangles = findConnectedComponentRectangles(binaryImage, width, height);

  console.log(`  Found ${rectangles.length} beige rectangles`);

  // 转换为全局坐标（使用修正后的坐标）
  return rectangles.map(rect => ({
    x: correctedX + rect.x,
    y: correctedY + rect.y,
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
  const minArea = 5000; // 最小面积（70x70，考虑圆角）
  const maxArea = 40000; // 最大面积（200x200）

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

// ========== 数学网格计算函数 ==========

interface UILayout {
  COLS: number;
  TOP_PADDING: number;
  BOTTOM_PADDING: number;
  SIDE_PADDING: number;
  GAP: number;
}

interface IconPosition {
  x: number;
  y: number;
  width: number;
  height: number;
  row: number;
  col: number;
}

interface IconPositionsResult {
  positions: IconPosition[];
  rows: number;
  cols: number;
}

// 使用数学网格计算图标位置
function calculateIconPositions(
  panelX: number,
  panelY: number,
  panelWidth: number,
  panelHeight: number,
  layout: UILayout
): IconPositionsResult {
  console.log(`  Calculating icon positions for panel at (${panelX}, ${panelY}), size ${panelWidth}x${panelHeight}`);

  const { COLS, TOP_PADDING, BOTTOM_PADDING, SIDE_PADDING, GAP } = layout;

  // 计算图标可用区域
  const availableWidth = panelWidth - SIDE_PADDING;
  const availableHeight = panelHeight - TOP_PADDING - BOTTOM_PADDING;

  console.log(`  Available area: ${availableWidth}x${availableHeight}`);

  // 边界检查：如果可用高度太小或为负数，返回空数组
  if (availableHeight <= 0) {
    console.warn(`  Available height (${availableHeight}) is too small or negative, skipping panel`);
    return { positions: [], rows: 0, cols: COLS };
  }

  if (availableWidth <= 0) {
    console.warn(`  Available width (${availableWidth}) is too small or negative, skipping panel`);
    return { positions: [], rows: 0, cols: COLS };
  }

  // 计算单个图标的宽度和高度
  const iconWidth = (availableWidth - (COLS - 1) * GAP) / COLS;

  // 估算单个图标的高度（假设图标是正方形）
  const estimatedIconHeight = iconWidth;

  // 计算行数
  const rows = Math.round(availableHeight / (estimatedIconHeight + GAP));

  console.log(`  Estimated icon size: ${iconWidth.toFixed(1)}x${estimatedIconHeight.toFixed(1)}`);
  console.log(`  Calculated rows: ${rows}`);

  // 边界检查：如果行数为0，返回空数组
  if (rows <= 0) {
    console.warn(`  Calculated rows (${rows}) is too small, skipping panel`);
    return { positions: [], rows: 0, cols: COLS };
  }

  // 重新计算实际图标高度（基于行数）
  const actualIconHeight = (availableHeight - (rows - 1) * GAP) / rows;

  console.log(`  Actual icon size: ${iconWidth.toFixed(1)}x${actualIconHeight.toFixed(1)}`);

  // 计算起始位置（居中对齐）
  const startX = panelX + SIDE_PADDING / 2;
  const startY = panelY + TOP_PADDING;

  // 计算所有图标的位置
  const positions: IconPosition[] = [];

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < COLS; col++) {
      const x = startX + col * (iconWidth + GAP);
      const y = startY + row * (actualIconHeight + GAP);

      positions.push({
        x: Math.round(x),
        y: Math.round(y),
        width: Math.round(iconWidth),
        height: Math.round(actualIconHeight),
        row,
        col
      });
    }
  }

  console.log(`  Generated ${positions.length} icon positions`);

  return {
    positions,
    rows,
    cols: COLS
  };
}
