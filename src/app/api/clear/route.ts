import { NextRequest, NextResponse } from "next/server";
import { rm } from "fs/promises";
import { existsSync } from "fs";

const UPLOAD_DIR = "/tmp/uploads";
const CROP_DIR = "/tmp/crops";

// 清空所有上传和切割的文件
export async function POST(request: NextRequest) {
  try {
    const { type } = await request.json();

    const errors: string[] = [];
    let clearedFiles = 0;

    // 清空上传目录
    if (!type || type === "uploads") {
      try {
        if (existsSync(UPLOAD_DIR)) {
          await rm(UPLOAD_DIR, { recursive: true, force: true });
          console.log("Cleared uploads directory");
          clearedFiles++;
        }
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        console.error("Failed to clear uploads:", error);
        errors.push(`Uploads: ${message}`);
      }
    }

    // 清空切割目录
    if (!type || type === "crops") {
      try {
        if (existsSync(CROP_DIR)) {
          await rm(CROP_DIR, { recursive: true, force: true });
          console.log("Cleared crops directory");
          clearedFiles++;
        }
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        console.error("Failed to clear crops:", error);
        errors.push(`Crops: ${message}`);
      }
    }

    return NextResponse.json({
      success: true,
      message: "Cleared successfully",
      clearedFiles,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Failed to clear data";
    console.error("Clear error:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
