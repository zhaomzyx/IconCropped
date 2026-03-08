import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fs from "fs/promises";
import { cwd } from "process";
import {
  OcrPanelInput,
  recognizePanelTitlesFromPanels,
} from "@/lib/panel-title-ocr";

async function readImageBuffer(imageUrl: string): Promise<Buffer> {
  if (imageUrl.startsWith("/WikiPic/")) {
    const publicPath = path.join(cwd(), "public", imageUrl.replace(/^\//, ""));
    return fs.readFile(publicPath);
  }

  if (
    imageUrl.startsWith("/api/uploads/") ||
    imageUrl.startsWith("/uploads/")
  ) {
    const encodedName = imageUrl.split("/").pop() || "";
    const filename = decodeURIComponent(encodedName);
    const filePath = path.join("/tmp/uploads/wiki", filename);
    return fs.readFile(filePath);
  }

  if (imageUrl.startsWith("/")) {
    const publicPath = path.join(cwd(), "public", imageUrl.replace(/^\//, ""));
    return fs.readFile(publicPath);
  }

  const response = await fetch(imageUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch image: ${response.status}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      imageUrl?: string;
      panels?: OcrPanelInput[];
    };

    if (!body.imageUrl || !Array.isArray(body.panels)) {
      return NextResponse.json(
        {
          success: false,
          error: "Missing required parameters: imageUrl, panels",
        },
        { status: 400 },
      );
    }

    const imageBuffer = await readImageBuffer(body.imageUrl);

    const titles = await recognizePanelTitlesFromPanels(imageBuffer, body.panels);

    return NextResponse.json({
      success: true,
      titles,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "OCR failed";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 },
    );
  }
}
