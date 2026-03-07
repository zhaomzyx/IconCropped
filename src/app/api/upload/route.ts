import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir, readdir } from "fs/promises";
import { join, extname, dirname } from "path";
import { existsSync } from "fs";
import { ResourceType, ResourceItem, SynthesisChain } from "@/types";

// 存储上传文件的目录
const UPLOAD_DIR = "/tmp/uploads";

// 确保上传目录存在
async function ensureUploadDir() {
  if (!existsSync(UPLOAD_DIR)) {
    await mkdir(UPLOAD_DIR, { recursive: true });
  }
}

// 解析文件名，提取资源信息
function parseFilename(filename: string): Partial<ResourceItem> {
  const nameWithoutExt = filename.replace(extname(filename), "");

  // 判断资源类型
  let type: ResourceType = ResourceType.UNKNOWN;
  if (nameWithoutExt.includes("spawner")) {
    type = ResourceType.SPAWNER;
  } else if (nameWithoutExt.includes("align")) {
    type = ResourceType.ALIGN;
  } else if (nameWithoutExt.includes("simple_opt")) {
    type = ResourceType.SIMPLE_OPT;
  }

  // 提取等级
  const levelMatch = nameWithoutExt.match(/_(\d+)(?=_|$)/);
  const level = levelMatch ? parseInt(levelMatch[1], 10) : 0;

  // 提取基础名称（去除前缀和后缀）
  const baseName = nameWithoutExt
    .replace(/^IT_/, "")
    .replace(/^spawner_/, "")
    .replace(/^align_/, "")
    .replace(/^simple_opt_/, "")
    .replace(/_00$/, "")
    .replace(/_\d+$/, "");

  return {
    id: filename,
    filename,
    displayName: nameWithoutExt,
    level,
    type,
    chainId: baseName,
  };
}

// 将资源按链条分组
function groupByChains(items: ResourceItem[]): SynthesisChain[] {
  const chainMap = new Map<string, ResourceItem[]>();

  // 按baseName分组
  items.forEach((item) => {
    if (!item.chainId) return;

    if (!chainMap.has(item.chainId)) {
      chainMap.set(item.chainId, []);
    }
    chainMap.get(item.chainId)!.push(item);
  });

  // 转换为SynthesisChain
  return Array.from(chainMap.entries()).map(([baseName, chainItems]) => {
    const sortedItems = chainItems.sort((a, b) => a.level - b.level);
    const firstItem = sortedItems[0];
    const maxLevel = Math.max(...sortedItems.map((item) => item.level));

    return {
      id: `chain-${baseName}`,
      name: baseName,
      type: firstItem.type,
      maxLevel,
      baseName,
      items: sortedItems,
    };
  });
}

// POST: 上传Wiki长图
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File;
    const type = formData.get("type") as string; // 'wiki' 或 'local'

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    await ensureUploadDir();

    // 保存文件
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    // 根据类型创建不同的子目录
    const subdir = type === "wiki" ? "wiki" : "local";
    const dirPath = join(UPLOAD_DIR, subdir);
    if (!existsSync(dirPath)) {
      await mkdir(dirPath, { recursive: true });
    }

    // 处理文件夹路径（如果file.name包含子路径）
    const relativePath = file.name;
    const filepath = join(dirPath, relativePath);

    // 创建子目录（如果需要）
    const fileDir = dirname(filepath);
    if (!existsSync(fileDir) && fileDir !== dirPath) {
      await mkdir(fileDir, { recursive: true });
    }

    await writeFile(filepath, buffer);

    // 如果是本地资源文件夹（支持多文件）
    if (type === "local" && file.name.endsWith(".zip")) {
      // TODO: 处理ZIP文件解压
      return NextResponse.json({
        success: true,
        message: "ZIP file uploaded, extraction not implemented yet",
      });
    }

    return NextResponse.json({
      success: true,
      message: "File uploaded successfully",
      filename: file.name,
      type,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Upload failed";
    console.error("Upload error:", error);
    return NextResponse.json(
      { error: message },
      { status: 500 },
    );
  }
}

// GET: 获取已上传的资源列表
export async function GET() {
  try {
    await ensureUploadDir();

    const localDir = join(UPLOAD_DIR, "local");

    if (!existsSync(localDir)) {
      return NextResponse.json({
        success: true,
        chains: [],
      });
    }

    const items: ResourceItem[] = [];

    // 递归读取目录中的所有图片文件
    async function readDirectory(dir: string, relativePath: string = "") {
      const entries = await readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        const entryRelativePath = join(relativePath, entry.name);

        if (entry.isDirectory()) {
          // 递归读取子目录
          await readDirectory(fullPath, entryRelativePath);
        } else if (entry.isFile()) {
          // 处理文件
          const ext = extname(entry.name).toLowerCase();
          if (ext === ".png" || ext === ".jpg" || ext === ".jpeg") {
            const parsed = parseFilename(entry.name);
            items.push({
              id: parsed.id || entryRelativePath,
              filename: entry.name, // 只保留文件名
              displayName: parsed.displayName,
              level: parsed.level || 0,
              type: parsed.type || ResourceType.UNKNOWN,
              imageUrl: `/api/uploads/local/${entryRelativePath}`,
              chainId: parsed.chainId,
            });
          }
        }
      }
    }

    await readDirectory(localDir);

    // 按链条分组
    const chains = groupByChains(items);

    return NextResponse.json({
      success: true,
      fileCount: items.length,
      chains,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to get resources";
    console.error("Get resources error:", error);
    return NextResponse.json(
      { error: message },
      { status: 500 },
    );
  }
}
