import { NextRequest } from "next/server";
import { writeFile, mkdir, readFile, stat } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";
import sharp from "sharp";
import { cwd } from "process";
import crypto from "crypto";

const PUBLIC_WIKI_DIR = join(cwd(), "public", "WikiPic"); // 新的Wiki图片保存路径

// 图片尺寸过滤阈值
const MIN_HEIGHT = 600; // 最小高度600px（过滤掉小图标）
const MIN_ASPECT_RATIO = 2.0; // 高度至少是宽度的2.0倍（只保留长图）

const CACHE_METADATA_FILE = ".cache-metadata.json"; // 缓存元数据文件名

// 缓存元数据接口
interface CacheMetadata {
  filename: string;
  md5: string;
  url: string;
  width: number;
  height: number;
  timestamp: number;
  contentLength?: number;
  etag?: string;
  lastModified?: string;
  sha256?: string;
}

interface RemoteFingerprint {
  contentLength: number;
  etag: string;
  lastModified: string;
}

// 确保Wiki图片目录存在
async function ensureWikiDir(wikiName: string) {
  const wikiSubDir = join(PUBLIC_WIKI_DIR, wikiName);
  if (!existsSync(wikiSubDir)) {
    await mkdir(wikiSubDir, { recursive: true });
  }
  return wikiSubDir;
}

function calculateTextMD5(text: string): string {
  return crypto.createHash("md5").update(text, "utf8").digest("hex");
}

function calculateSHA256(buffer: Buffer): string {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function normalizeImageUrl(url: string): string {
  return url.trim();
}

function buildCacheKey(url: string, fingerprint?: RemoteFingerprint | null): string {
  const normalized = normalizeImageUrl(url);
  const signature = fingerprint
    ? `${normalized}|${fingerprint.contentLength}|${fingerprint.etag}|${fingerprint.lastModified}`
    : normalized;
  return calculateTextMD5(signature);
}

async function fetchRemoteFingerprint(url: string): Promise<RemoteFingerprint | null> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    const response = await fetch(url, {
      method: "HEAD",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return null;
    }

    const contentLength = Number(response.headers.get("content-length") || "0") || 0;
    const etag = response.headers.get("etag") || "";
    const lastModified = response.headers.get("last-modified") || "";

    return {
      contentLength,
      etag,
      lastModified,
    };
  } catch {
    return null;
  }
}

async function validateCachedFile(
  wikiDir: string,
  cache: CacheMetadata,
  fingerprint?: RemoteFingerprint | null,
): Promise<boolean> {
  const filepath = join(wikiDir, cache.filename);
  if (!existsSync(filepath)) {
    return false;
  }

  try {
    const fileStat = await stat(filepath);

    if (fingerprint && fingerprint.contentLength > 0 && fileStat.size !== fingerprint.contentLength) {
      return false;
    }

    if (cache.contentLength && cache.contentLength > 0 && fileStat.size !== cache.contentLength) {
      return false;
    }

    if (cache.sha256) {
      const fileBuffer = await readFile(filepath);
      const currentSha256 = calculateSHA256(fileBuffer);
      if (currentSha256 !== cache.sha256) {
        return false;
      }
    }

    return true;
  } catch {
    return false;
  }
}

// 读取缓存元数据
async function readCacheMetadata(wikiDir: string): Promise<CacheMetadata[]> {
  try {
    const metadataPath = join(wikiDir, CACHE_METADATA_FILE);
    const data = await readFile(metadataPath, "utf-8");
    return JSON.parse(data);
  } catch {
    console.log("No cache metadata found, creating new one");
    return [];
  }
}

// 保存缓存元数据
async function saveCacheMetadata(
  wikiDir: string,
  metadata: CacheMetadata[],
): Promise<void> {
  const metadataPath = join(wikiDir, CACHE_METADATA_FILE);
  await writeFile(metadataPath, JSON.stringify(metadata, null, 2), "utf-8");
}

// 通过MD5检查缓存
async function checkCacheByMD5(
  wikiDir: string,
  md5: string,
): Promise<CacheMetadata | null> {
  try {
    const metadataList = await readCacheMetadata(wikiDir);
    const cached = metadataList.find((m) => m.md5 === md5);
    if (cached) {
      console.log(`Cache hit by MD5: ${cached.filename}`);
      return cached;
    }
    console.log(`Cache miss by MD5: ${md5.substring(0, 8)}...`);
    return null;
  } catch (error) {
    console.error("Error checking cache by MD5:", error);
    return null;
  }
}

// 发送SSE事件
function sendEvent(
  stream: ReadableStreamDefaultController<Uint8Array>,
  event: string,
  data: unknown,
) {
  const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  stream.enqueue(new TextEncoder().encode(message));
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// 下载图片（带超时和重试）
async function downloadImageWithRetry(
  url: string,
  maxRetries: number = 3,
  timeout: number = 60000, // 60秒超时
  onProgress?: (progress: {
    downloadedBytes: number;
    totalBytes: number;
    done: boolean;
  }) => void,
): Promise<Buffer> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const response = await fetch(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const totalBytesHeader = response.headers.get("content-length");
      const totalBytes = totalBytesHeader ? Number(totalBytesHeader) || 0 : 0;

      if (!response.body) {
        throw new Error("Response body is empty");
      }

      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let downloadedBytes = 0;

      onProgress?.({ downloadedBytes, totalBytes, done: false });

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        if (value) {
          chunks.push(value);
          downloadedBytes += value.byteLength;
          onProgress?.({ downloadedBytes, totalBytes, done: false });
        }
      }

      clearTimeout(timeoutId);

      const buffer = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
      onProgress?.({ downloadedBytes, totalBytes, done: true });

      if (buffer.length === 0) {
        throw new Error("Empty image buffer");
      }

      return buffer;
    } catch (error: unknown) {
      const message = getErrorMessage(error);
      if (attempt === maxRetries) {
        throw error;
      }
      console.warn(
        `Download attempt ${attempt} failed for ${url}: ${message}, retrying...`,
      );
      // 等待2秒后重试
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
  throw new Error("Max retries exceeded");
}

// Helper to fetch wiki page using Fandom API to avoid 403s on HTML scraping
async function fetchWikiPage(url: string) {
  console.log(`Fetching wiki data via API: ${url}`);
  try {
    const u = new URL(url);
    const domain = u.hostname;
    // Extract page title from URL (e.g. /wiki/Collection -> Collection)
    const titleMatch = u.pathname.match(/\/wiki\/([^/]+)/);
    const pageTitle = titleMatch
      ? decodeURIComponent(titleMatch[1])
      : "Collection";

    // Construct API URL
    // generator=images: Get all images used on the page
    // prop=imageinfo: Get details for each image
    // iiprop=url: specifically get the URL
    // gimlimit=max: Get up to 500 images at once
    const apiUrl = `https://${domain}/api.php?action=query&titles=${encodeURIComponent(pageTitle)}&generator=images&prop=imageinfo&iiprop=url|size&format=json&gimlimit=500`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30s timeout

    const response = await fetch(apiUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        Accept: "application/json",
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`API Error: ${response.status}`);
    }

    const data = await response.json();

    if (!data.query || !data.query.pages) {
      throw new Error(
        "No images found via API (Page might not exist or has no images)",
      );
    }

    const images: any[] = [];
    const seen = new Set<string>();

    Object.values(data.query.pages).forEach((page: any) => {
      if (page.imageinfo && page.imageinfo[0] && page.imageinfo[0].url) {
        let src = page.imageinfo[0].url;

        // Clean up revision/scale params to get original quality if possible,
        // but Fandom URLs often require the revision part to work.
        // We just ensure we don't have the "scale-to-width" part which limits resolution.
        if (src.includes("/scale-to-width-down/")) {
          src = src.split("/scale-to-width-down/")[0];
        }

        if (!seen.has(src)) {
          seen.add(src);
          images.push({
            type: "image",
            image: {
              display_url: src,
              original_url: src,
              image_url: src,
              width:
                typeof page.imageinfo[0].width === "number"
                  ? page.imageinfo[0].width
                  : undefined,
              height:
                typeof page.imageinfo[0].height === "number"
                  ? page.imageinfo[0].height
                  : undefined,
            },
          });
        }
      }
    });

    return {
      title: pageTitle.replace(/_/g, " "),
      content: images,
      url,
    };
  } catch (error) {
    console.error("API fetch failed:", error);
    throw error;
  }
}

// 从Wiki URL获取图片（SSE流式版本）
export async function POST(request: NextRequest) {
  let { url } = await request.json();

  if (!url) {
    return new Response(JSON.stringify({ error: "URL is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // FIX: Trim whitespace
  url = url.trim();

  // FIX: Ensure protocol exists (optional, but helpful)
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    url = "https://" + url;
  }

  // FIX: Validate URL format
  try {
    new URL(url); // This will throw if the URL is still invalid
  } catch {
    return new Response(JSON.stringify({ error: "Invalid URL format" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  console.log("Starting SSE Wiki fetch for:", url);

  // 创建SSE流
  const stream = new ReadableStream({
    async start(controller) {
      try {
        // const config = new Config();
        // const client = new FetchClient(config);

        sendEvent(controller, "progress", {
          step: "fetching",
          message: "正在获取Wiki页面内容...",
        });

        // 获取Wiki页面内容
        // const response = await client.fetch(url);
        const response = await fetchWikiPage(url);
        console.log("Page fetched successfully");

        // 清理Wiki名称（移除特殊字符，用作文件夹名）
        const wikiName = (response.title || "Wiki")
          .replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]/g, "_")
          .replace(/_{2,}/g, "_")
          .substring(0, 50);

        console.log(`Wiki name: ${wikiName}`);

        // 创建Wiki图片目录
        const wikiDir = await ensureWikiDir(wikiName);
        console.log(`Wiki directory: ${wikiDir}`);

        sendEvent(controller, "progress", {
          step: "analyzing",
          message: "正在分析页面中的图片...",
        });

        // 提取图片
        const images = response.content.filter((item) => item.type === "image");
        console.log(`Found ${images.length} images in the page`);

        if (images.length === 0) {
          sendEvent(controller, "error", {
            message: "未在Wiki页面中找到任何图片",
          });
          controller.close();
          return;
        }

        sendEvent(controller, "progress", {
          step: "found",
          message: `找到${images.length}张图片，准备分析...`,
          totalImages: images.length,
        });

        // ========== 第一阶段：使用低清图筛选 ==========
        sendEvent(controller, "progress", {
          step: "filtering",
          message: "📊 正在分析低清图，筛选长图...",
        });

        const validImages: Array<{
          index: number;
          thumbnailUrl: string;
          originalUrl: string;
          width: number;
          height: number;
          aspectRatio: number;
          imageData: any;
          thumbnailMD5: string;
        }> = [];

        const filteredCount = { tooSmall: 0, notLong: 0, invalid: 0 };

        // 先用低清图下载并筛选
        for (let i = 0; i < images.length; i++) {
          const image = images[i];
          const current = i + 1;
          const total = images.length;

          // 尝试获取图片URL（优先使用display_url，因为它是缩略图）
          const imageData = image.image as any;
          const thumbnailUrl =
            imageData?.display_url ||
            imageData?.image_url ||
            imageData?.original_url;

          sendEvent(controller, "progress", {
            step: "filtering_scan",
            subStage: "准备读取缩略图",
            message: `🔎 正在分析第 ${current}/${total} 张图片...`,
            current,
            total,
            previewUrl: thumbnailUrl || "",
          });

          if (!thumbnailUrl) {
            console.warn(`Image ${i} has no URL`);
            filteredCount.invalid++;
            sendEvent(controller, "progress", {
              step: "filtering_scan",
              subStage: "跳过无效图片",
              message: `⚠️ 第 ${current}/${total} 张缺少图片URL，已跳过`,
              current,
              total,
            });
            continue;
          }

          // 构建原图URL（更激进的清理策略）
          let originalUrl =
            imageData?.original_url ||
            imageData?.image_url ||
            imageData?.display_url;

          if (!originalUrl) {
            console.warn(`Image ${i} has no URL`);
            filteredCount.invalid++;
            sendEvent(controller, "progress", {
              step: "filtering_scan",
              subStage: "跳过无效图片",
              message: `⚠️ 第 ${current}/${total} 张原图URL无效，已跳过`,
              current,
              total,
              previewUrl: thumbnailUrl,
            });
            continue;
          }

          console.log(
            `Original URL before processing: ${originalUrl.substring(0, 100)}...`,
          );

          // 清理URL，移除所有可能影响图片质量的路径和参数
          // Fandom URL结构：static.wikia.nocookie.net/{wiki}/images/{path}/{filename}?revision=...
          // 移除 revision/latest 等路径
          if (originalUrl.includes("/revision/")) {
            const parts = originalUrl.split("/revision/");
            originalUrl = parts[0]; // 只保留 revision 之前的部分
            console.log(`  Removed /revision/ path`);
          }

          // 移除 scale-to-width-down 路径
          if (originalUrl.includes("/scale-to-width-down/")) {
            originalUrl = originalUrl.split("/scale-to-width-down/")[0];
            console.log(`  Removed /scale-to-width-down/ path`);
          }

          // 移除 scale-to-height-down 路径
          if (originalUrl.includes("/scale-to-height-down/")) {
            originalUrl = originalUrl.split("/scale-to-height-down/")[0];
            console.log(`  Removed /scale-to-height-down/ path`);
          }

          // 添加 format=original 参数强制返回原图（这个参数很重要！）
          if (!originalUrl.includes("format=original")) {
            const separator = originalUrl.includes("?") ? "&" : "?";
            originalUrl = `${originalUrl}${separator}format=original`;
            console.log(`  Added format=original parameter`);
          }

          console.log(
            `Processed original URL: ${originalUrl.substring(0, 100)}...`,
          );

          try {
            let width =
              typeof imageData?.width === "number" ? imageData.width : undefined;
            let height =
              typeof imageData?.height === "number" ? imageData.height : undefined;
            let analyzedBytes = 0;

            if (width && height) {
              sendEvent(controller, "progress", {
                step: "filtering_scan",
                subStage: "读取元数据",
                message: `📚 正在读取图片元数据 ${current}/${total}`,
                current,
                total,
                width,
                height,
                previewUrl: thumbnailUrl,
              });
            } else {
              sendEvent(controller, "progress", {
                step: "filtering_scan",
                subStage: "下载缩略图",
                message: `⬇️ 正在下载缩略图 ${current}/${total}`,
                current,
                total,
                previewUrl: thumbnailUrl,
              });

              // 仅在没有元数据尺寸时回退下载缩略图检测
              const imageResponse = await fetch(thumbnailUrl, {
                headers: {
                  "User-Agent":
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
                },
              });

              if (!imageResponse.ok) {
                filteredCount.invalid++;
                sendEvent(controller, "progress", {
                  step: "filtering_scan",
                  subStage: "下载失败",
                  message: `⚠️ 第 ${current}/${total} 张缩略图下载失败`,
                  current,
                  total,
                  previewUrl: thumbnailUrl,
                });
                continue;
              }

              const arrayBuffer = await imageResponse.arrayBuffer();
              analyzedBytes = arrayBuffer.byteLength;
              if (arrayBuffer.byteLength === 0) {
                filteredCount.invalid++;
                sendEvent(controller, "progress", {
                  step: "filtering_scan",
                  subStage: "空图片数据",
                  message: `⚠️ 第 ${current}/${total} 张图片数据为空`,
                  current,
                  total,
                  previewUrl: thumbnailUrl,
                });
                continue;
              }

              // 使用缩略图探测尺寸
              const metadata = await sharp(Buffer.from(arrayBuffer)).metadata();
              width = metadata.width;
              height = metadata.height;
            }

            sendEvent(controller, "progress", {
              step: "filtering_scan",
              subStage: "检测尺寸",
              message: `📐 第 ${current}/${total} 张尺寸 ${width || "?"}x${height || "?"}`,
              current,
              total,
              width,
              height,
              bytes: analyzedBytes,
              previewUrl: thumbnailUrl,
            });

            if (!width || !height) {
              filteredCount.invalid++;
              sendEvent(controller, "progress", {
                step: "filtering_scan",
                subStage: "无效尺寸",
                message: `⚠️ 第 ${current}/${total} 张无法识别尺寸`,
                current,
                total,
                previewUrl: thumbnailUrl,
              });
              continue;
            }

            const aspectRatio = height / width;

            // 过滤小图（基于低清图的尺寸）
            if (height < MIN_HEIGHT) {
              filteredCount.tooSmall++;
              console.log(
                `Image ${i} is too small (${width}x${height} < 600px)`,
              );
              sendEvent(controller, "progress", {
                step: "filtering_scan",
                subStage: "尺寸过滤",
                message: `📏 第 ${current}/${total} 张高度不足，已过滤`,
                current,
                total,
                width,
                height,
                previewUrl: thumbnailUrl,
              });
              continue;
            }

            // 过滤非长图（基于低清图的高宽比）
            if (aspectRatio < MIN_ASPECT_RATIO) {
              filteredCount.notLong++;
              console.log(
                `Image ${i} is not a long image (aspect ratio ${aspectRatio.toFixed(2)} < 2.0)`,
              );
              sendEvent(controller, "progress", {
                step: "filtering_scan",
                subStage: "比例过滤",
                message: `📉 第 ${current}/${total} 张比例不足，已过滤`,
                current,
                total,
                width,
                height,
                previewUrl: thumbnailUrl,
              });
              continue;
            }

            // 保留符合条件的图片（记录低清和高清URL、缓存键）
            const thumbnailMD5 = calculateTextMD5(originalUrl);

            validImages.push({
              index: i,
              thumbnailUrl,
              originalUrl,
              width,
              height,
              aspectRatio,
              imageData,
              thumbnailMD5,
            });

            console.log(
              `Image ${i} passed filter (${width}x${height}, ratio ${aspectRatio.toFixed(2)})`,
            );
            sendEvent(controller, "progress", {
              step: "filtering_scan",
              subStage: "筛选通过",
              message: `✅ 第 ${current}/${total} 张通过筛选`,
              current,
              total,
              width,
              height,
              previewUrl: thumbnailUrl,
            });
          } catch (error: unknown) {
            console.warn(`Failed to analyze image ${i}:`, getErrorMessage(error));
            filteredCount.invalid++;
            sendEvent(controller, "progress", {
              step: "filtering_scan",
              subStage: "分析失败",
              message: `❌ 第 ${current}/${total} 张分析失败`,
              current,
              total,
              previewUrl: thumbnailUrl,
            });
          }
        }

        // 第一阶段完成，显示筛选结果
        if (validImages.length === 0) {
          sendEvent(controller, "error", {
            message: "未找到符合条件的长图",
            details: `共检测${images.length}张图片，已过滤：${filteredCount.invalid}张无效 + ${filteredCount.tooSmall}张太小 + ${filteredCount.notLong}张非长图`,
          });
          controller.close();
          return;
        }

        sendEvent(controller, "filtering_complete", {
          totalFound: images.length,
          validCount: validImages.length,
          filtered: filteredCount,
          message: `✅ 筛选完成！找到 ${validImages.length} 张长图，准备下载高清原图...`,
        });

        // ========== 第二阶段：下载高清原图 ==========
        const downloadedImages: string[] = [];
        const errors: string[] = [];

        for (let i = 0; i < validImages.length; i++) {
          const validImage = validImages[i];

          // 发送保存进度事件
          sendEvent(controller, "progress", {
            step: "saving",
            subStage: "准备保存",
            message: `💾 正在保存图片 ${i + 1}/${validImages.length}...`,
            current: i + 1,
            total: validImages.length,
            width: validImage.width,
            height: validImage.height,
            previewUrl: validImage.thumbnailUrl,
          });

          try {
            // 先拉远端指纹，用于构建更稳的缓存键
            const remoteFingerprint = await fetchRemoteFingerprint(
              validImage.originalUrl,
            );
            const cacheKey = buildCacheKey(
              validImage.originalUrl,
              remoteFingerprint,
            );

            // 检查缓存（新键优先，旧键回退）
            const cachedMetadata =
              (await checkCacheByMD5(wikiDir, cacheKey)) ||
              (await checkCacheByMD5(wikiDir, validImage.thumbnailMD5));

            let filename: string;
            let hdWidth: number;
            let hdHeight: number;

            if (
              cachedMetadata &&
              (await validateCachedFile(
                wikiDir,
                cachedMetadata,
                remoteFingerprint,
              ))
            ) {
              // 缓存命中，使用本地缓存
              filename = cachedMetadata.filename;
              hdWidth = cachedMetadata.width;
              hdHeight = cachedMetadata.height;
              console.log(
                `Using cached image: ${filename} (${hdWidth}x${hdHeight})`,
              );

              // 发送缓存命中事件
              sendEvent(controller, "progress", {
                step: "cached",
                subStage: "命中缓存",
                message: `⚡ 使用缓存图片 ${i + 1}/${validImages.length}（跳过下载）`,
                filename,
                width: hdWidth,
                height: hdHeight,
                current: i + 1,
                total: validImages.length,
                previewUrl: validImage.thumbnailUrl,
              });
            } else {
              // 缓存未命中，下载高清原图
              console.log(
                `Downloading image ${i + 1}/${validImages.length} with timeout and retry...`,
              );

              // 发送下载进度事件
              sendEvent(controller, "progress", {
                step: "downloading",
                subStage: "下载高清原图",
                message: `⬇️ 正在下载图片 ${i + 1}/${validImages.length}...`,
                current: i + 1,
                total: validImages.length,
                width: validImage.width,
                height: validImage.height,
                downloadedBytes: 0,
                totalBytes: 0,
                previewUrl: validImage.thumbnailUrl,
              });
              let lastEmitAt = 0;
              const imageBuffer = await downloadImageWithRetry(
                validImage.originalUrl,
                3,
                90000,
                ({ downloadedBytes, totalBytes, done }) => {
                  const now = Date.now();
                  if (!done && now - lastEmitAt < 1000) {
                    return;
                  }
                  lastEmitAt = now;
                  sendEvent(controller, "progress", {
                    step: "downloading",
                    subStage: "下载高清原图",
                    message: `⬇️ 正在下载图片 ${i + 1}/${validImages.length}...`,
                    current: i + 1,
                    total: validImages.length,
                    width: validImage.width,
                    height: validImage.height,
                    downloadedBytes,
                    totalBytes,
                    previewUrl: validImage.thumbnailUrl,
                  });
                },
              ); // 90秒超时

              // 检测高清图的实际尺寸
              const metadata = await sharp(imageBuffer).metadata();
              hdWidth = metadata.width || validImage.width;
              hdHeight = metadata.height || validImage.height;

              // 保存图片到Wiki专属目录
              const ext = "png"; // 统一保存为PNG格式以保持质量
              filename = `wiki-${Date.now()}-${validImage.index}.${ext}`;
              const filepath = join(wikiDir, filename);
              await writeFile(filepath, imageBuffer);

              console.log(
                `Successfully saved: ${filename} (${hdWidth}x${hdHeight} - HD) in ${wikiName}`,
              );

              // 保存缓存元数据
              const cacheMetadata: CacheMetadata = {
                filename,
                md5: cacheKey,
                url: validImage.originalUrl,
                width: hdWidth,
                height: hdHeight,
                timestamp: Date.now(),
                contentLength:
                  remoteFingerprint?.contentLength || imageBuffer.length,
                etag: remoteFingerprint?.etag,
                lastModified: remoteFingerprint?.lastModified,
                sha256: calculateSHA256(imageBuffer),
              };
              const metadataList = await readCacheMetadata(wikiDir);
              const updatedMetadata = metadataList.filter(
                (item) =>
                  item.md5 !== cacheMetadata.md5 &&
                  item.filename !== cacheMetadata.filename,
              );
              updatedMetadata.push(cacheMetadata);
              await saveCacheMetadata(wikiDir, updatedMetadata);
              console.log(`Saved cache metadata for: ${filename}`);

              // 发送下载成功事件
              sendEvent(controller, "saved", {
                message: `✓ 已下载 ${i + 1}/${validImages.length}`,
                subStage: "保存完成",
                filename,
                width: hdWidth,
                height: hdHeight,
                current: i + 1,
                total: validImages.length,
                bytes: imageBuffer.length,
                downloadedBytes: imageBuffer.length,
                totalBytes: imageBuffer.length,
                previewUrl: validImage.thumbnailUrl,
              });
            }

            downloadedImages.push(filename);
          } catch (error: unknown) {
            const message = getErrorMessage(error);
            console.error(`Failed to save image ${i}:`, error);
            errors.push(`Image ${i}: ${message}`);
            sendEvent(controller, "error", {
              message: `✗ 保存失败: ${message}`,
              subStage: "保存失败",
              current: i + 1,
              total: validImages.length,
              previewUrl: validImage.thumbnailUrl,
            });
          }
        }

        if (downloadedImages.length === 0) {
          sendEvent(controller, "error", {
            message: "未能保存任何图片",
            errors,
          });
          controller.close();
          return;
        }

        sendEvent(controller, "progress", {
          step: "complete",
          message: `✅ 完成！成功保存 ${downloadedImages.length}/${validImages.length} 张高清原图`,
          filtered: images.length - validImages.length,
        });

        // 发送最终结果
        sendEvent(controller, "complete", {
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
      } catch (error: unknown) {
        const message = getErrorMessage(error);
        const stack = error instanceof Error ? error.stack : undefined;
        console.error("Fetch Wiki error:", error);
        sendEvent(controller, "error", {
          message: message || "获取Wiki失败",
          stack,
        });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
