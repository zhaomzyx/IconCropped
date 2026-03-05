import { NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';
import path from 'path';
import fs from 'fs/promises';
import { cwd } from 'process';
import { Config, LLMClient } from 'coze-coding-dev-sdk';

// 接口定义
interface Coordinate {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface DebugPanel {
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rows: number;
  cols: number;
  total?: number;
  imageUrl: string;
  greenBox?: Coordinate;  // 绿框（标题区域）
  redBoxes?: Coordinate[];  // 红框（icon区域）
  blueBox?: Coordinate;  // 蓝框（大panel区域）
}

interface CropResult {
  filename: string;
  name: string;
  panelIndex: number;
  iconIndex: number;
  row: number;
  col: number;
  wikiName: string;
  imageUrl: string;
}

interface VerificationResult {
  panelIndex: number;
  panelTitle: string;
  gridCount: number;  // 网格推断的icon数量
  llmCount: number;   // LLM识别的icon数量
  match: boolean;     // 是否匹配
  confidence: string; // LLM的置信度说明
}

// 使用LLM验证icon数量
async function verifyIconCountWithLLM(
  imageBuffer: Buffer,
  blueBox: Coordinate,
  panelTitle: string
): Promise<{ count: number; confidence: string }> {
  try {
    // 裁切蓝框区域（大panel）
    const panelBuffer = await sharp(imageBuffer)
      .extract({
        left: blueBox.x,
        top: blueBox.y,
        width: blueBox.width,
        height: blueBox.height,
      })
      .png()
      .toBuffer();

    // 如果图片太大，先缩放到合理尺寸
    let processBuffer = panelBuffer;
    const panelMetadata = await sharp(panelBuffer).metadata();
    const maxWidth = 1000;
    if (panelMetadata.width && panelMetadata.width > maxWidth) {
      const scale = maxWidth / panelMetadata.width;
      processBuffer = await sharp(panelBuffer)
        .resize(maxWidth, null)
        .toBuffer();
    }

    // 转换为base64
    const base64Image = processBuffer.toString('base64');
    const dataUri = `data:image/png;base64,${base64Image}`;

    // LLM提示词（识别并统计icon数量）
    const prompt = `请统计图片中图标底座的数量。图片是一个游戏合成面板，包含多个方形图标底座排列成网格。请只返回一个JSON对象，格式为：{"count": 图标总数, "confidence": "置信度说明"}。例如：{"count": 15, "confidence": "识别到5行3列的网格，共15个图标"}`;

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

    console.log(`  LLM response for icon count verification:`, response.content.substring(0, 500));

    // 解析LLM返回的JSON
    let jsonText = response.content.trim();
    let jsonMatch = jsonText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      const codeBlockMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      if (codeBlockMatch) {
        jsonText = codeBlockMatch[1].trim();
        jsonMatch = jsonText.match(/\{[\s\S]*\}/);
      }
    }

    if (!jsonMatch) {
      console.error(`  Failed to parse LLM response for icon count verification:`, response.content);
      throw new Error('无法解析LLM返回的JSON');
    }

    let result;
    try {
      result = JSON.parse(jsonMatch[0]);
    } catch (parseError) {
      console.error(`  JSON parse error:`, parseError);
      console.error(`  JSON text:`, jsonMatch[0]);
      throw new Error(`JSON解析失败: ${parseError instanceof Error ? parseError.message : '未知错误'}`);
    }

    console.log(`  LLM verified icon count: ${result.count} (${result.confidence})`);

    return {
      count: result.count || 0,
      confidence: result.confidence || '未提供置信度说明'
    };

  } catch (error) {
    console.error('LLM icon count verification failed:', error);
    throw new Error(`LLM数量验证失败: ${error instanceof Error ? error.message : '未知错误'}`);
  }
}

// 使用LLM识别绿框中的文字
async function recognizeTextFromGreenBox(
  imageBuffer: Buffer,
  greenBox: Coordinate
): Promise<string> {
  try {
    // 暂时使用固定的提示，后续可以集成LLM识别
    // TODO: 集成LLM视觉识别
    console.log(`  暂时使用默认标题，LLM识别功能待实现`);
    return 'Chain_Title'; // 返回默认标题，调用方会覆盖
  } catch (error) {
    console.error('  LLM识别失败:', error);
    return 'Unknown';
  }
}

// 裁切红框作为icon
async function cropIconFromRedBox(
  imageBuffer: Buffer,
  redBox: Coordinate,
  panelTitle: string,
  iconIndex: number,
  row: number,
  col: number,
  wikiName: string
): Promise<CropResult> {
  // 裁切红框区域
  const iconBuffer = await sharp(imageBuffer)
    .extract({
      left: redBox.x,
      top: redBox.y,
      width: redBox.width,
      height: redBox.height,
    })
    .png()
    .toBuffer();

  // 生成文件名：面板名_行列序号.png
  const filename = `${panelTitle}_${row + 1}_${col + 1}.png`;

  // 保存icon到public/wiki-cropped/wikiName/目录
  const outputDir = path.join(cwd(), 'public', 'wiki-cropped', wikiName);
  await fs.mkdir(outputDir, { recursive: true });

  const outputPath = path.join(outputDir, filename);
  await fs.writeFile(outputPath, iconBuffer);

  console.log(`  保存icon: ${filename} (${redBox.width}x${redBox.height})`);

  return {
    filename,
    name: `${panelTitle}_${iconIndex + 1}`,
    panelIndex: 0, // 暂时设为0，后续可以根据需要调整
    iconIndex,
    row,
    col,
    wikiName,
    imageUrl: `/wiki-cropped/${wikiName}/${filename}`,
  };
}

// POST接口：接收坐标数据并裁切
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      imageUrl,          // 原始图片URL
      debugPanels,       // 调试面板数据（包含蓝框、绿框、红框）
      wikiName = 'default'  // Wiki名称
    } = body;

    if (!imageUrl || !debugPanels || !Array.isArray(debugPanels)) {
      return NextResponse.json(
        { error: 'Missing required parameters: imageUrl, debugPanels' },
        { status: 400 }
      );
    }

    console.log(`开始裁切：共 ${debugPanels.length} 个面板`);
    console.log(`图片URL: ${imageUrl}`);
    console.log(`\n接收到的调试面板数据:`);
    debugPanels.forEach((panel, i) => {
      console.log(`\n面板 ${i + 1}: ${panel.title}`);
      console.log(`  坐标: x=${panel.x}, y=${panel.y}, width=${panel.width}, height=${panel.height}`);
      console.log(`  网格: rows=${panel.rows}, cols=${panel.cols}, total=${panel.total}`);
      if (panel.blueBox) {
        console.log(`  蓝框: x=${panel.blueBox.x}, y=${panel.blueBox.y}, w=${panel.blueBox.width}, h=${panel.blueBox.height}`);
      }
      if (panel.redBoxes && panel.redBoxes.length > 0) {
        console.log(`  红框数量: ${panel.redBoxes.length}`);
        panel.redBoxes.slice(0, 3).forEach((box, idx) => { // 只显示前3个
          console.log(`    红框 #${idx + 1}: x=${box.x}, y=${box.y}, w=${box.width}, h=${box.height}`);
        });
      }
    });

    // 获取原始图片（支持URL或本地文件路径）
    let imageBuffer: Buffer;
    if (imageUrl.startsWith('/api/uploads/') || imageUrl.startsWith('/')) {
      // 本地文件路径：将URL转换为文件系统路径
      // 上传的文件保存在 /tmp/uploads/wiki/ 目录下
      const filename = imageUrl.split('/').pop(); // 提取文件名
      const filePath = path.join('/tmp/uploads/wiki', filename);
      console.log(`读取本地文件: ${filePath}`);

      try {
        imageBuffer = await fs.readFile(filePath);
      } catch (error) {
        throw new Error(`无法读取本地文件: ${filePath}. 错误: ${error instanceof Error ? error.message : '未知错误'}`);
      }
    } else {
      // 远程URL
      const imageResponse = await fetch(imageUrl);
      if (!imageResponse.ok) {
        throw new Error(`Failed to fetch image: ${imageResponse.statusText}`);
      }
      imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
    }

    const metadata = await sharp(imageBuffer).metadata();

    console.log(`原始图片尺寸: ${metadata.width}x${metadata.height}`);

    const results: CropResult[] = [];
    const verificationResults: VerificationResult[] = [];

    // 遍历所有面板（蓝框）
    for (let panelIndex = 0; panelIndex < debugPanels.length; panelIndex++) {
      const panel = debugPanels[panelIndex];
      console.log(`\n处理面板 ${panelIndex + 1}/${debugPanels.length}: ${panel.title}`);

      // 步骤1：LLM验证icon数量（如果提供了blueBox）
      let llmCount = 0;
      let llmConfidence = '未验证';
      if (panel.blueBox) {
        console.log(`  LLM验证icon数量...`);
        const verification = await verifyIconCountWithLLM(imageBuffer, panel.blueBox, panel.title);
        llmCount = verification.count;
        llmConfidence = verification.confidence;
      }

      // 步骤2：计算网格推断的icon数量
      let gridCount = 0;
      if (panel.redBoxes && panel.redBoxes.length > 0) {
        gridCount = panel.redBoxes.length;
      } else if (panel.rows && panel.cols) {
        gridCount = panel.rows * panel.cols;
        if (panel.total) {
          gridCount = Math.min(gridCount, panel.total);
        }
      }

      // 步骤3：记录验证结果
      if (panel.blueBox && gridCount > 0) {
        const isMatch = llmCount === gridCount;
        verificationResults.push({
          panelIndex,
          panelTitle: panel.title,
          gridCount,
          llmCount,
          match: isMatch,
          confidence: llmConfidence
        });

        console.log(`  验证结果: 网格推断=${gridCount}, LLM识别=${llmCount}, ${isMatch ? '✓ 匹配' : '✗ 不匹配'} (${llmConfidence})`);

        // 如果数量不匹配，给出警告
        if (!isMatch) {
          console.warn(`  ⚠️ 警告: 面板"${panel.title}"的icon数量不匹配！网格推断${gridCount}个，LLM识别${llmCount}个`);
        }
      }

      // 步骤4：识别绿框中的文字（面板标题）
      let panelTitle = panel.title;
      if (panel.greenBox) {
        console.log(`  识别绿框文字...`);
        panelTitle = await recognizeTextFromGreenBox(imageBuffer, panel.greenBox);
        console.log(`  面板标题: ${panelTitle}`);
      }

      // 步骤5：裁切所有红框（icon）
      if (panel.redBoxes && panel.redBoxes.length > 0) {
        console.log(`  开始裁切 ${panel.redBoxes.length} 个icon...`);

        for (let iconIndex = 0; iconIndex < panel.redBoxes.length; iconIndex++) {
          const redBox = panel.redBoxes[iconIndex];

          // 计算行列号
          const row = Math.floor(iconIndex / panel.cols);
          const col = iconIndex % panel.cols;

          // 详细日志：裁切坐标
          if (iconIndex < 3 || iconIndex === panel.redBoxes.length - 1) { // 只显示前3个和最后一个
            console.log(`    裁切 Icon #${iconIndex + 1}: x=${Math.round(redBox.x)}, y=${Math.round(redBox.y)}, w=${Math.round(redBox.width)}, h=${Math.round(redBox.height)}, row=${row}, col=${col}`);
          }

          const result = await cropIconFromRedBox(
            imageBuffer,
            redBox,
            panelTitle,
            iconIndex,
            row,
            col,
            wikiName
          );

          results.push(result);
        }
      } else {
        // 如果没有提供redBoxes，则根据rows和cols自动计算
        console.log(`  自动计算icon位置...`);
        const iconSize = panel.width / panel.cols;
        const gap = 5; // 假设间距为5像素

        for (let row = 0; row < panel.rows; row++) {
          for (let col = 0; col < panel.cols; col++) {
            const iconIndex = row * panel.cols + col;
            if (panel.total && iconIndex >= panel.total) break;

            const redBox: Coordinate = {
              x: panel.x + col * (iconSize + gap),
              y: panel.y + row * (iconSize + gap),
              width: iconSize,
              height: iconSize,
            };

            const result = await cropIconFromRedBox(
              imageBuffer,
              redBox,
              panelTitle,
              iconIndex,
              row,
              col,
              wikiName
            );

            results.push(result);
          }
        }
      }
    }

    console.log(`\n裁切完成！共裁切 ${results.length} 个icon`);

    // 汇总验证结果
    const matchCount = verificationResults.filter(v => v.match).length;
    const mismatchCount = verificationResults.filter(v => !v.match).length;

    if (verificationResults.length > 0) {
      console.log(`\n验证汇总: ${matchCount}/${verificationResults.length} 个面板数量匹配，${mismatchCount} 个不匹配`);
    }

    return NextResponse.json({
      success: true,
      results,
      total: results.length,
      verification: {
        total: verificationResults.length,
        matched: matchCount,
        mismatched: mismatchCount,
        details: verificationResults
      }
    });

  } catch (error) {
    console.error('裁切失败:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
