import { NextRequest } from 'next/server';
import { FetchClient, Config } from 'coze-coding-dev-sdk';
import { writeFile, mkdir, readdir, readFile } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import sharp from 'sharp';
import { cwd } from 'process';
import crypto from 'crypto';

const UPLOAD_DIR = '/tmp/uploads';
const PUBLIC_WIKI_DIR = join(cwd(), 'public', 'WikiPic'); // 新的Wiki图片保存路径

// 图片尺寸过滤阈值
const MIN_HEIGHT = 600; // 最小高度600px（过滤掉小图标）
const MIN_ASPECT_RATIO = 2.0; // 高度至少是宽度的2.0倍（只保留长图）

// 缓存检查参数
const CACHE_SIZE_TOLERANCE = 10; // 尺寸容差（像素），允许±10px的差异
const CACHE_METADATA_FILE = '.cache-metadata.json'; // 缓存元数据文件名

// 缓存元数据接口
interface CacheMetadata {
  filename: string;
  md5: string;
  url: string;
  width: number;
  height: number;
  timestamp: number;
}

// 确保Wiki图片目录存在
async function ensureWikiDir(wikiName: string) {
  const wikiSubDir = join(PUBLIC_WIKI_DIR, wikiName);
  if (!existsSync(wikiSubDir)) {
    await mkdir(wikiSubDir, { recursive: true });
  }
  return wikiSubDir;
}

// 读取图片尺寸
async function getImageDimensions(filepath: string): Promise<{ width: number; height: number } | null> {
  try {
    const metadata = await sharp(filepath).metadata();
    if (metadata.width && metadata.height) {
      return { width: metadata.width, height: metadata.height };
    }
    return null;
  } catch (error) {
    console.error(`Failed to read image dimensions: ${filepath}`, error);
    return null;
  }
}

// 检查本地缓存（通过文件名和尺寸对比）
async function checkCache(
  wikiDir: string,
  targetWidth: number,
  targetHeight: number
): Promise<string | null> {
  try {
    // 读取目录下的所有图片文件
    const files = await readdir(wikiDir);
    const imageFiles = files.filter(file =>
      file.endsWith('.png') || file.endsWith('.jpg') || file.endsWith('.jpeg') || file.endsWith('.webp')
    );

    for (const file of imageFiles) {
      const filepath = join(wikiDir, file);
      const dimensions = await getImageDimensions(filepath);

      if (dimensions) {
        // 检查尺寸是否匹配（允许容差）
        const widthMatch = Math.abs(dimensions.width - targetWidth) <= CACHE_SIZE_TOLERANCE;
        const heightMatch = Math.abs(dimensions.height - targetHeight) <= CACHE_SIZE_TOLERANCE;

        if (widthMatch && heightMatch) {
          console.log(`Cache hit: ${file} (${dimensions.width}x${dimensions.height}) matches target (${targetWidth}x${targetHeight})`);
          return file;
        }
      }
    }

    console.log(`Cache miss: no matching image found for size ${targetWidth}x${targetHeight}`);
    return null;
  } catch (error) {
    console.error('Error checking cache:', error);
    return null;
  }
}

// 计算图片的MD5哈希
async function calculateMD5(buffer: Buffer): Promise<string> {
  return crypto.createHash('md5').update(buffer).digest('hex');
}

// 读取缓存元数据
async function readCacheMetadata(wikiDir: string): Promise<CacheMetadata[]> {
  try {
    const metadataPath = join(wikiDir, CACHE_METADATA_FILE);
    const data = await readFile(metadataPath, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    console.log('No cache metadata found, creating new one');
    return [];
  }
}

// 保存缓存元数据
async function saveCacheMetadata(wikiDir: string, metadata: CacheMetadata[]): Promise<void> {
  const metadataPath = join(wikiDir, CACHE_METADATA_FILE);
  await writeFile(metadataPath, JSON.stringify(metadata, null, 2), 'utf-8');
}

// 通过MD5检查缓存
async function checkCacheByMD5(wikiDir: string, md5: string): Promise<CacheMetadata | null> {
  try {
    const metadataList = await readCacheMetadata(wikiDir);
    const cached = metadataList.find(m => m.md5 === md5);
    if (cached) {
      console.log(`Cache hit by MD5: ${cached.filename}`);
      return cached;
    }
    console.log(`Cache miss by MD5: ${md5.substring(0, 8)}...`);
    return null;
  } catch (error) {
    console.error('Error checking cache by MD5:', error);
    return null;
  }
}

// 发送SSE事件
function sendEvent(stream: ReadableStreamDefaultController<any>, event: string, data: any) {
  const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  stream.enqueue(new TextEncoder().encode(message));
}

// 下载图片（带超时和重试）
async function downloadImageWithRetry(
  url: string,
  maxRetries: number = 3,
  timeout: number = 60000 // 60秒超时
): Promise<Buffer> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        },
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      if (buffer.length === 0) {
        throw new Error('Empty image buffer');
      }

      return buffer;
    } catch (error: any) {
      if (attempt === maxRetries) {
        throw error;
      }
      console.warn(`Download attempt ${attempt} failed for ${url}: ${error.message}, retrying...`);
      // 等待2秒后重试
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
  throw new Error('Max retries exceeded');
}

// 从Wiki URL获取图片（SSE流式版本）
export async function POST(request: NextRequest) {
  const { url } = await request.json();

  if (!url) {
    return new Response(JSON.stringify({ error: 'URL is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  console.log('Starting SSE Wiki fetch for:', url);

  // 创建SSE流
  const stream = new ReadableStream({
    async start(controller) {
      try {
        const config = new Config();
        const client = new FetchClient(config);

        sendEvent(controller, 'progress', { step: 'fetching', message: '正在获取Wiki页面内容...' });

        // 获取Wiki页面内容
        const response = await client.fetch(url);
        console.log('Page fetched successfully');

        // 清理Wiki名称（移除特殊字符，用作文件夹名）
        const wikiName = (response.title || 'Wiki')
          .replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]/g, '_')
          .replace(/_{2,}/g, '_')
          .substring(0, 50);

        console.log(`Wiki name: ${wikiName}`);

        // 创建Wiki图片目录
        const wikiDir = await ensureWikiDir(wikiName);
        console.log(`Wiki directory: ${wikiDir}`);

        sendEvent(controller, 'progress', { step: 'analyzing', message: '正在分析页面中的图片...' });

        // 提取图片
        const images = response.content.filter(item => item.type === 'image');
        console.log(`Found ${images.length} images in the page`);

        if (images.length === 0) {
          sendEvent(controller, 'error', { message: '未在Wiki页面中找到任何图片' });
          controller.close();
          return;
        }

        sendEvent(controller, 'progress', {
          step: 'found',
          message: `找到${images.length}张图片，准备分析...`,
          totalImages: images.length
        });

        // ========== 第一阶段：使用低清图筛选 ==========
        sendEvent(controller, 'progress', {
          step: 'filtering',
          message: '📊 正在分析低清图，筛选长图...'
        });

        const validImages: Array<{
          index: number;
          thumbnailUrl: string;
          originalUrl: string;
          width: number;
          height: number;
          aspectRatio: number;
          imageData: any;
          thumbnailBuffer: Buffer;
          thumbnailMD5: string;
        }> = [];

        const filteredCount = { tooSmall: 0, notLong: 0, invalid: 0 };

        // 先用低清图下载并筛选
        for (let i = 0; i < images.length; i++) {
          const image = images[i];

          // 尝试获取图片URL（优先使用display_url，因为它是缩略图）
          const imageData = image.image as any;
          const thumbnailUrl = imageData?.display_url || imageData?.image_url || imageData?.original_url;

          if (!thumbnailUrl) {
            console.warn(`Image ${i} has no URL`);
            filteredCount.invalid++;
            continue;
          }

          // 构建原图URL（更激进的清理策略）
          let originalUrl = imageData?.original_url || imageData?.image_url || imageData?.display_url;
          
          if (!originalUrl) {
            console.warn(`Image ${i} has no URL`);
            filteredCount.invalid++;
            continue;
          }

          console.log(`Original URL before processing: ${originalUrl.substring(0, 100)}...`);

          // 清理URL，移除所有可能影响图片质量的路径和参数
          // Fandom URL结构：static.wikia.nocookie.net/{wiki}/images/{path}/{filename}?revision=...
          // 移除 revision/latest 等路径
          if (originalUrl.includes('/revision/')) {
            const parts = originalUrl.split('/revision/');
            originalUrl = parts[0]; // 只保留 revision 之前的部分
            console.log(`  Removed /revision/ path`);
          }

          // 移除 scale-to-width-down 路径
          if (originalUrl.includes('/scale-to-width-down/')) {
            originalUrl = originalUrl.split('/scale-to-width-down/')[0];
            console.log(`  Removed /scale-to-width-down/ path`);
          }

          // 移除 scale-to-height-down 路径
          if (originalUrl.includes('/scale-to-height-down/')) {
            originalUrl = originalUrl.split('/scale-to-height-down/')[0];
            console.log(`  Removed /scale-to-height-down/ path`);
          }

          // 添加 format=original 参数强制返回原图（这个参数很重要！）
          if (!originalUrl.includes('format=original')) {
            const separator = originalUrl.includes('?') ? '&' : '?';
            originalUrl = `${originalUrl}${separator}format=original`;
            console.log(`  Added format=original parameter`);
          }

          console.log(`Processed original URL: ${originalUrl.substring(0, 100)}...`);

          try {
            // 下载低清缩略图（只用于检测尺寸）
            const imageResponse = await fetch(thumbnailUrl, {
              headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
              }
            });

            if (!imageResponse.ok) {
              filteredCount.invalid++;
              continue;
            }

            const arrayBuffer = await imageResponse.arrayBuffer();
            if (arrayBuffer.byteLength === 0) {
              filteredCount.invalid++;
              continue;
            }

            // 检测低清图的尺寸
            const metadata = await sharp(Buffer.from(arrayBuffer)).metadata();
            const { width, height } = metadata;

            if (!width || !height) {
              filteredCount.invalid++;
              continue;
            }

            const aspectRatio = height / width;

            // 过滤小图（基于低清图的尺寸）
            if (height < MIN_HEIGHT) {
              filteredCount.tooSmall++;
              console.log(`Image ${i} is too small (${width}x${height} < 600px)`);
              continue;
            }

            // 过滤非长图（基于低清图的高宽比）
            if (aspectRatio < MIN_ASPECT_RATIO) {
              filteredCount.notLong++;
              console.log(`Image ${i} is not a long image (aspect ratio ${aspectRatio.toFixed(2)} < 2.0)`);
              continue;
            }

            // 保留符合条件的图片（记录低清和高清URL、buffer、MD5）
            const thumbnailBuffer = Buffer.from(arrayBuffer);
            const thumbnailMD5 = await calculateMD5(thumbnailBuffer);

            validImages.push({
              index: i,
              thumbnailUrl,
              originalUrl,
              width,
              height,
              aspectRatio,
              imageData,
              thumbnailBuffer,
              thumbnailMD5
            });

            console.log(`Image ${i} passed filter (${width}x${height}, ratio ${aspectRatio.toFixed(2)})`);
          } catch (error: any) {
            console.warn(`Failed to analyze image ${i}:`, error.message);
            filteredCount.invalid++;
          }
        }

        // 第一阶段完成，显示筛选结果
        if (validImages.length === 0) {
          sendEvent(controller, 'error', {
            message: '未找到符合条件的长图',
            details: `共检测${images.length}张图片，已过滤：${filteredCount.invalid}张无效 + ${filteredCount.tooSmall}张太小 + ${filteredCount.notLong}张非长图`
          });
          controller.close();
          return;
        }

        sendEvent(controller, 'filtering_complete', {
          totalFound: images.length,
          validCount: validImages.length,
          filtered: filteredCount,
          message: `✅ 筛选完成！找到 ${validImages.length} 张长图，准备下载高清原图...`
        });

        // ========== 第二阶段：下载高清原图 ==========
        const downloadedImages: string[] = [];
        const errors: string[] = [];

        for (let i = 0; i < validImages.length; i++) {
          const validImage = validImages[i];

          // 发送保存进度事件
          sendEvent(controller, 'progress', {
            step: 'saving',
            message: `💾 正在保存图片 ${i + 1}/${validImages.length}...`,
            current: i + 1,
            total: validImages.length,
            width: validImage.width,
            height: validImage.height
          });

          try {
            // 先检查缓存（使用低清图的MD5作为缓存键）
            const cachedMetadata = await checkCacheByMD5(wikiDir, validImage.thumbnailMD5);

            let filename: string;
            let hdWidth: number;
            let hdHeight: number;

            if (cachedMetadata) {
              // 缓存命中，使用本地缓存
              filename = cachedMetadata.filename;
              hdWidth = cachedMetadata.width;
              hdHeight = cachedMetadata.height;
              console.log(`Using cached image: ${filename} (${hdWidth}x${hdHeight})`);

              // 发送缓存命中事件
              sendEvent(controller, 'progress', {
                step: 'cached',
                message: `⚡ 使用缓存图片 ${i + 1}/${validImages.length}（跳过下载）`,
                filename,
                width: hdWidth,
                height: hdHeight,
                current: i + 1,
                total: validImages.length
              });
            } else {
              // 缓存未命中，下载高清原图
              console.log(`Downloading image ${i + 1}/${validImages.length} with timeout and retry...`);

              // 发送下载进度事件
              sendEvent(controller, 'progress', {
                step: 'downloading',
                message: `⬇️ 正在下载图片 ${i + 1}/${validImages.length}...`,
                current: i + 1,
                total: validImages.length,
                width: validImage.width,
                height: validImage.height
              });

              const imageBuffer = await downloadImageWithRetry(validImage.originalUrl, 3, 90000); // 90秒超时

              // 检测高清图的实际尺寸
              const metadata = await sharp(imageBuffer).metadata();
              hdWidth = metadata.width || validImage.width;
              hdHeight = metadata.height || validImage.height;

              // 保存图片到Wiki专属目录
              const ext = 'png'; // 统一保存为PNG格式以保持质量
              filename = `wiki-${Date.now()}-${validImage.index}.${ext}`;
              const filepath = join(wikiDir, filename);
              await writeFile(filepath, imageBuffer);

              console.log(`Successfully saved: ${filename} (${hdWidth}x${hdHeight} - HD) in ${wikiName}`);

              // 保存缓存元数据
              const cacheMetadata: CacheMetadata = {
                filename,
                md5: validImage.thumbnailMD5,
                url: validImage.originalUrl,
                width: hdWidth,
                height: hdHeight,
                timestamp: Date.now()
              };
              const metadataList = await readCacheMetadata(wikiDir);
              metadataList.push(cacheMetadata);
              await saveCacheMetadata(wikiDir, metadataList);
              console.log(`Saved cache metadata for: ${filename}`);

              // 发送下载成功事件
              sendEvent(controller, 'saved', {
                message: `✓ 已下载 ${i + 1}/${validImages.length}`,
                filename,
                width: hdWidth,
                height: hdHeight,
                current: i + 1,
                total: validImages.length
              });
            }

            downloadedImages.push(filename);
          } catch (error: any) {
            console.error(`Failed to save image ${i}:`, error);
            errors.push(`Image ${i}: ${error.message}`);
            sendEvent(controller, 'error', {
              message: `✗ 保存失败: ${error.message}`,
              current: i + 1,
              total: validImages.length
            });
          }
        }

        if (downloadedImages.length === 0) {
          sendEvent(controller, 'error', { message: '未能保存任何图片', errors });
          controller.close();
          return;
        }

        sendEvent(controller, 'progress', {
          step: 'complete',
          message: `✅ 完成！成功保存 ${downloadedImages.length}/${validImages.length} 张高清原图`,
          filtered: images.length - validImages.length
        });

        // 发送最终结果
        sendEvent(controller, 'complete', {
          success: true,
          images: downloadedImages,
          wikiName: wikiName, // 添加Wiki名称，用于构建图片URL
          title: response.title,
          url: response.url,
          totalFound: images.length, // 原始找到的图片数量
          totalImages: validImages.length, // 符合条件的图片数量
          savedImages: downloadedImages.length, // 实际保存的图片数量
          filtered: images.length - validImages.length, // 被过滤的图片数量
          errors: errors.length > 0 ? errors : undefined,
        });

        controller.close();
      } catch (error: any) {
        console.error('Fetch Wiki error:', error);
        sendEvent(controller, 'error', {
          message: error.message || '获取Wiki失败',
          stack: error.stack
        });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
