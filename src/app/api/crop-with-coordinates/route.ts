import { NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';
import path from 'path';
import fs from 'fs/promises';
import { cwd } from 'process';

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

    // 下载原始图片
    const imageResponse = await fetch(imageUrl);
    if (!imageResponse.ok) {
      throw new Error(`Failed to fetch image: ${imageResponse.statusText}`);
    }

    const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
    const metadata = await sharp(imageBuffer).metadata();

    console.log(`原始图片尺寸: ${metadata.width}x${metadata.height}`);

    const results: CropResult[] = [];

    // 遍历所有面板（蓝框）
    for (let panelIndex = 0; panelIndex < debugPanels.length; panelIndex++) {
      const panel = debugPanels[panelIndex];
      console.log(`\n处理面板 ${panelIndex + 1}/${debugPanels.length}: ${panel.title}`);

      // 步骤1：识别绿框中的文字（面板标题）
      let panelTitle = panel.title;
      if (panel.greenBox) {
        console.log(`  识别绿框文字...`);
        panelTitle = await recognizeTextFromGreenBox(imageBuffer, panel.greenBox);
        console.log(`  面板标题: ${panelTitle}`);
      }

      // 步骤2：裁切所有红框（icon）
      if (panel.redBoxes && panel.redBoxes.length > 0) {
        console.log(`  开始裁切 ${panel.redBoxes.length} 个icon...`);

        for (let iconIndex = 0; iconIndex < panel.redBoxes.length; iconIndex++) {
          const redBox = panel.redBoxes[iconIndex];

          // 计算行列号
          const row = Math.floor(iconIndex / panel.cols);
          const col = iconIndex % panel.cols;

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

    return NextResponse.json({
      success: true,
      results,
      total: results.length,
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
