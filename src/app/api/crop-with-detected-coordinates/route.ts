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

interface Coordinate {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface DetectedPanel {
  title: string;
  blueBox?: Coordinate;    // 🔧 添加：蓝框
  greenBox?: Coordinate;   // 🔧 添加：绿框
  redBoxes: RedBox[];      // 红框
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

    // 🔧 添加：显示接收到的面板数据
    console.log(`\n接收到的面板数据:`);
    detectedPanels.forEach((panel, i) => {
      console.log(`\n面板 ${i + 1}: ${panel.title}`);
      if (panel.blueBox) {
        console.log(`  蓝框: x=${panel.blueBox.x}, y=${panel.blueBox.y}, w=${panel.blueBox.width}, h=${panel.blueBox.height}`);
      }
      if (panel.greenBox) {
        console.log(`  绿框: x=${panel.greenBox.x}, y=${panel.greenBox.y}, w=${panel.greenBox.width}, h=${panel.greenBox.height}`);
      }
      console.log(`  红框数量: ${panel.redBoxes.length}`);
      if (panel.redBoxes.length > 0) {
        panel.redBoxes.slice(0, 3).forEach((box, idx) => {
          console.log(`    红框 #${idx + 1}: x=${box.x}, y=${box.y}, w=${box.width}, h=${box.height}, row=${box.row}, col=${box.col}`);
        });
      }
    });

    // 🔧 修复：统一使用 /tmp/uploads/wiki/ 路径，与调试台保持一致
    let wikiFilePath: string;
    let actualWikiName: string;

    // 优先使用 /tmp/uploads/wiki/ 路径（上传的图片路径）
    const uploadPath = path.join('/tmp/uploads/wiki', filename);
    try {
      await fs.access(uploadPath);
      wikiFilePath = uploadPath;
      actualWikiName = wikiName || 'default';
      console.log(`  从上传路径读取: ${wikiFilePath}`);
    } catch (error) {
      // 如果上传路径不存在，尝试从 public/WikiPic/ 读取
      if (wikiName) {
        wikiFilePath = path.join(cwd(), 'public', 'WikiPic', wikiName, filename);
        actualWikiName = wikiName;
        console.log(`  从WikiPic路径读取: ${wikiFilePath}`);
      } else {
        wikiFilePath = `/tmp/uploads/wiki/${filename}`;
        actualWikiName = filename.replace(/\.[^/.]+$/, '');
        console.log(`  使用默认路径: ${wikiFilePath}`);
      }
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

      // 🔧 修改：使用线性序号（从0开始），与调试台保持一致
      let iconIndex = 0;

      // 裁切图标（使用前端 Canvas 检测到的坐标）
      for (const redBox of panel.redBoxes) {
        // 🔧 修改：文件名使用线性序号（标题_序号.png）
        const iconFileName = `${title}_${iconIndex}.png`;
        const iconPath = path.join(wikiDir, iconFileName);

        // 🔧 修复：坐标使用 Math.round() 四舍五入，避免浮点数错误
        const roundedX = Math.round(redBox.x);
        const roundedY = Math.round(redBox.y);
        const roundedWidth = Math.round(redBox.width);
        const roundedHeight = Math.round(redBox.height);

        console.log(`  裁切图标 #${iconIndex}: x=${roundedX}, y=${roundedY}, size=${roundedWidth}x${roundedHeight}`);

        // 边界检查
        if (roundedX >= 0 && roundedY >= 0 &&
            roundedX + roundedWidth <= metadata.width &&
            roundedY + roundedHeight <= metadata.height) {
          try {
            await sharp(imageBuffer)
              .extract({
                left: roundedX,
                top: roundedY,
                width: roundedWidth,
                height: roundedHeight
              })
              .png()
              .toFile(iconPath);

            crops.push({
              path: iconFileName,
              name: `${title}_${iconIndex}`,  // 🔧 修改：使用线性序号
              row: redBox.row,
              col: redBox.col,
              totalRows: redBox.row + 1,
              totalCols: redBox.col + 1,
              x: roundedX,
              y: roundedY,
              width: roundedWidth,
              height: roundedHeight,
              panelName: title,
              title: title,
              wikiName: actualWikiName,
              id: `${actualWikiName}_${filenameWithoutExt}_${iconFileName}`,
              imageUrl: `/api/crops/${actualWikiName}/${filenameWithoutExt}/${iconFileName}`
            });

            console.log(`  Saved icon: ${iconFileName} (index=${iconIndex}, size=${roundedWidth}x${roundedHeight})`);
          } catch (e) {
            console.error(`  Failed to save icon ${iconFileName}:`, e);
          }
        } else {
          console.warn(`  Icon #${iconIndex} out of bounds, skipping`);
        }

        iconIndex++;  // 增加线性序号
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
