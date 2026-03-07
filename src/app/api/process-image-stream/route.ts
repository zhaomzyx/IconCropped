import { NextRequest } from "next/server";
import sharp from "sharp";
import path from "path";
import fs from "fs/promises";
import { cwd } from "process";
import { LLMClient, Config } from "coze-coding-dev-sdk";
import { detectPanels } from "@/lib/panel-detection";
import { recognizePanelTitlesFromPanels } from "@/lib/panel-title-ocr";
import {
  resolvePanelTitle,
  sanitizePanelTitleForFilename,
} from "@/lib/panel-title";

// 发送SSE事件
function sendEvent(
  stream: ReadableStreamDefaultController<any>,
  event: string,
  data: any,
) {
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

// SSE版本的process-image API
export async function POST(request: NextRequest) {
  const body = await request.json();
  const { filenames, wikiName, debug = false, params: customParams } = body;

  if (!filenames || !Array.isArray(filenames) || filenames.length === 0) {
    return new Response(
      JSON.stringify({ error: "Missing or invalid filenames parameter" }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  console.log(
    `Processing ${filenames.length} wiki files with SSE streaming (debug=${debug})`,
  );

  // 创建SSE流
  const stream = new ReadableStream({
    async start(controller) {
      try {
        // 阶段1：整体梳理
        sendEvent(controller, "progress", {
          step: "preparing",
          message: `📊 正在梳理图片资源（共${filenames.length}张）...`,
          totalImages: filenames.length,
          debugMode: debug,
        });

        await new Promise((resolve) => setTimeout(resolve, 500));

        let allCrops: WikiCroppedImage[] = [];
        let totalCropsCount = 0;

        // 逐张处理
        for (let i = 0; i < filenames.length; i++) {
          const filename = filenames[i];

          // 阶段2：开始处理单张图片
          sendEvent(controller, "progress", {
            step: "processing_image",
            message: `🖼️ 正在处理第 ${i + 1}/${filenames.length} 张图片...`,
            currentImage: i + 1,
            totalImages: filenames.length,
            filename: filename,
          });

          try {
            // 构建Wiki图片路径
            let wikiFilePath: string;
            let actualWikiName: string;

            if (wikiName) {
              wikiFilePath = path.join(
                cwd(),
                "public",
                "WikiPic",
                wikiName,
                filename,
              );
              actualWikiName = wikiName;
            } else {
              wikiFilePath = `/tmp/uploads/wiki/${filename}`;
              actualWikiName = filename.replace(/\.[^/.]+$/, "");
            }

            console.log(`Reading Wiki image from: ${wikiFilePath}`);

            // 检查文件是否存在
            await fs.access(wikiFilePath);

            // 创建Wiki目录路径
            const wikiDir = path.join(
              cwd(),
              "public",
              "wiki-cropped",
              actualWikiName,
            );

            // 不清理缓存，保留所有历史裁切结果
            await fs.mkdir(wikiDir, { recursive: true });

            // 读取图片
            const imageBuffer = await fs.readFile(wikiFilePath);
            const metadata = await sharp(imageBuffer).metadata();

            if (!metadata.width || !metadata.height) {
              throw new Error(`Invalid image metadata`);
            }

            console.log(
              `  Image metadata: ${metadata.width}x${metadata.height}, format=${metadata.format}`,
            );

            // 阶段3：使用LLM识别大板块（职责：建表，提供元数据）
            sendEvent(controller, "progress", {
              step: "detecting_panels",
              message: `🔍 图片 ${i + 1}/${filenames.length} - 一级裁切：正在识别大板块（LLM视觉识别）...`,
              currentImage: i + 1,
              totalImages: filenames.length,
              filename: filename,
              subStep: "panel_detection",
            });

            const panelData = await detectPanelsWithLLM(imageBuffer, metadata);
            console.log(`  LLM detected ${panelData.panels.length} panels`);

            // Debug模式：返回Panel元数据和裁切坐标
            if (debug) {
              const debugPanels = panelData.panels.map((panel, idx) => {
                return {
                  title: panel.title || `板块_${idx + 1}`,
                  x: 0, // LLM的X不准，后端会覆盖
                  y: 0, // LLM的Y不准，后端会覆盖
                  width: 0, // LLM的width不准，后端会覆盖
                  height: 0, // LLM的height不准，后端会覆盖
                  rows: panel.rows, // 保留：用于后端双层for循环
                  cols: panel.cols, // 保留：用于后端双层for循环
                  total: panel.total ?? panel.rows * panel.cols, // 保留：用于后端双层for循环
                  imageUrl: "", // 不需要保存大panel图片
                };
              });

              console.log(
                `  Debug模式：返回 ${debugPanels.length} 个Panel的元数据（title, rows, cols）`,
              );

              // 使用 A 计划检测面板坐标（传入 imageBuffer 和 customParams）
              console.log(`  Debug模式：调用 detectPanels 获取裁切坐标`);
              const detectedPanels = await detectPanels(
                imageBuffer,
                debugPanels,
                customParams,
              );

              console.log(
                `  Debug模式：检测到 ${detectedPanels.length} 个面板的裁切坐标`,
              );

              const debugCompleteData = {
                debugPanels: debugPanels,
                detectedPanels: detectedPanels, // 返回裁切坐标
                imageMetadata: {
                  width: metadata.width,
                  height: metadata.height,
                },
              };

              console.log(
                `  Debug模式：准备发送 debug_complete 事件，数据:`,
                JSON.stringify(debugCompleteData, null, 2),
              );
              sendEvent(controller, "debug_complete", debugCompleteData);
              console.log(`  Debug模式：debug_complete 事件已发送`);

              controller.close();
              return;
            }

            // 生产模式：使用 A 计划切图方案进行检测和裁切
            console.log(
              `\n========== 生产模式：使用 A 计划切图方案 ==========`,
            );

            // 准备面板元数据（从 LLM 获取）
            const debugPanels = panelData.panels.map((panel, idx) => ({
              title: panel.title || `板块_${idx + 1}`,
              x: panel.x,
              y: panel.y,
              width: panel.width,
              height: panel.height,
              rows: panel.rows,
              cols: panel.cols,
              total: panel.total ?? panel.rows * panel.cols,
            }));

            console.log(`准备的面板元数据 (${debugPanels.length} 个):`);
            debugPanels.forEach((panel, idx) => {
              console.log(
                `  Panel ${idx + 1}: ${panel.title}, rows=${panel.rows}, cols=${panel.cols}, total=${panel.total}`,
              );
            });

            console.log(`使用的自定义检测参数:`, customParams);

            // 使用 A 计划检测面板坐标（传入 imageBuffer 和 customParams）
            const detectedPanels = await detectPanels(
              imageBuffer,
              debugPanels,
              customParams,
            );

            // 统一标题来源：ocrTitle > title > Panel_N。
            const ocrTitles = await recognizePanelTitlesFromPanels(
              imageBuffer,
              detectedPanels.map((panel, index) => ({
                index,
                greenBox: panel.greenBox,
              })),
            );

            console.log(`\n========== A 计划检测完成，开始裁切图标 ==========`);

            // 阶段4：裁切图标（使用 A 计划检测到的坐标）
            sendEvent(controller, "progress", {
              step: "cutting_icons",
              message: `✂️ 图片 ${i + 1}/${filenames.length} - 二级裁切：正在处理 ${detectedPanels.length} 个板块...`,
              currentImage: i + 1,
              totalImages: filenames.length,
              totalPanels: detectedPanels.length,
              filename: filename,
              subStep: "icon_cutting",
            });

            // 处理每个板块
            const crops: WikiCroppedImage[] = [];

            for (let j = 0; j < detectedPanels.length; j++) {
              const detectedPanel = detectedPanels[j];
              const title = resolvePanelTitle({
                ocrTitle: ocrTitles[j],
                title: detectedPanel.title,
                panelIndex: j,
              });

              // 计算当前面板的实际行数和列数（从 redBoxes 中计算）
              const maxRow = Math.max(
                ...detectedPanel.redBoxes.map((b) => b.row),
                0,
              );
              const maxCol = Math.max(
                ...detectedPanel.redBoxes.map((b) => b.col),
                0,
              );
              const totalRows = maxRow + 1;
              const totalCols = maxCol + 1;

              sendEvent(controller, "progress", {
                step: "processing_panel",
                message: `🎨 图片 ${i + 1}/${filenames.length} - 板块 ${j + 1}/${detectedPanels.length}：${title}`,
                currentImage: i + 1,
                totalImages: filenames.length,
                currentPanel: j + 1,
                totalPanels: detectedPanels.length,
                panelTitle: title,
                filename: filename,
                subStep: "panel_processing",
              });

              console.log(
                `  处理面板 ${j + 1}/${detectedPanels.length}: ${title}`,
              );
              console.log(
                `    蓝框: x=${detectedPanel.blueBox.x}, y=${detectedPanel.blueBox.y}, w=${detectedPanel.blueBox.width}, h=${detectedPanel.blueBox.height}`,
              );
              console.log(
                `    绿框: x=${detectedPanel.greenBox.x}, y=${detectedPanel.greenBox.y}, w=${detectedPanel.greenBox.width}, h=${detectedPanel.greenBox.height}`,
              );
              console.log(`    红框数量: ${detectedPanel.redBoxes.length}`);
              console.log(`    实际行数: ${totalRows}, 实际列数: ${totalCols}`);

              // 按从左到右、从上到下排序，确保命名序号稳定且从0递增。
              const orderedRedBoxes = [...detectedPanel.redBoxes].sort(
                (a, b) => {
                  if (a.row !== b.row) return a.row - b.row;
                  return a.col - b.col;
                },
              );

              const safeTitle = sanitizePanelTitleForFilename(title);

              // 裁切图标（使用 A 计划检测到的坐标）
              for (const [iconIndex, redBox] of orderedRedBoxes.entries()) {
                const iconFileName = `${safeTitle}_${iconIndex}.png`;
                const iconPath = path.join(wikiDir, iconFileName);

                console.log(
                  `  裁切图标 [${redBox.row},${redBox.col}]: x=${redBox.x}, y=${redBox.y}, size=${redBox.width}x${redBox.height}`,
                );

                // 边界检查
                if (
                  redBox.x >= 0 &&
                  redBox.y >= 0 &&
                  redBox.x + redBox.width <= metadata.width &&
                  redBox.y + redBox.height <= metadata.height
                ) {
                  try {
                    await sharp(imageBuffer)
                      .extract({
                        left: redBox.x,
                        top: redBox.y,
                        width: redBox.width,
                        height: redBox.height,
                      })
                      .png()
                      .toFile(iconPath);

                    crops.push({
                      path: iconFileName,
                      name: `${safeTitle}_${iconIndex}`,
                      row: redBox.row,
                      col: redBox.col,
                      totalRows: totalRows,
                      totalCols: totalCols,
                      x: redBox.x,
                      y: redBox.y,
                      width: redBox.width,
                      height: redBox.height,
                      panelName: safeTitle,
                      title: safeTitle,
                      wikiName: actualWikiName,
                      id: `${actualWikiName}_${iconFileName}`,
                      imageUrl: `/api/crops/${actualWikiName}/${iconFileName}`,
                    });

                    console.log(
                      `  Saved icon: ${iconFileName} (row=${redBox.row}, col=${redBox.col}, size=${redBox.width}x${redBox.height})`,
                    );
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

            sendEvent(controller, "image_complete", {
              message: `✓ 图片 ${i + 1}/${filenames.length} 处理完成，已切割 ${crops.length} 个图标`,
              currentImage: i + 1,
              totalImages: filenames.length,
              filename: filename,
              cropsCount: crops.length,
              totalCropsCount: totalCropsCount,
            });
          } catch (error: unknown) {
            const errorMessage =
              error instanceof Error ? error.message : String(error);
            console.error(`Failed to process image ${i}:`, error);
            sendEvent(controller, "error", {
              message: `✗ 图片 ${i + 1}/${filenames.length} 处理失败：${errorMessage}`,
              currentImage: i + 1,
              totalImages: filenames.length,
              filename: filename,
            });
          }
        }

        // 阶段6：全部完成
        sendEvent(controller, "progress", {
          step: "complete",
          message: `✅ 全部完成！共处理 ${totalCropsCount} 个图标`,
          totalImages: filenames.length,
          totalCrops: totalCropsCount,
        });

        sendEvent(controller, "complete", {
          success: true,
          crops: allCrops,
          wikiName: wikiName,
        });

        controller.close();
      } catch (error: unknown) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        const errorStack = error instanceof Error ? error.stack : undefined;
        console.error("Process image stream error:", error);
        sendEvent(controller, "error", {
          message: errorMessage || "处理失败",
          stack: errorStack,
        });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
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
): Promise<PanelDetectionResult> {
  // 如果图片太大，先缩放到合理尺寸（避免超出LLM token限制）
  let processBuffer = imageBuffer;
  const maxWidth = 2000;
  if (metadata.width && metadata.width > maxWidth) {
    processBuffer = await sharp(imageBuffer).resize(maxWidth, null).toBuffer();
  }

  // 转换为base64
  const base64Image = processBuffer.toString("base64");
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
- {"title":"Bag","x":10,\"20\",\"width\":900}  <- 格式错误

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
              detail: "high" as const,
            },
          },
        ],
      },
    ];

    const response = await client.invoke(messages, {
      model: "doubao-seed-1-6-vision-250815",
      temperature: 0.3,
    });

    console.log(
      `  LLM response for panel detection:`,
      response.content.substring(0, 500),
    );

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
      console.error(
        `  Failed to parse LLM response for panel detection:`,
        response.content,
      );
      throw new Error("无法解析LLM返回的JSON，返回内容不符合预期格式");
    }

    let panels;
    try {
      panels = JSON.parse(jsonMatch[0]);
    } catch (parseError) {
      console.error(`  JSON parse error for panel detection:`, parseError);
      console.error(`  JSON text:`, jsonMatch[0]);

      // 尝试修复常见的JSON格式错误
      let fixedJsonText = jsonMatch[0];
      fixedJsonText = fixedJsonText.replace(
        /"x"\s*:\s*(\d+)\s*,\s*"(\d+)"/g,
        '"x":$1,"y":$2',
      );
      fixedJsonText = fixedJsonText.replace(
        /"title"\s*:\s*"([^"]+)"\s*,\s*"(\d+)"\s*,\s*"(\d+)"/g,
        '"title":"$1","x":$2,"y":$3',
      );
      fixedJsonText = fixedJsonText.replace(
        /"title"\s*:\s*"([^"]+)"\s*,\s*"x"\s*:\s*(\d+)\s*,\s*"(\d+)"/g,
        '"title":"$1","x":$2,"y":$3',
      );

      console.log(`  尝试修复后的JSON:`, fixedJsonText.substring(0, 500));

      try {
        panels = JSON.parse(fixedJsonText);
        console.log(`  JSON修复成功`);
      } catch (retryError) {
        console.error(`  JSON修复后仍然失败:`, retryError);
        throw new Error(
          `JSON解析失败: ${parseError instanceof Error ? parseError.message : "未知错误"}`,
        );
      }
    }

    console.log(
      `  LLM detected ${panels.length} panels:`,
      panels.map((p: any) => p.title).join(", "),
    );

    // 验证板块高度是否合理
    panels.forEach((panel: any) => {
      const expectedMinHeight = 50 + panel.rows * 130;
      if (panel.height < expectedMinHeight) {
        console.warn(
          `  Panel "${panel.title}" height (${panel.height}) may be too small. Expected at least ${expectedMinHeight} for ${panel.rows} rows.`,
        );
        console.warn(
          `  Panel coords: x=${panel.x}, y=${panel.y}, width=${panel.width}, height=${panel.height}, rows=${panel.rows}, cols=${panel.cols}`,
        );
      }
    });

    return { panels };
  } catch (error) {
    console.error("LLM panel detection failed:", error);
    throw new Error(
      `LLM板块识别失败: ${error instanceof Error ? error.message : "未知错误"}`,
    );
  }
}
