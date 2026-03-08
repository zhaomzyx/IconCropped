import { DetectedPanel } from "@/features/crops/types";

interface OcrPanelTitlesResponse {
  success?: boolean;
  titles?: string[];
}

interface OcrPanelBatch {
  index: number;
  title?: string;
  greenBox?: DetectedPanel["greenBox"];
  blueBox?: DetectedPanel["blueBox"];
}

export async function requestOcrPanelTitles(
  imageUrl: string,
  panels: OcrPanelBatch[],
  signal?: AbortSignal,
): Promise<OcrPanelTitlesResponse | null> {
  const response = await fetch("/api/ocr-panel-titles", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      imageUrl,
      includeDetails: true,
      panels,
    }),
    signal,
  });

  if (!response.ok) {
    return null;
  }

  return (await response.json()) as OcrPanelTitlesResponse;
}
