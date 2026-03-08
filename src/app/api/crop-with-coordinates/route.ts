import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import path from "path";
import fs from "fs/promises";
import { cwd } from "process";
import {
  resolvePanelTitle,
  sanitizePanelTitleForFilename,
} from "@/lib/panel-title";

// 接口定义
interface Coordinate {
  x: number;
  y: number;
  width: number;
  height: number;
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

// 裁切红框作为icon
async function cropIconFromRedBox(
  imageBuffer: Buffer,
  redBox: Coordinate,
  panelTitle: string,
  iconIndex: number,
  row: number,
  col: number,
  wikiName: string,
  imageName: string, // 🌟 新增：图片名称（用于创建文件夹）
): Promise<CropResult> {
  // 裁切红框区域（直接裁切，不添加坐标标注）
  // 🔧 修复：sharp.extract要求整数参数，将浮点数四舍五入
  const iconBuffer = await sharp(imageBuffer)
    .extract({
      left: Math.round(redBox.x),
      top: Math.round(redBox.y),
      width: Math.round(redBox.width),
      height: Math.round(redBox.height),
    })
    .png()
    .toBuffer();

  const safeTitle = sanitizePanelTitleForFilename(panelTitle);

  // 文件名：大panel标题_次位序号（从0开始递增）
  const filename = `${safeTitle}_${iconIndex}.png`;

  // 🌟 修改：保存icon到public/wiki-cropped/{图片名称}/目录
  const outputDir = path.join(cwd(), "public", "wiki-cropped", imageName);
  await fs.mkdir(outputDir, { recursive: true });

  const outputPath = path.join(outputDir, filename);
  await fs.writeFile(outputPath, iconBuffer);

  console.log(`  保存icon: ${filename} (${redBox.width}x${redBox.height})`);

  return {
    filename,
    name: `${safeTitle}_${iconIndex}`,
    panelIndex: 0, // 暂时设为0，后续可以根据需要调整
    iconIndex,
    row,
    col,
    wikiName,
    imageUrl: `/wiki-cropped/${imageName}/${filename}`, // 🌟 修改：使用图片名称作为路径
  };
}

// POST接口：接收坐标数据并裁切
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      imageUrl, // 原始图片URL
      debugPanels, // 调试面板数据（包含蓝框、绿框、红框）
      wikiName = "default", // Wiki名称
    } = body;

    // 🌟 打点3 - 后端接收端
    console.log(`[打点3 - 后端接收端] 收到前端发来的切图请求！`);
    console.log(`  - 目标图片: ${imageUrl}`);
    console.log(`  - 收到的面板数量: ${debugPanels?.length}`);
    if (debugPanels && debugPanels.length > 0) {
      console.log(
        `  - 第一个面板的红框(redBoxes)数量: ${debugPanels[0].redBoxes?.length}`,
      );
      if (!debugPanels[0].redBoxes || debugPanels[0].redBoxes.length === 0) {
        console.warn(`  🚨 警告：后端收到的 redBoxes 是空的！切图肯定会失败！`);
      }
    }

    if (!imageUrl || !debugPanels || !Array.isArray(debugPanels)) {
      return NextResponse.json(
        { error: "Missing required parameters: imageUrl, debugPanels" },
        { status: 400 },
      );
    }

    console.log(`开始裁切：共 ${debugPanels.length} 个面板`);
    console.log(`图片URL: ${imageUrl}`);

    // 🌟 从 imageUrl 中提取图片名称（不带扩展名）
    let imageName = wikiName; // 默认使用 wikiName
    if (imageUrl.includes("/")) {
      const urlParts = imageUrl.split("/");
      const filename = urlParts[urlParts.length - 1];
      // 去除扩展名
      imageName = filename.split(".")[0];
      console.log(`提取图片名称: ${imageName}`);
    }

    console.log(`\n接收到的调试面板数据:`);
    debugPanels.forEach((panel, i) => {
      console.log(`\n面板 ${i + 1}: ${panel.title}`);
      console.log(
        `  坐标: x=${panel.x}, y=${panel.y}, width=${panel.width}, height=${panel.height}`,
      );
      console.log(
        `  网格: rows=${panel.rows}, cols=${panel.cols}, total=${panel.total}`,
      );
      if (panel.blueBox) {
        console.log(
          `  蓝框: x=${panel.blueBox.x}, y=${panel.blueBox.y}, w=${panel.blueBox.width}, h=${panel.blueBox.height}`,
        );
      }
      if (panel.redBoxes && panel.redBoxes.length > 0) {
        console.log(`  红框数量: ${panel.redBoxes.length}`);
        panel.redBoxes.slice(0, 3).forEach((box: Coordinate, idx: number) => {
          // 只显示前3个
          console.log(
            `    红框 #${idx + 1}: x=${box.x}, y=${box.y}, w=${box.width}, h=${box.height}`,
          );
        });
      }
    });

    // 获取原始图片（支持URL或本地文件路径）
    let imageBuffer: Buffer;
    if (imageUrl.startsWith("/WikiPic/")) {
      // 🌟 从 Wiki URL 获取的图片，保存在 public 目录
      // Normalize to a public-relative path to avoid ENOENT on Windows.
      const relativeImagePath = imageUrl.replace(/^\/+/, "");
      const publicPath = path.join(cwd(), "public", relativeImagePath);
      console.log(`读取 public 目录文件: ${publicPath}`);

      try {
        imageBuffer = await fs.readFile(publicPath);
      } catch (error) {
        throw new Error(
          `无法读取 public 目录文件: ${publicPath}. 错误: ${error instanceof Error ? error.message : "未知错误"}`,
        );
      }
    } else if (
      imageUrl.startsWith("/api/uploads/") ||
      imageUrl.startsWith("/uploads/")
    ) {
      // 上传的文件保存在 /tmp/uploads/wiki/ 目录下
      const filename = imageUrl.split("/").pop(); // 提取文件名
      const filePath = path.join("/tmp/uploads/wiki", filename);
      console.log(`读取上传文件: ${filePath}`);

      try {
        imageBuffer = await fs.readFile(filePath);
      } catch (error) {
        throw new Error(
          `无法读取上传文件: ${filePath}. 错误: ${error instanceof Error ? error.message : "未知错误"}`,
        );
      }
    } else if (imageUrl.startsWith("/")) {
      // 其他本地路径，尝试从 public 目录读取
      const publicPath = path.join(cwd(), "public", imageUrl);
      console.log(`读取 public 文件: ${publicPath}`);

      try {
        imageBuffer = await fs.readFile(publicPath);
      } catch (error) {
        throw new Error(
          `无法读取文件: ${publicPath}. 错误: ${error instanceof Error ? error.message : "未知错误"}`,
        );
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

    // 检查图片是否有旋转信息
    console.log(
      `图片元数据: orientation=${metadata.orientation}, density=${metadata.density}`,
    );

    const results: CropResult[] = [];

    // 遍历所有面板（蓝框）
    for (let panelIndex = 0; panelIndex < debugPanels.length; panelIndex++) {
      const panel = debugPanels[panelIndex];
      console.log(
        `\n处理面板 ${panelIndex + 1}/${debugPanels.length}: ${panel.title}`,
      );

      // 步骤1：确定面板标题
      // 优先使用前端已识别到的 ocrTitle，避免后端重复识别把正确标题覆盖回占位名。
      const panelTitle = resolvePanelTitle({
        ocrTitle: panel.ocrTitle,
        title: panel.title,
        panelIndex,
      });
      if (panel.redBoxes && panel.redBoxes.length > 0) {
        console.log(`  开始裁切 ${panel.redBoxes.length} 个icon...`);

        const redBoxes = panel.redBoxes as Array<
          Coordinate & { row?: number; col?: number }
        >;

        const orderedRedBoxes = redBoxes
          .map((box: Coordinate, index: number) => ({
            box: box as Coordinate & { row?: number; col?: number },
            index,
          }))
          .sort((a, b) => {
            const aRow = a.box.row;
            const bRow = b.box.row;
            if (
              typeof aRow === "number" &&
              typeof bRow === "number" &&
              aRow !== bRow
            ) {
              return aRow - bRow;
            }

            const aCol = a.box.col;
            const bCol = b.box.col;
            if (
              typeof aCol === "number" &&
              typeof bCol === "number" &&
              aCol !== bCol
            ) {
              return aCol - bCol;
            }

            return a.index - b.index;
          });

        for (
          let iconIndex = 0;
          iconIndex < orderedRedBoxes.length;
          iconIndex++
        ) {
          const redBoxWithGrid = orderedRedBoxes[iconIndex].box;

          // 优先使用前端传来的真实行列号；缺失时按当前序号回退。
          const row = redBoxWithGrid.row ?? Math.floor(iconIndex / panel.cols);
          const col = redBoxWithGrid.col ?? iconIndex % panel.cols;

          // 详细日志：裁切坐标
          if (iconIndex < 3 || iconIndex === panel.redBoxes.length - 1) {
            // 只显示前3个和最后一个
            console.log(
              `    裁切 Icon #${iconIndex + 1}: x=${Math.round(redBoxWithGrid.x)}, y=${Math.round(redBoxWithGrid.y)}, w=${Math.round(redBoxWithGrid.width)}, h=${Math.round(redBoxWithGrid.height)}, row=${row}, col=${col}`,
            );
          }

          const result = await cropIconFromRedBox(
            imageBuffer,
            redBoxWithGrid,
            panelTitle,
            iconIndex,
            row,
            col,
            wikiName,
            imageName, // 🌟 传递图片名称
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
              wikiName,
              imageName, // 🌟 传递图片名称
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
    console.error("裁切失败:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
