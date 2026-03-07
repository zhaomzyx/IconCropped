export interface PanelTitleSource {
  ocrTitle?: string;
  title?: string;
  panelIndex?: number;
}

const cleanRawTitle = (text: string) =>
  text
    .replace(/```(?:text)?\s*/gi, "")
    .replace(/```/g, "")
    .replace(/["'`]/g, "")
    .replace(/[\n\r\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export const isPlaceholderPanelTitle = (text?: string): boolean => {
  const value = (text || "").trim();
  if (!value) return true;
  if (/^panel_?\d+$/i.test(value)) return true;
  if (/^unknown(?:_?\d+)?$/i.test(value)) return true;
  if (/^未识别$/.test(value)) return true;
  if (/^n\/?a$/i.test(value)) return true;
  return false;
};

export const normalizePanelTitleCandidate = (text?: string): string => {
  const cleaned = cleanRawTitle(text || "");
  if (!cleaned || isPlaceholderPanelTitle(cleaned)) return "";

  // Keep only common title characters to reduce noisy OCR/LLM outputs.
  const strict = cleaned.replace(/[^A-Za-z0-9 \-:&/]/g, "").trim();
  if (strict.length < 2 || isPlaceholderPanelTitle(strict)) return "";
  return strict;
};

export const sanitizePanelTitleForFilename = (
  title: string,
  fallback = "Panel",
): string => {
  const sanitized = title
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/[._\s]+$/g, "")
    .replace(/^[_\s.]+/g, "")
    .trim();

  return sanitized || fallback;
};

export const resolvePanelTitle = ({
  ocrTitle,
  title,
  panelIndex,
}: PanelTitleSource): string => {
  const fromOcr = normalizePanelTitleCandidate(ocrTitle);
  if (fromOcr) return fromOcr;

  const fromTitle = normalizePanelTitleCandidate(title);
  if (fromTitle) return fromTitle;

  if (typeof panelIndex === "number" && panelIndex >= 0) {
    return `Panel_${panelIndex + 1}`;
  }
  return "Panel";
};
