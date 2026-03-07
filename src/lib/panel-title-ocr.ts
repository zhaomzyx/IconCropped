import sharp from "sharp";
import { Config, LLMClient } from "coze-coding-dev-sdk";
import { normalizePanelTitleCandidate } from "@/lib/panel-title";

export interface Coordinate {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface OcrPanelInput {
  index?: number;
  greenBox?: Coordinate;
}

async function recognizePanelTitleFromGreenBox(
  imageBuffer: Buffer,
  panel: OcrPanelInput,
): Promise<string> {
  const greenBox = panel.greenBox;
  if (!greenBox) return "";

  try {
    const greenBoxBuffer = await sharp(imageBuffer)
      .extract({
        left: Math.round(greenBox.x),
        top: Math.round(greenBox.y),
        width: Math.round(greenBox.width),
        height: Math.round(greenBox.height),
      })
      .png()
      .toBuffer();

    let processBuffer = greenBoxBuffer;
    const metadata = await sharp(greenBoxBuffer).metadata();
    const maxWidth = 500;
    if (metadata.width && metadata.width > maxWidth) {
      processBuffer = await sharp(greenBoxBuffer)
        .resize(maxWidth, null)
        .toBuffer();
    }

    const config = new Config();
    const client = new LLMClient(config);

    const dataUri = `data:image/png;base64,${processBuffer.toString("base64")}`;
    const response = await client.invoke(
      [
        {
          role: "user" as const,
          content: [
            {
              type: "text" as const,
              text: "请读取图片中的英文标题文本，直接返回纯文本，不要任何解释。",
            },
            {
              type: "image_url" as const,
              image_url: {
                url: dataUri,
                detail: "high" as const,
              },
            },
          ],
        },
      ],
      {
        model: "doubao-seed-1-6-vision-250815",
        temperature: 0.1,
      },
    );

    const raw = response.content || "";
    const normalized = normalizePanelTitleCandidate(raw);
    console.log(
      `[OCR] panel#${(panel.index ?? -1) + 1} raw=${JSON.stringify(raw)} normalized=${JSON.stringify(normalized)}`,
    );
    return normalized;
  } catch {
    console.warn(`[OCR] panel#${(panel.index ?? -1) + 1} failed`);
    return "";
  }
}

export async function recognizePanelTitlesFromPanels(
  imageBuffer: Buffer,
  panels: OcrPanelInput[],
): Promise<string[]> {
  const titles: string[] = [];

  for (const panel of panels) {
    if (!panel.greenBox) {
      console.log(
        `[OCR] panel#${(panel.index ?? -1) + 1} skipped: missing greenBox`,
      );
      titles.push("");
      continue;
    }

    const title = await recognizePanelTitleFromGreenBox(imageBuffer, panel);
    titles.push(title || "");

    console.log(
      `[OCR] panel#${(panel.index ?? -1) + 1} final=${JSON.stringify(titles[titles.length - 1])}`,
    );
  }

  return titles;
}
