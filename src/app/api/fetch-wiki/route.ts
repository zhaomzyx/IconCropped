import { NextRequest, NextResponse } from 'next/server';
import { FetchClient, Config } from 'coze-coding-dev-sdk';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import sharp from 'sharp';

const UPLOAD_DIR = '/tmp/uploads';

// 图片尺寸过滤阈值
const MIN_HEIGHT = 600; // 最小高度600px（过滤掉小图标）
const MIN_ASPECT_RATIO = 2.0; // 高度至少是宽度的2.0倍（只保留长图）

// 确保上传目录存在
async function ensureUploadDir() {
  const wikiDir = join(UPLOAD_DIR, 'wiki');
  if (!existsSync(wikiDir)) {
    await mkdir(wikiDir, { recursive: true });
  }
}

// 从Wiki URL获取图片
export async function POST(request: NextRequest) {
  try {
    const { url } = await request.json();

    if (!url) {
      return NextResponse.json(
        { error: 'URL is required' },
        { status: 400 }
      );
    }

    console.log('Fetching Wiki URL:', url);
    await ensureUploadDir();

    const config = new Config();
    const client = new FetchClient(config);

    console.log('Fetching page content...');
    // 获取Wiki页面内容
    const response = await client.fetch(url);

    console.log('Page response:', JSON.stringify({
      title: response.title,
      url: response.url,
      contentLength: response.content?.length || 0,
      contentType: response.content?.[0]?.type
    }));

    // 提取图片
    const images = response.content.filter(item => item.type === 'image');
    console.log(`Found ${images.length} images in the page`);

    // 输出前三个图片的完整结构，调试用
    if (images.length > 0) {
      console.log('Sample image structures:', JSON.stringify(images.slice(0, 3), null, 2));
    }

    if (images.length === 0) {
      return NextResponse.json(
        { error: 'No images found in the Wiki page', details: response.content },
        { status: 404 }
      );
    }

    // 下载所有图片
    const downloadedImages: string[] = [];
    const errors: string[] = [];

    for (let i = 0; i < images.length; i++) {
      const image = images[i];

      // 尝试获取原图URL，优先使用 original_url
      const imageData = image.image as any;
      let imageUrl = imageData?.original_url || imageData?.image_url || imageData?.display_url;

      if (!imageUrl) {
        console.warn(`Image ${i} has no URL`);
        errors.push(`Image ${i}: No URL`);
        continue;
      }

      console.log(`Image ${i} URL before processing: ${imageUrl.substring(0, 100)}...`);

      // 清理URL，移除所有可能影响图片质量的路径和参数
      // 移除 revision/latest 等路径
      if (imageUrl.includes('/revision/')) {
        const parts = imageUrl.split('/revision/');
        imageUrl = parts[0]; // 只保留 revision 之前的部分
        console.log(`  Removed /revision/ path`);
      }

      // 移除 scale-to-width-down 路径
      if (imageUrl.includes('/scale-to-width-down/')) {
        imageUrl = imageUrl.split('/scale-to-width-down/')[0];
        console.log(`  Removed /scale-to-width-down/ path`);
      }

      // 移除 scale-to-height-down 路径
      if (imageUrl.includes('/scale-to-height-down/')) {
        imageUrl = imageUrl.split('/scale-to-height-down/')[0];
        console.log(`  Removed /scale-to-height-down/ path`);
      }

      // 添加 format=original 参数强制返回原图
      if (!imageUrl.includes('format=original')) {
        const separator = imageUrl.includes('?') ? '&' : '?';
        imageUrl = `${imageUrl}${separator}format=original`;
        console.log(`  Added format=original parameter`);
      }

      console.log(`Image ${i} URL after processing: ${imageUrl.substring(0, 100)}...`);

      console.log(`Downloading image ${i + 1}/${images.length}: ${imageUrl.substring(0, 80)}...`);

      try {
        // 下载图片
        const imageResponse = await fetch(imageUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
          }
        });

        if (!imageResponse.ok) {
          throw new Error(`HTTP ${imageResponse.status}: ${imageResponse.statusText}`);
        }

        const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
        console.log(`Image ${i} size: ${imageBuffer.length} bytes`);

        if (imageBuffer.length === 0) {
          throw new Error('Empty image buffer');
        }

        // 检测图片尺寸
        let metadata;
        try {
          metadata = await sharp(imageBuffer).metadata();
        } catch (e) {
          console.warn(`Image ${i} is not a valid image, skipping`);
          errors.push(`Image ${i}: Invalid image format`);
          continue;
        }

        const { width, height } = metadata;
        if (!width || !height) {
          console.warn(`Image ${i} has invalid dimensions`);
          errors.push(`Image ${i}: Invalid dimensions`);
          continue;
        }

        const aspectRatio = height / width;
        console.log(`Image ${i} dimensions: ${width}x${height}, aspect ratio: ${aspectRatio.toFixed(2)}`);

        // 过滤小图：只保留长图（高度>=600px 且 高宽比>=2.0）
        if (height < MIN_HEIGHT) {
          console.log(`Image ${i} is too small (${width}x${height} < 600px), skipping`);
          continue;
        }

        if (aspectRatio < MIN_ASPECT_RATIO) {
          console.log(`Image ${i} is not a long image (aspect ratio ${aspectRatio.toFixed(2)} < 2.0), skipping`);
          continue;
        }

        // 保存图片
        const ext = metadata.format || 'png';
        const filename = `wiki-${Date.now()}-${i}.${ext}`;
        const filepath = join(UPLOAD_DIR, 'wiki', filename);
        await writeFile(filepath, imageBuffer);

        downloadedImages.push(filename);
        console.log(`Successfully saved: ${filename} (${width}x${height})`);
      } catch (error: any) {
        console.error(`Failed to download image ${i}:`, error);
        errors.push(`Image ${i}: ${error.message}`);
      }
    }

    if (downloadedImages.length === 0) {
      return NextResponse.json(
        { error: 'Failed to download any images', errors },
        { status: 500 }
      );
    }

    console.log(`Successfully downloaded ${downloadedImages.length}/${images.length} images (filtered ${images.length - downloadedImages.length} small images)`);

    return NextResponse.json({
      success: true,
      images: downloadedImages,
      title: response.title,
      url: response.url,
      totalFound: images.length,       // 页面上找到的图片总数
      totalImages: downloadedImages.length, // 下载的长图数量
      filtered: images.length - downloadedImages.length, // 过滤掉的小图数量
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error: any) {
    console.error('Fetch Wiki error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch Wiki', stack: error.stack },
      { status: 500 }
    );
  }
}
