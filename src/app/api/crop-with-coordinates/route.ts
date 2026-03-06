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

// 使用LLM识别绿框中的文字（真正的OCR）
async function recognizeTextFromGreenBox(
  imageBuffer: Buffer,
  greenBox: Coordinate
): Promise<string> {
  try {
    // 裁切绿框区域
    const greenBoxBuffer = await sharp(imageBuffer)
      .extract({
        left: greenBox.x,
        top: greenBox.y,
        width: greenBox.width,
        height: greenBox.height,
      })
      .png()
      .toBuffer();

    // 如果图片太大，先缩放到合理尺寸
    let processBuffer = greenBoxBuffer;
    const greenBoxMetadata = await sharp(greenBoxBuffer).metadata();
    const maxWidth = 500;
    if (greenBoxMetadata.width && greenBoxMetadata.width > maxWidth) {
      const scale = maxWidth / greenBoxMetadata.width;
      processBuffer = await sharp(greenBoxBuffer)
        .resize(maxWidth, null)
        .toBuffer();
    }

    // 转换为base64
    const base64Image = processBuffer.toString('base64');
    const dataUri = `data:image/png;base64,${base64Image}`;

    // LLM提示词（OCR识别英文标题）
    const prompt = `请读取图片中的英文标题文本，直接返回纯文本，不要任何解释。`;

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
      temperature: 0.1 // 降低温度，提高OCR准确性
    });

    console.log(`  LLM OCR response:`, response.content);

    // 提取文本（去除可能的markdown代码块标记）
    let text = response.content.trim();
    text = text.replace(/```(?:text)?\s*/g, '').replace(/```/g, '').trim();

    console.log(`  识别到的标题: ${text}`);

    return text;

  } catch (error) {
    console.error('  LLM OCR识别失败:', error);
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

  // 🔧 修改：文件名使用线性序号（标题_序号.png），序号从0开始
  const filename = `${panelTitle}_${iconIndex}.png`;

  // 保存icon到public/wiki-cropped/wikiName/目录
  const outputDir = path.join(cwd(), 'public', 'wiki-cropped', wikiName);
  await fs.mkdir(outputDir, { recursive: true });

  const outputPath = path.join(outputDir, filename);
  await fs.writeFile(outputPath, iconBuffer);

  console.log(`  保存icon: ${filename} (${redBox.width}x${redBox.height})`);

  return {
    filename,
    name: `${panelTitle}_${iconIndex}`,
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
        panel.redBoxes.slice(0, 3).forEach((box: Coordinate, idx: number) => { // 只显示前3个
          console.log(`    红框 #${idx + 1}: x=${box.x}, y=${box.y}, w=${box.width}, h=${box.height}`);
        });
      }
    });

    // 获取原始图片（支持URL或本地文件路径）
    let imageBuffer: Buffer;
    if (imageUrl.startsWith('/WikiPic/')) {
      // 🌟 从 Wiki URL 获取的图片，保存在 public 目录
      const publicPath = path.join(cwd(), imageUrl);
      console.log(`读取 public 目录文件: ${publicPath}`);

      try {
        imageBuffer = await fs.readFile(publicPath);
      } catch (error) {
        throw new Error(`无法读取 public 目录文件: ${publicPath}. 错误: ${error instanceof Error ? error.message : '未知错误'}`);
      }
    } else if (imageUrl.startsWith('/api/uploads/') || imageUrl.startsWith('/uploads/')) {
      // 上传的文件保存在 /tmp/uploads/wiki/ 目录下
      const filename = imageUrl.split('/').pop(); // 提取文件名
      const filePath = path.join('/tmp/uploads/wiki', filename);
      console.log(`读取上传文件: ${filePath}`);

      try {
        imageBuffer = await fs.readFile(filePath);
      } catch (error) {
        throw new Error(`无法读取上传文件: ${filePath}. 错误: ${error instanceof Error ? error.message : '未知错误'}`);
      }
    } else if (imageUrl.startsWith('/')) {
      // 其他本地路径，尝试从 public 目录读取
      const publicPath = path.join(cwd(), 'public', imageUrl);
      console.log(`读取 public 文件: ${publicPath}`);

      try {
        imageBuffer = await fs.readFile(publicPath);
      } catch (error) {
        throw new Error(`无法读取文件: ${publicPath}. 错误: ${error instanceof Error ? error.message : '未知错误'}`);
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
    console.log(`图片元数据: orientation=${metadata.orientation}, density=${metadata.density}`);

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
      if (panel.redBoxes && panel.redBoxes.length > 0) {
        console.log(`  开始裁切 ${panel.redBoxes.length} 个icon...`);

        for (let iconIndex = 0; iconIndex < panel.redBoxes.length; iconIndex++) {
          const redBox = panel.redBoxes[iconIndex];

          // 🌟 修复脱节 3：优先使用前端传过来的真实行列号！
          // 因为如果前面有空位被过滤了，单纯的除法会导致后面的物品全部分错行和列
          const row = (redBox as any).row !== undefined ? (redBox as any).row : Math.floor(iconIndex / panel.cols);
          const col = (redBox as any).col !== undefined ? (redBox as any).col : iconIndex % panel.cols;

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
