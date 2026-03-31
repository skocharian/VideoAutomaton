export interface RichTextPayload {
  text: string;
  width: number;
  height: number;
  align?: "left" | "center";
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: number | string;
  lineHeight?: number | string;
  color?: string;
  shadowColor?: string;
  shadowBlur?: number | string;
  shadowY?: number | string;
}

type RichTextSegment = {
  text: string;
  bold: boolean;
};

const HTML_BOLD_PATTERN = /<\s*\/?\s*(?:strong|b)\s*>/i;
const MARKDOWN_BOLD_PATTERN = /(\*\*|__)/;

export function hasRichTextMarkup(text: string | undefined): boolean {
  if (!text) return false;
  return HTML_BOLD_PATTERN.test(text) || MARKDOWN_BOLD_PATTERN.test(text);
}

export function stripRichTextMarkup(text: string | undefined): string {
  if (!text) return "";

  return tokenizeRichText(text)
    .map((segment) => segment.text)
    .join("");
}

export function renderRichTextHtml(text: string | undefined): string {
  if (!text) return "";

  return tokenizeRichText(text)
    .map((segment) => {
      const escaped = escapeHtml(segment.text);
      return segment.bold ? `<strong>${escaped}</strong>` : escaped;
    })
    .join("");
}

export function encodeRichTextPayload(payload: RichTextPayload): string {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function decodeRichTextPayload(encoded: string): RichTextPayload {
  const normalized = encoded.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes)) as RichTextPayload;
}

export function buildRichTextSvg(payload: RichTextPayload): string {
  const width = Math.max(1, Math.round(payload.width));
  const height = Math.max(1, Math.round(payload.height));
  const align = payload.align ?? "left";
  const fontFamily = payload.fontFamily ?? "Aileron, Arial, sans-serif";
  const fontSize = payload.fontSize ?? 28;
  const fontWeight = payload.fontWeight ?? 600;
  const lineHeight =
    typeof payload.lineHeight === "number"
      ? String(payload.lineHeight)
      : payload.lineHeight ?? "100%";
  const color = payload.color ?? "#ffffff";
  const textShadow = buildTextShadow(payload, width, height);
  const html = renderRichTextHtml(payload.text);

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    '<foreignObject width="100%" height="100%">',
    `<div xmlns="http://www.w3.org/1999/xhtml" style="width:${width}px;height:${height}px;display:flex;align-items:flex-start;justify-content:${
      align === "center" ? "center" : "flex-start"
    };overflow:hidden;">`,
    `<div style="width:100%;font-family:${escapeHtmlAttribute(
      fontFamily
    )};font-size:${fontSize}px;font-weight:${fontWeight};line-height:${escapeHtmlAttribute(
      lineHeight
    )};color:${color};text-align:${align};white-space:pre-wrap;word-break:break-word;${
      textShadow ? `text-shadow:${textShadow};` : ""
    }">${html}</div>`,
    "</div>",
    "</foreignObject>",
    "</svg>",
  ].join("");
}

function tokenizeRichText(text: string): RichTextSegment[] {
  const normalized = text
    .replace(/<\s*strong\s*>/gi, "**")
    .replace(/<\s*\/\s*strong\s*>/gi, "**")
    .replace(/<\s*b\s*>/gi, "**")
    .replace(/<\s*\/\s*b\s*>/gi, "**");

  const segments: RichTextSegment[] = [];
  let index = 0;
  let isBold = false;
  let buffer = "";

  while (index < normalized.length) {
    const marker = normalized.startsWith("**", index)
      ? "**"
      : normalized.startsWith("__", index)
        ? "__"
        : null;

    if (marker) {
      if (buffer) {
        segments.push({ text: buffer, bold: isBold });
        buffer = "";
      }
      isBold = !isBold;
      index += marker.length;
      continue;
    }

    buffer += normalized[index];
    index += 1;
  }

  if (buffer) {
    segments.push({ text: buffer, bold: isBold });
  }

  return mergeAdjacentSegments(segments);
}

function mergeAdjacentSegments(segments: RichTextSegment[]): RichTextSegment[] {
  const merged: RichTextSegment[] = [];

  for (const segment of segments) {
    const last = merged.at(-1);
    if (last && last.bold === segment.bold) {
      last.text += segment.text;
      continue;
    }

    merged.push({ ...segment });
  }

  return merged;
}

function buildTextShadow(
  payload: RichTextPayload,
  width: number,
  height: number
): string {
  if (!payload.shadowColor) return "";

  const offsetY = toPixels(payload.shadowY ?? 0, width, height);
  const blur = toPixels(payload.shadowBlur ?? 0, width, height);
  return `0px ${offsetY}px ${blur}px ${payload.shadowColor}`;
}

function toPixels(
  value: string | number,
  width: number,
  height: number
): number {
  if (typeof value === "number") return value;
  const trimmed = value.trim();

  if (trimmed.endsWith("px")) {
    return Number.parseFloat(trimmed);
  }

  if (trimmed.endsWith("vmin")) {
    return (Math.min(width, height) * Number.parseFloat(trimmed)) / 100;
  }

  if (trimmed.endsWith("%")) {
    return (height * Number.parseFloat(trimmed)) / 100;
  }

  const parsed = Number.parseFloat(trimmed);
  return Number.isFinite(parsed) ? parsed : 0;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeHtmlAttribute(value: string): string {
  return escapeHtml(value).replace(/"/g, "&quot;");
}
