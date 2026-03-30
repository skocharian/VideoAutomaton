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

  // V1: "Headline" / "Subheadline"  or  V1: Headline | Subheadline
  const variantPattern =
    /V(\d+)[:\s\-–]+[""]?([^""\/\|\n]+)[""]?\s*[\/\|]\s*[""]?([^""\n]+?)[""]?\s*$/gim;

  let match;
  while ((match = variantPattern.exec(brief)) !== null) {
    variants.push({
      id: `V${match[1]}`,
      headline: match[2].trim(),
      subheadline: match[3].trim(),
    });
  }

  // Fallback: simpler two-line format
  if (variants.length === 0) {
    const simplePattern =
      /V(\d+)[:\s\-–]+(.+?)(?:\n\s+(.+?))?(?=\nV\d|\n\n|$)/gis;
    while ((match = simplePattern.exec(brief)) !== null) {
      variants.push({
        id: `V${match[1]}`,
        headline: match[2].trim(),
        subheadline: match[3]?.trim() ?? "",
      });
    }
  }

  return variants;
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

  const headerMatch = block.match(/header[:\s]+(.+?)(?=\n|$)/i);
  const bodyMatch = block.match(/body[:\s]+(.+?)(?=\n(?:header|disclaimer)|$)/is);
  const disclaimerMatch = block.match(/disclaimer[:\s]+(.+?)(?=\n(?:header|body)|$)/is);

  if (headerMatch || bodyMatch) {
    if (headerMatch) screen.header = headerMatch[1].trim();
    if (bodyMatch) screen.body = bodyMatch[1].trim();
    if (disclaimerMatch) screen.disclaimer = disclaimerMatch[1].trim();
  } else {
    // No labels — check if there are two lines (first = header, rest = body)
    const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length >= 2) {
      screen.header = lines[0];
      screen.body = lines.slice(1).join("\n");
    } else {
      screen.body = block;
    }
  }

  return screen;
}

export function computeVideoCount(parsed: ParsedBrief): number {
  const variantCount = Math.max(parsed.variants.length, 1);
  const bgCount = Math.max(parsed.backgrounds.length, 1);
  const sizeCount = parsed.sizes.length;
  return variantCount * bgCount * sizeCount;
}
