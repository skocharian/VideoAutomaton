import type { ParsedBrief, ParseBriefRequest, Variant, ScreenText } from "./types";

/**
 * Parse a raw marketing brief into structured data.
 * Extracts campaign ID, variants (V1-V4 headlines/subheadlines),
 * and per-screen text blocks (each screen can have header + body).
 * Number of screens is dynamic — determined by what's in the brief.
 */
export function parseBrief(req: ParseBriefRequest): ParsedBrief {
  const { brief, backgrounds, sizes, audio, badge, novelty } = req;

  const campaignId = extractCampaignId(brief);
  const variants = extractVariants(brief);
  const screens = extractScreens(brief);

  return {
    campaign_id: campaignId,
    variants,
    screens,
    backgrounds,
    sizes: sizes.length > 0 ? sizes : ["9:16", "4:5"],
    audio,
    badge,
    ...(novelty && novelty.length > 0 ? { novelty } : {}),
  };
}

function extractCampaignId(brief: string): string {
  const patterns = [
    /campaign[\s_-]*id\s*[:=]\s*([A-Z0-9]{3,})/i,
    /\b([A-Z]{1,4}\d{3,6})\b/,
  ];

  for (const pattern of patterns) {
    const match = brief.match(pattern);
    if (match) return match[1];
  }

  return `CAMP${Date.now().toString(36).toUpperCase().slice(-6)}`;
}

function extractVariants(brief: string): Variant[] {
  const variants: Variant[] = [];
  const normalizedBrief = brief.replace(/\r\n/g, "\n");
  const variantBlockPattern =
    /(?:^|\n)\s*V(\d+)\s*[:\-–]\s*([\s\S]*?)(?=(?:\n\s*V\d+\s*[:\-–])|(?:\n\s*(?:Screen|S)\s*\d+\s*[:\-–])|$)/gi;

  let match;
  while ((match = variantBlockPattern.exec(normalizedBrief)) !== null) {
    const block = match[2].trim();
    if (!block) continue;

    const lines = block
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    if (lines.length === 0) continue;

    const inlineSplit = lines[0].match(/^(.*?)\s*[\/|]\s*(.+)$/);
    const headline = stripEnclosingQuotes(
      inlineSplit ? inlineSplit[1] : lines[0]
    );
    const subheadline = stripEnclosingQuotes(
      inlineSplit ? inlineSplit[2] : lines.slice(1).join("\n")
    );

    variants.push({
      id: `V${match[1]}`,
      headline,
      subheadline,
    });
  }

  return variants;
}

function stripEnclosingQuotes(value: string): string {
  return value.replace(/^[\"'“”]+|[\"'“”]+$/g, "").trim();
}

/**
 * Extract screens dynamically from the brief.
 * Supports formats like:
 *   Screen 1:
 *   Header: Some headline
 *   Body: Some body text
 *
 *   Screen 2: Just a single line of text (treated as body)
 *
 *   Screen 3:
 *   Header: ...
 *   Body: ...
 *   Disclaimer: ...
 *
 * Also supports "S1:", "Screen1:", and numbered formats.
 * The number of screens is entirely determined by the brief content.
 */
function extractScreens(brief: string): Record<string, ScreenText> {
  const screens: Record<string, ScreenText> = {};

  // Match "Screen N:" blocks, capturing everything until the next "Screen N:" or end
  const screenPattern =
    /(?:Screen|S)\s*(\d+)[:\s\-–]+\s*([\s\S]*?)(?=(?:Screen|S)\s*\d+[:\s\-–]|$)/gi;

  let match;
  while ((match = screenPattern.exec(brief)) !== null) {
    const num = match[1];
    const block = match[2].trim();

    if (!block) continue;
    if (num === "1" && /(?:^|\n)\s*V\d+\s*[:\-–]/i.test(block)) continue;

    const screen = parseScreenBlock(block);
    screens[num] = screen;
  }

  return screens;
}

/**
 * Parse a single screen's text block into header/body/disclaimer.
 * If the block contains "Header:" / "Body:" labels, use those.
 * Otherwise, treat the whole block as body text.
 */
function parseScreenBlock(block: string): ScreenText {
  const screen: ScreenText = {};
  const lines = block
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  // Parse explicit labels only when they appear at the start of a line.
  const labeled: ScreenText = {};
  let currentField: keyof ScreenText | null = null;
  for (const line of lines) {
    const labelMatch = line.match(/^(header|body|disclaimer)\s*:\s*(.*)$/i);
    if (labelMatch) {
      currentField = labelMatch[1].toLowerCase() as keyof ScreenText;
      labeled[currentField] = labelMatch[2].trim();
      continue;
    }

    if (currentField) {
      labeled[currentField] = [labeled[currentField], line]
        .filter(Boolean)
        .join("\n");
    }
  }

  if (labeled.header || labeled.body || labeled.disclaimer) {
    if (labeled.header) screen.header = labeled.header.trim();
    if (labeled.body) screen.body = labeled.body.trim();
    if (labeled.disclaimer) screen.disclaimer = labeled.disclaimer.trim();
    return screen;
  }

  const disclaimerStart = lines.findIndex((line) => line.startsWith("*"));
  const contentLines =
    disclaimerStart >= 0 ? lines.slice(0, disclaimerStart) : lines;
  const disclaimerLines =
    disclaimerStart >= 0 ? lines.slice(disclaimerStart) : [];

  if (contentLines.length >= 2) {
    screen.header = contentLines[0];
    screen.body = contentLines.slice(1).join("\n");
  } else if (contentLines.length === 1) {
    screen.body = contentLines[0];
  }

  if (disclaimerLines.length > 0) {
    screen.disclaimer = disclaimerLines.join("\n");
  }

  return screen;
}

export function computeVideoCount(parsed: ParsedBrief): number {
  const variantCount = Math.max(parsed.variants.length, 1);
  const bgCount = Math.max(parsed.backgrounds.length, 1);
  const sizeCount = parsed.sizes.length;
  return variantCount * bgCount * sizeCount;
}
