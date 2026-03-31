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
  emphasisColor?: string;
  shadowColor?: string;
  shadowBlur?: number | string;
  shadowY?: number | string;
}

export interface HighlightedFragment {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
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

export function hasHighlightedSegments(text: string | undefined): boolean {
  if (!text) return false;
  return tokenizeRichText(text).some((segment) => segment.bold && segment.text.trim());
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
  const fontFamily = payload.fontFamily ?? "Open Sans, Aileron, Arial, sans-serif";
  const fontSize = payload.fontSize ?? 28;
  const fontWeight = payload.fontWeight ?? 600;
  const emphasisColor = payload.emphasisColor ?? "#8ff3f6";
  const shadowFilterId = payload.shadowColor ? "shadow" : "";
  const fragments = layoutHighlightedFragments(payload);
  const textElements = fragments.map((fragment) => {
    const baselineY = Math.max(fontSize, fragment.y + fontSize * 0.82);
    return `<text x="${roundSvg(fragment.x)}" y="${roundSvg(baselineY)}" fill="${escapeXml(
      emphasisColor
    )}" font-family="${escapeXml(fontFamily)}" font-size="${roundSvg(
      fontSize
    )}" font-weight="700"${shadowFilterId ? ` filter="url(#${shadowFilterId})"` : ""} xml:space="preserve">${escapeXml(
      fragment.text
    )}</text>`;
  });

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    payload.shadowColor
      ? buildShadowDefinition(
          shadowFilterId,
          payload.shadowColor,
          payload.shadowBlur ?? 0,
          payload.shadowY ?? 0,
          width,
          height
        )
      : "",
    ...textElements,
    "</svg>",
  ].join("");
}

export function layoutHighlightedFragments(
  payload: RichTextPayload
): HighlightedFragment[] {
  const width = Math.max(1, Math.round(payload.width));
  const align = payload.align ?? "left";
  const fontSize = payload.fontSize ?? 28;
  const fontWeight = payload.fontWeight ?? 600;
  const lineHeight = resolveLineHeightPixels(payload.lineHeight ?? "100%", fontSize);
  const lines = layoutRichTextLines(payload.text, width, fontSize, fontWeight);
  const fragments: HighlightedFragment[] = [];

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    const startX = align === "center" ? Math.max(0, (width - line.width) / 2) : 0;
    let cursorX = startX;
    let activeText = "";
    let activeStartX = 0;
    let activeWidth = 0;

    for (const token of line.tokens) {
      const tokenWidth = measureTextWidth(
        token.text,
        fontSize,
        token.bold ? 700 : fontWeight
      );

      if (token.bold) {
        if (!activeText) {
          activeStartX = cursorX;
          activeWidth = 0;
          activeText = "";
        }

        activeText += token.text;
        activeWidth += tokenWidth;
      } else if (activeText) {
        const fragment = normalizeHighlightedFragment(
          activeText,
          activeStartX,
          activeWidth,
          lineIndex * lineHeight,
          lineHeight,
          fontSize
        );
        if (fragment) {
          fragments.push(fragment);
        }
        activeText = "";
        activeWidth = 0;
      }

      cursorX += tokenWidth;
    }

    if (activeText) {
      const fragment = normalizeHighlightedFragment(
        activeText,
        activeStartX,
        activeWidth,
        lineIndex * lineHeight,
        lineHeight,
        fontSize
      );
      if (fragment) {
        fragments.push(fragment);
      }
    }
  }

  return fragments;
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

type RichTextToken = {
  text: string;
  bold: boolean;
};

type RichTextLine = {
  tokens: RichTextToken[];
  width: number;
};

function layoutRichTextLines(
  text: string,
  maxWidth: number,
  fontSize: number,
  fontWeight: number | string
): RichTextLine[] {
  const lines: RichTextLine[] = [];
  let currentTokens: RichTextToken[] = [];
  let currentWidth = 0;

  for (const segment of tokenizeRichText(text)) {
    const tokens = segment.text.match(/\n|[ \t]+|[^\s\n]+/g) ?? [];

    for (const tokenText of tokens) {
      if (tokenText === "\n") {
        flushLine();
        continue;
      }

      const token: RichTextToken = { text: tokenText, bold: segment.bold };
      const isWhitespace = /^[ \t]+$/.test(token.text);
      const tokenWeight = token.bold ? 700 : fontWeight;
      let tokenWidth = measureTextWidth(token.text, fontSize, tokenWeight);

      if (!currentTokens.length && isWhitespace) {
        continue;
      }

      if (!isWhitespace && currentWidth > 0 && currentWidth + tokenWidth > maxWidth) {
        flushLine();
      }

      if (!isWhitespace && tokenWidth > maxWidth) {
        const pieces = splitTokenToFit(token, maxWidth, fontSize, tokenWeight);
        for (let index = 0; index < pieces.length; index += 1) {
          const piece = pieces[index];
          const pieceWidth = measureTextWidth(piece.text, fontSize, tokenWeight);
          if (currentWidth > 0 && currentWidth + pieceWidth > maxWidth) {
            flushLine();
          }
          currentTokens.push(piece);
          currentWidth += pieceWidth;
          if (index < pieces.length - 1) {
            flushLine();
          }
        }
        continue;
      }

      if (!currentTokens.length && isWhitespace) {
        continue;
      }

      currentTokens.push(token);
      currentWidth += tokenWidth;
    }
  }

  flushLine();

  return lines.length > 0 ? lines : [{ tokens: [], width: 0 }];

  function flushLine() {
    while (currentTokens.length && /^[ \t]+$/.test(currentTokens[currentTokens.length - 1].text)) {
      const trailing = currentTokens.pop();
      if (trailing) {
        currentWidth -= measureTextWidth(trailing.text, fontSize, trailing.bold ? 700 : fontWeight);
      }
    }

    lines.push({
      tokens: currentTokens,
      width: Math.max(0, currentWidth),
    });
    currentTokens = [];
    currentWidth = 0;
  }
}

function splitTokenToFit(
  token: RichTextToken,
  maxWidth: number,
  fontSize: number,
  fontWeight: number | string
): RichTextToken[] {
  const pieces: RichTextToken[] = [];
  let buffer = "";

  for (const char of token.text) {
    const candidate = buffer + char;
    if (buffer && measureTextWidth(candidate, fontSize, fontWeight) > maxWidth) {
      pieces.push({ text: buffer, bold: token.bold });
      buffer = char;
      continue;
    }
    buffer = candidate;
  }

  if (buffer) {
    pieces.push({ text: buffer, bold: token.bold });
  }

  return pieces;
}

function measureTextWidth(
  text: string,
  fontSize: number,
  fontWeight: number | string
): number {
  let width = 0;
  const weightMultiplier =
    Number(fontWeight) >= 700 || String(fontWeight).toLowerCase() === "bold"
      ? 1.02
      : 1;

  for (const char of text) {
    width += estimateCharacterWidth(char);
  }

  return width * fontSize * weightMultiplier;
}

function normalizeHighlightedFragment(
  text: string,
  startX: number,
  width: number,
  y: number,
  height: number,
  fontSize: number
): HighlightedFragment | null {
  const leadingWhitespace = text.match(/^[ \t]+/)?.[0] ?? "";
  const trailingWhitespace = text.match(/[ \t]+$/)?.[0] ?? "";
  const trimmedText = text.trim();

  if (!trimmedText) {
    return null;
  }

  const adjustedX = startX + measureTextWidth(leadingWhitespace, fontSize, 700);
  const adjustedWidth = Math.max(
    1,
    width -
      measureTextWidth(leadingWhitespace, fontSize, 700) -
      measureTextWidth(trailingWhitespace, fontSize, 700)
  );

  return {
    text: trimmedText,
    x: adjustedX,
    y,
    width: adjustedWidth,
    height,
  };
}

function estimateCharacterWidth(char: string): number {
  if (char === " ") return 0.33;
  if (char === "\t") return 1.32;
  if ("ilIjtfr".includes(char)) return 0.31;
  if ("mwMW@#%&".includes(char)) return 0.88;
  if ("ABCDEFGHKNOPQRSUVXYZ".includes(char)) return 0.67;
  if ("JLT".includes(char)) return 0.5;
  if ("0123456789".includes(char)) return 0.58;
  if (",.;:'`".includes(char)) return 0.22;
  if ("!?".includes(char)) return 0.3;
  if ("-–—_".includes(char)) return 0.35;
  if ("()[]{}".includes(char)) return 0.3;
  if ("\"".includes(char)) return 0.28;
  if ("/\\|".includes(char)) return 0.32;
  return 0.56;
}

function resolveLineHeightPixels(
  value: string | number,
  fontSize: number
): number {
  if (typeof value === "number") {
    return value <= 4 ? fontSize * value : value;
  }

  const trimmed = value.trim();
  if (trimmed.endsWith("%")) {
    return (fontSize * Number.parseFloat(trimmed)) / 100;
  }

  const parsed = Number.parseFloat(trimmed);
  if (!Number.isFinite(parsed)) return fontSize;
  return parsed <= 4 ? fontSize * parsed : parsed;
}

function buildShadowDefinition(
  id: string,
  color: string,
  blur: number | string,
  offsetY: number | string,
  width: number,
  height: number
): string {
  const blurPx = Math.max(0, toPixels(blur, width, height));
  const offsetYPx = toPixels(offsetY, width, height);

  return [
    "<defs>",
    `<filter id="${id}" x="-20%" y="-20%" width="140%" height="140%">`,
    `<feDropShadow dx="0" dy="${roundSvg(offsetYPx)}" stdDeviation="${roundSvg(
      blurPx / 2
    )}" flood-color="${escapeXml(color)}" flood-opacity="1"/>`,
    "</filter>",
    "</defs>",
  ].join("");
}

function roundSvg(value: number): string {
  return Number(value.toFixed(2)).toString();
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

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
