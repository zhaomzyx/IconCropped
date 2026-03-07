import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ filename: string }> },
) {
  try {
    // Next.js 16: params is a Promise
    const { filename } = await params;

    // 安全检查：确保文件名不包含路径遍历字符
    if (filename.includes("..")) {
      return NextResponse.json({ error: "Invalid filename" }, { status: 400 });
    }

    // 解析文件名，格式为 {wikiName}/{actualFilename}
    const parts = filename.split("/");
    let wikiName: string;
    let actualFilename: string;

    if (parts.length === 2) {
      [wikiName, actualFilename] = parts;
    } else {
      // 兼容旧格式：直接从 /tmp/uploads/wiki/ 读取
      wikiName = "";
      actualFilename = filename;
    }

    // 构造文件路径
    let filePath: string;
    if (wikiName) {
      // 新格式：从 public/WikiPic/{wikiName}/ 读取
      filePath = path.join(
        process.cwd(),
        "public",
        "WikiPic",
        wikiName,
        actualFilename,
      );
    } else {
      // 旧格式：从 /tmp/uploads/wiki/ 读取
      filePath = path.join("/tmp", "uploads", "wiki", actualFilename);
    }

    console.log(`Serving wiki image: ${filePath}`);

    // 检查文件是否存在
    try {
      await fs.access(filePath);
    } catch {
      console.error(`File not found: ${filePath}`);
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    // 读取文件
    const fileBuffer = await fs.readFile(filePath);

    // 根据文件扩展名确定Content-Type
    const ext = path.extname(actualFilename).toLowerCase();
    const contentTypes: Record<string, string> = {
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".gif": "image/gif",
      ".webp": "image/webp",
      ".svg": "image/svg+xml",
    };

    const contentType = contentTypes[ext] || "image/png";

    // 返回图片
    return new NextResponse(fileBuffer, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=31536000", // 缓存1年
      },
    });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Failed to serve image";
    console.error("Error serving wiki image:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
