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

export interface OcrAttemptDetail {
  provider: "ocr.space" | "llm";
  variantIndex: number;
  raw: string;
  lines: string[];
  normalized: string;
  ok: boolean;
  error?: string;
}

export interface OcrPanelDetail {
  index: number;
  greenBox?: Coordinate;
  finalTitle: string;
  attempts: OcrAttemptDetail[];
}

interface OcrSpaceParsedResult {
  ParsedText?: string;
}

interface OcrSpaceResponse {
  ParsedResults?: OcrSpaceParsedResult[];
  IsErroredOnProcessing?: boolean;
  ErrorMessage?: string | string[];
}

const OCR_SPACE_API_URL = "https://api.ocr.space/parse/image";

function getOcrSpaceApiKey(): string {
  return process.env.OCR_SPACE_API_KEY || "helloworld";
}

function getOcrSpaceLanguage(): string {
  // 标题识别默认使用英文，必要时可通过环境变量覆盖。
  return process.env.OCR_SPACE_LANGUAGE || "eng";
}

function getOcrSpaceTimeoutMs(): number {
  const timeoutRaw = process.env.OCR_SPACE_TIMEOUT_MS;
  const timeout = timeoutRaw ? Number(timeoutRaw) : NaN;
  return Number.isFinite(timeout) && timeout > 0 ? timeout : 15000;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function buildEnhancedTitleBuffers(
  greenBoxBuffer: Buffer,
): Promise<Buffer[]> {
  const metadata = await sharp(greenBoxBuffer).metadata();
  const width = metadata.width || 0;
  const height = metadata.height || 0;

  // Baseline image first.
  const variants: Buffer[] = [greenBoxBuffer];

  // 标题条通常“宽而矮”，先垂直方向放大，避免小字识别丢失。
  const upscaleFactor =
    height > 0 && height < 120 ? Math.min(3, 160 / height) : 1;
  const targetWidth = width > 0 ? Math.round(width * upscaleFactor) : width;

  const enhanced = await sharp(greenBoxBuffer)
    .resize(targetWidth > 0 ? targetWidth : null, null, {
      kernel: "lanczos3",
      withoutEnlargement: false,
    })
    .grayscale()
    .normalize()
    .sharpen(1.2)
    .png()
    .toBuffer();

  variants.push(enhanced);
  return variants;
}

async function recognizeTitleWithOcrSpace(
  imageBuffer: Buffer,
  variantIndex: number,
  panelIndex?: number,
): Promise<OcrAttemptDetail> {
  const apikey = getOcrSpaceApiKey();
  if (!apikey) {
    return {
      provider: "ocr.space",
      variantIndex,
      raw: "",
      lines: [],
      normalized: "",
      ok: false,
      error: "missing_api_key",
    };
  }

  const form = new FormData();
  form.append("apikey", apikey);
  form.append("language", getOcrSpaceLanguage());
  form.append("isOverlayRequired", "false");
  form.append("detectOrientation", "true");
  form.append("scale", "true");
  form.append("OCREngine", "2");
  form.append(
    "file",
    new Blob([Uint8Array.from(imageBuffer)], { type: "image/png" }),
    "panel-title.png",
  );

  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(),
    getOcrSpaceTimeoutMs(),
  );

  try {
    const response = await fetch(OCR_SPACE_API_URL, {
      method: "POST",
      body: form,
      signal: controller.signal,
    });

    if (!response.ok) {
      console.warn(
        `[OCR][ocr.space] panel#${(panelIndex ?? -1) + 1} http=${response.status}`,
      );
      return {
        provider: "ocr.space",
        variantIndex,
        raw: "",
        lines: [],
        normalized: "",
        ok: false,
        error: `http_${response.status}`,
      };
    }

    const payload = (await response.json()) as OcrSpaceResponse;
    if (payload.IsErroredOnProcessing) {
      const message = Array.isArray(payload.ErrorMessage)
        ? payload.ErrorMessage.join("; ")
        : payload.ErrorMessage || "unknown_error";
      console.warn(
        `[OCR][ocr.space] panel#${(panelIndex ?? -1) + 1} error=${message}`,
      );
      return {
        provider: "ocr.space",
        variantIndex,
        raw: "",
        lines: [],
        normalized: "",
        ok: false,
        error: message,
      };
    }

    const parsedTexts = (payload.ParsedResults || [])
      .map((item) => (item.ParsedText || "").trim())
      .filter((text) => text.length > 0);
    const raw = parsedTexts.join("\n");
    const lines = raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    const normalized = normalizePanelTitleCandidate(raw);

    console.log(
      `[OCR][ocr.space] panel#${(panelIndex ?? -1) + 1} raw=${JSON.stringify(raw)} normalized=${JSON.stringify(normalized)}`,
    );
    console.log(
      `[OCR][ocr.space] panel#${(panelIndex ?? -1) + 1} lines=${JSON.stringify(lines)}`,
    );
    return {
      provider: "ocr.space",
      variantIndex,
      raw,
      lines,
      normalized,
      ok: !!normalized,
      error: normalized ? undefined : "empty_after_normalize",
    };
  } catch (error) {
    console.warn(
      `[OCR][ocr.space] panel#${(panelIndex ?? -1) + 1} failed: ${getErrorMessage(error)}`,
    );
    return {
      provider: "ocr.space",
      variantIndex,
      raw: "",
      lines: [],
      normalized: "",
      ok: false,
      error: getErrorMessage(error),
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

async function recognizeTitleWithLlmVision(
  imageBuffer: Buffer,
  variantIndex: number,
  panelIndex?: number,
): Promise<OcrAttemptDetail> {
  try {
    const config = new Config();
    const client = new LLMClient(config);

    const dataUri = `data:image/png;base64,${imageBuffer.toString("base64")}`;
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
    const lines = raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    const normalized = normalizePanelTitleCandidate(raw);
    console.log(
      `[OCR][llm] panel#${(panelIndex ?? -1) + 1} raw=${JSON.stringify(raw)} normalized=${JSON.stringify(normalized)}`,
    );
    return {
      provider: "llm",
      variantIndex,
      raw,
      lines,
      normalized,
      ok: !!normalized,
      error: normalized ? undefined : "empty_after_normalize",
    };
  } catch (error) {
    console.warn(
      `[OCR][llm] panel#${(panelIndex ?? -1) + 1} failed: ${getErrorMessage(error)}`,
    );
    return {
      provider: "llm",
      variantIndex,
      raw: "",
      lines: [],
      normalized: "",
      ok: false,
      error: getErrorMessage(error),
    };
  }
}

async function recognizePanelTitleFromGreenBox(
  imageBuffer: Buffer,
  panel: OcrPanelInput,
): Promise<string> {
  const detailed = await recognizePanelTitleFromGreenBoxDetailed(
    imageBuffer,
    panel,
  );
  return detailed.finalTitle;
}

async function recognizePanelTitleFromGreenBoxDetailed(
  imageBuffer: Buffer,
  panel: OcrPanelInput,
): Promise<OcrPanelDetail> {
  const greenBox = panel.greenBox;
  const panelIndex = panel.index ?? -1;
  if (!greenBox) {
    return {
      index: panelIndex,
      greenBox,
      finalTitle: "",
      attempts: [
        {
          provider: "ocr.space",
          variantIndex: -1,
          raw: "",
          lines: [],
          normalized: "",
          ok: false,
          error: "missing_greenbox",
        },
      ],
    };
  }

  const attempts: OcrAttemptDetail[] = [];

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

    const metadata = await sharp(greenBoxBuffer).metadata();
    console.log(
      `[OCR] panel#${panelIndex + 1} greenBox=${metadata.width || 0}x${metadata.height || 0}`,
    );

    const variants = await buildEnhancedTitleBuffers(greenBoxBuffer);

    // 主路：OCR.space（原图 -> 增强图）；兜底：LLM视觉OCR（增强图）。
    for (const [variantIndex, variantBuffer] of variants.entries()) {
      const ocrSpaceAttempt = await recognizeTitleWithOcrSpace(
        variantBuffer,
        variantIndex,
        panel.index,
      );
      attempts.push(ocrSpaceAttempt);
      if (ocrSpaceAttempt.ok) {
        console.log(
          `[OCR] panel#${panelIndex + 1} resolved by ocr.space variant=${variantIndex}`,
        );
        return {
          index: panelIndex,
          greenBox,
          finalTitle: ocrSpaceAttempt.normalized,
          attempts,
        };
      }
    }

    const llmAttempt = await recognizeTitleWithLlmVision(
      variants[variants.length - 1],
      variants.length - 1,
      panel.index,
    );
    attempts.push(llmAttempt);
    if (llmAttempt.ok) {
      console.log(`[OCR] panel#${panelIndex + 1} resolved by llm fallback`);
    }
    return {
      index: panelIndex,
      greenBox,
      finalTitle: llmAttempt.normalized,
      attempts,
    };
  } catch (error) {
    console.warn(
      `[OCR] panel#${panelIndex + 1} failed: ${getErrorMessage(error)}`,
    );
    attempts.push({
      provider: "ocr.space",
      variantIndex: -1,
      raw: "",
      lines: [],
      normalized: "",
      ok: false,
      error: getErrorMessage(error),
    });
    return {
      index: panelIndex,
      greenBox,
      finalTitle: "",
      attempts,
    };
  }
}

export async function recognizePanelTitlesWithDetailsFromPanels(
  imageBuffer: Buffer,
  panels: OcrPanelInput[],
): Promise<{ titles: string[]; details: OcrPanelDetail[] }> {
  const titles: string[] = [];
  const details: OcrPanelDetail[] = [];

  for (const panel of panels) {
    if (!panel.greenBox) {
      console.log(
        `[OCR] panel#${(panel.index ?? -1) + 1} skipped: missing greenBox`,
      );
      titles.push("");
      details.push({
        index: panel.index ?? -1,
        greenBox: panel.greenBox,
        finalTitle: "",
        attempts: [
          {
            provider: "ocr.space",
            variantIndex: -1,
            raw: "",
            lines: [],
            normalized: "",
            ok: false,
            error: "missing_greenbox",
          },
        ],
      });
      continue;
    }

    const detail = await recognizePanelTitleFromGreenBoxDetailed(
      imageBuffer,
      panel,
    );
    titles.push(detail.finalTitle || "");
    details.push(detail);

    console.log(
      `[OCR] panel#${(panel.index ?? -1) + 1} final=${JSON.stringify(detail.finalTitle || "")}`,
    );
  }

  return { titles, details };
}

export async function recognizePanelTitlesFromPanels(
  imageBuffer: Buffer,
  panels: OcrPanelInput[],
): Promise<string[]> {
  const result = await recognizePanelTitlesWithDetailsFromPanels(
    imageBuffer,
    panels,
  );
  return result.titles;
}
