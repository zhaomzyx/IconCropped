import { NextRequest } from 'next/server';
import sharp from 'sharp';
import path from 'path';
import fs from 'fs/promises';
import { cwd } from 'process';

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

interface RedBox {
  x: number;
  y: number;
  width: number;
  height: number;
  row: number;
  col: number;
}

interface DetectedPanel {
  title: string;
  redBoxes: RedBox[];
}

// 使用前端 Canvas 检测的坐标进行裁切
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { filename, wikiName, detectedPanels, customParams } = body;

    if (!filename || !detectedPanels || !Array.isArray(detectedPanels)) {
      return new Response(JSON.stringify({ error: 'Missing required parameters' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    console.log(`开始裁切图片: ${filename}`);
    console.log(`  Wiki名称: ${wikiName || 'default'}`);
    console.log(`  检测到的面板数量: ${detectedPanels.length}`);

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

    console.log(`  Wiki图片路径: ${wikiFilePath}`);

    // 检查文件是否存在
    await fs.access(wikiFilePath);

    // 创建Wiki目录路径（按图片名称独立存储）
    const filenameWithoutExt = filename.replace(/\.[^/.]+$/, '');
    const wikiDir = path.join(cwd(), 'public', 'wiki-cropped', actualWikiName, filenameWithoutExt);

    // 不清理缓存，保留所有历史裁切结果
    await fs.mkdir(wikiDir, { recursive: true });

    // 读取图片
    const imageBuffer = await fs.readFile(wikiFilePath);
    const metadata = await sharp(imageBuffer).metadata();

    if (!metadata.width || !metadata.height) {
      throw new Error(`Invalid image metadata`);
    }

    console.log(`  图片尺寸: ${metadata.width}x${metadata.height}`);

    // 处理每个板块
    const crops: WikiCroppedImage[] = [];

    for (let j = 0; j < detectedPanels.length; j++) {
      const panel = detectedPanels[j];
      const title = panel.title;

      console.log(`  处理面板 ${j + 1}/${detectedPanels.length}: ${title}`);
      console.log(`    红框数量: ${panel.redBoxes.length}`);

      // 裁切图标（使用前端 Canvas 检测到的坐标）
      for (const redBox of panel.redBoxes) {
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
              name: `${title}_icon_${redBox.row}_${redBox.col}`,
              row: redBox.row,
              col: redBox.col,
              totalRows: redBox.row + 1,
              totalCols: redBox.col + 1,
              x: redBox.x,
              y: redBox.y,
              width: redBox.width,
              height: redBox.height,
              panelName: title,
              title: title,
              wikiName: actualWikiName,
              id: `${actualWikiName}_${filenameWithoutExt}_${iconFileName}`,
              imageUrl: `/api/crops/${actualWikiName}/${filenameWithoutExt}/${iconFileName}`
            });

            console.log(`  Saved icon: ${iconFileName} (row=${redBox.row}, col=${redBox.col}, size=${redBox.width}x${redBox.height})`);
          } catch (e) {
            console.error(`  Failed to save icon ${iconFileName}:`, e);
          }
        } else {
          console.warn(`  Icon [${redBox.row},${redBox.col}] out of bounds, skipping`);
        }
      }
    }

    console.log(`\n裁切完成！共裁切 ${crops.length} 个图标`);

    return new Response(JSON.stringify({
      success: true,
      crops: crops,
      wikiName: actualWikiName,
      message: `裁切完成，共 ${crops.length} 个图标`
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('裁切失败:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : '未知错误'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
