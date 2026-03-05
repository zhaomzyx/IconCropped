import { NextRequest, NextResponse } from 'next/server';
import { LLMClient, Config, HeaderUtils } from 'coze-coding-dev-sdk';

/**
 * 使用LLM视觉模型识别图片中的标题文本
 * 只识别文本，不参与坐标定位
 */
export async function POST(request: NextRequest) {
  try {
    const { imageBase64 } = await request.json();

    if (!imageBase64) {
      return NextResponse.json({ error: 'Image base64 is required' }, { status: 400 });
    }

    console.log('Recognizing title from image...');

    // 使用LLM识别标题文本
    const config = new Config();
    const customHeaders = HeaderUtils.extractForwardHeaders(request.headers);
    const client = new LLMClient(config, customHeaders);

    const prompt = `请仔细观察这张图片，识别其中的标题文本。

任务：
1. 找出图片中的主要标题文字（通常是位于顶部的英文标题，如 "Shells", "Food", "Materials" 等）
2. 提取标题的完整文本，保持原始大小写和拼写
3. 只返回标题文本，不要添加任何解释或格式

要求：
- 只返回识别出的标题文本字符串
- 不要返回 JSON 对象
- 不要添加任何额外的说明或格式
- 如果无法识别，返回 "Unknown"`;

    const messages = [
      {
        role: 'user' as const,
        content: [
          { type: 'text' as const, text: prompt },
          {
            type: 'image_url' as const,
            image_url: {
              url: imageBase64,
              detail: 'high' as const,
            },
          },
        ],
      },
    ];

    console.log('Calling LLM for title recognition...');
    const response = await client.invoke(messages, {
      model: 'doubao-seed-1-6-vision-250815',
      temperature: 0.1, // 降低温度以提高准确性
    });

    // 提取标题文本
    let titleText = response.content.trim();

    // 清理可能的引号或格式
    titleText = titleText.replace(/^["'`]|["'`]$/g, '').trim();

    console.log(`Recognized title: "${titleText}"`);

    return NextResponse.json({
      success: true,
      title: titleText,
    });
  } catch (error: any) {
    console.error('Title recognition error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to recognize title' },
      { status: 500 }
    );
  }
}
