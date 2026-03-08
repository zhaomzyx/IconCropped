import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { createWriteStream } from "fs";
import archiver from "archiver";

/**
 * API: 下载ZIP
 * 将裁切后的文件夹打包成ZIP下载
 */
export async function POST(request: NextRequest) {
  try {
    const { wikiName, imageNames } = (await request.json()) as {
      wikiName?: string;
      imageNames?: string[];
    };

    if (!wikiName) {
      return NextResponse.json(
        { success: false, error: "缺少 wikiName 参数" },
        { status: 400 },
      );
    }

    const croppedRootDir = path.join(process.cwd(), "public", "wiki-cropped");
    const requestedImageNames = Array.isArray(imageNames)
      ? Array.from(new Set(imageNames.filter((name) => !!name && name.trim())))
      : [];

    if (requestedImageNames.length === 0) {
      const legacyDir = path.join(croppedRootDir, wikiName);
      try {
        await fs.access(legacyDir);
      } catch {
        return NextResponse.json(
          { success: false, error: `目录不存在: ${wikiName}` },
          { status: 404 },
        );
      }
    }

    // 创建临时ZIP文件
    const tempZipPath = path.join(
      process.cwd(),
      "tmp",
      `${wikiName}-cropped-${Date.now()}.zip`,
    );

    // 确保tmp目录存在
    const tmpDir = path.join(process.cwd(), "tmp");
    try {
      await fs.access(tmpDir);
    } catch {
      await fs.mkdir(tmpDir, { recursive: true });
    }

    // 创建ZIP文件
    const output = createWriteStream(tempZipPath);
    const archive = archiver("zip", { zlib: { level: 9 } });

    // 处理错误
    archive.on("error", (err) => {
      throw err;
    });

    // 将输出管道连接到ZIP文件
    archive.pipe(output);

    if (requestedImageNames.length > 0) {
      const existingDirs: string[] = [];
      for (const imageName of requestedImageNames) {
        const dirPath = path.join(croppedRootDir, imageName);
        try {
          await fs.access(dirPath);
          existingDirs.push(imageName);
        } catch {
          console.warn(`[download-zip] 跳过不存在目录: ${imageName}`);
        }
      }

      if (existingDirs.length === 0) {
        return NextResponse.json(
          { success: false, error: "没有可下载的裁切目录" },
          { status: 404 },
        );
      }

      for (const imageName of existingDirs) {
        const dirPath = path.join(croppedRootDir, imageName);
        archive.directory(dirPath, path.join(`${wikiName}-cropped`, imageName));
      }
    } else {
      const legacyDir = path.join(croppedRootDir, wikiName);
      archive.directory(legacyDir, wikiName);
    }

    // 完成ZIP创建
    await archive.finalize();

    // 等待ZIP文件创建完成
    await new Promise<void>((resolve, reject) => {
      output.on("close", () => resolve());
      output.on("error", reject);
    });

    // 读取ZIP文件
    const zipBuffer = await fs.readFile(tempZipPath);

    // 删除临时文件
    await fs.unlink(tempZipPath);

    // 返回ZIP文件
    return new NextResponse(zipBuffer, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${wikiName}-${requestedImageNames.length > 0 ? "batch" : "cropped"}.zip"`,
        "Content-Length": zipBuffer.length.toString(),
      },
    });
  } catch (error) {
    console.error("Download ZIP error:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "下载失败",
      },
      { status: 500 },
    );
  }
}
