import { NextRequest, NextResponse } from 'next/server';
import { LLMClient, Config, HeaderUtils } from 'coze-coding-dev-sdk';
import sharp from 'sharp';
import fs from 'fs/promises';

// 板块信息接口
interface PanelInfo {
  title: string;           // 板块标题（如 "Shells"）
  y: number;               // 板块顶部Y坐标
  height: number;          // 板块高度
  icons: IconInfo[];       // 板块内的图标列表
}

// 图标信息接口
interface IconInfo {
  x: number;               // 图标左上角X坐标
  y: number;               // 图标左上角Y坐标（相对于板块内容区域）
  width: number;           // 图标宽度
  height: number;          // 图标高度
  index: number;           // 图标在板块内的序号（从0开始）
}

// 分析结果接口
interface AnalysisResult {
  panels: PanelInfo[];
  imageWidth: number;
  imageHeight: number;
}

/**
 * 使用LLM视觉模型分析图片，识别板块标题和图标位置
 */
export async function POST(request: NextRequest) {
  try {
    const { imagePath } = await request.json();

    if (!imagePath) {
      return NextResponse.json({ error: 'Image path is required' }, { status: 400 });
    }

    console.log(`Analyzing image: ${imagePath}`);

    // 读取图片
    const imageBuffer = await fs.readFile(imagePath);
    const metadata = await sharp(imageBuffer).metadata();

    if (!metadata.width || !metadata.height) {
      return NextResponse.json({ error: 'Invalid image' }, { status: 400 });
    }

    console.log(`Image size: ${metadata.width}x${metadata.height}`);

    // 转换为base64
    const base64Image = imageBuffer.toString('base64');
    const ext = metadata.format || 'png';
    const dataUri = `data:image/${ext};base64,${base64Image}`;

    // 使用LLM分析图片
    const config = new Config();
    const customHeaders = HeaderUtils.extractForwardHeaders(request.headers);
    const client = new LLMClient(config, customHeaders);

    const prompt = `分析这张游戏Wiki收集页面图片，识别所有板块（合成链）和每个板块内的图标位置。

请仔细观察图片结构：
1. 图片是垂直长图，包含多个板块
2. 每个板块有一个标题（如 "Shells", "Food" 等）和若干图标
3. 标题通常在板块顶部，图标在标题下方排列

请返回JSON格式的分析结果，包含：
- panels: 板块数组，每个板块包含：
  - title: 板块标题文字（精确识别）
  - y: 板块顶部Y坐标（像素）
  - height: 板块高度（像素）
  - icons: 图标数组，每个图标包含：
    - x: 图标左上角X坐标（相对于板块左边缘）
    - y: 图标左上角Y坐标（相对于板块内容区域顶部，即标题下方）
    - width: 图标宽度
    - height: 图标高度
    - index: 图标序号（从0开始）

图片尺寸: ${metadata.width}x${metadata.height}

重要：
1. 精确识别每个板块的标题文字，这是命名的关键
2. 准确标注每个图标的位置和尺寸
3. 只返回JSON，不要其他文字
4. 如果某个区域是纯色/空白（没有实际图标内容），不要将其识别为板块`;

    const messages = [
      {
        role: 'user' as const,
        content: [
          { type: 'text' as const, text: prompt },
          {
            type: 'image_url' as const,
            image_url: {
              url: dataUri,
              detail: 'high' as const,
            },
          },
        ],
      },
    ];

    console.log('Calling LLM for image analysis...');
    const response = await client.invoke(messages, {
      model: 'doubao-seed-1-6-vision-250815',
      temperature: 0.3,
    });

    console.log('LLM response:', response.content.substring(0, 500));

    // 解析LLM返回的JSON
    let analysisResult: AnalysisResult;
    try {
      // 尝试提取JSON
      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        analysisResult = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('No JSON found in response');
      }
    } catch (parseError) {
      console.error('Failed to parse LLM response:', parseError);
      return NextResponse.json(
        { error: 'Failed to parse analysis result', raw: response.content },
        { status: 500 }
      );
    }

    // 添加图片尺寸信息
    analysisResult.imageWidth = metadata.width;
    analysisResult.imageHeight = metadata.height;

    // 统计信息
    const totalIcons = analysisResult.panels.reduce((sum, p) => sum + p.icons.length, 0);
    console.log(`Analysis complete: ${analysisResult.panels.length} panels, ${totalIcons} icons`);

    return NextResponse.json({
      success: true,
      analysis: analysisResult,
    });
  } catch (error: any) {
    console.error('Image analysis error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to analyze image' },
      { status: 500 }
    );
  }
}
