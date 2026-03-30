import type { ParsedBrief, ParseBriefRequest, Variant } from "./types";

/**
 * Parse a raw marketing brief into structured data.
 * Extracts campaign ID, variants (V1-V4 headlines/subheadlines),
 * and per-screen text blocks.
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
  // Match patterns like "AX0320", "Campaign ID: AX0320", etc.
  const patterns = [
    /campaign[\s_-]*id\s*[:=]\s*([A-Z0-9]{3,})/i,
    /\b([A-Z]{1,4}\d{3,6})\b/,
  ];

  for (const pattern of patterns) {
    const match = brief.match(pattern);
    if (match) return match[1];
  }

  // Fallback: generate from timestamp
  return `CAMP${Date.now().toString(36).toUpperCase().slice(-6)}`;
}

function extractVariants(brief: string): Variant[] {
  const variants: Variant[] = [];

  // Match patterns like:
  // V1: "Headline text" / "Subheadline text"
  // V1: Headline text | Subheadline text
  // V1 - Headline text / Subheadline text
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

  // If the pattern above didn't match, try a simpler two-line format:
  // V1: Headline text
  //     Subheadline text
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

function extractScreens(brief: string): Record<string, string> {
  const screens: Record<string, string> = {};

  // Match "Screen X:" or "Screen X -" followed by text until next screen or double newline
  const screenPattern =
    /Screen\s*(\d+)[:\s\-–]+\s*([\s\S]*?)(?=Screen\s*\d|$)/gi;

  let match;
  while ((match = screenPattern.exec(brief)) !== null) {
    const screenNum = match[1];
    const text = match[2]
      .trim()
      .replace(/\n{2,}/g, "\n")
      .trim();
    if (text) {
      screens[`screen${screenNum}`] = text;
    }
  }

  return screens;
}

export function computeVideoCount(parsed: ParsedBrief): number {
  const variantCount = Math.max(parsed.variants.length, 1);
  const bgCount = Math.max(parsed.backgrounds.length, 1);
  const sizeCount = parsed.sizes.length;
  return variantCount * bgCount * sizeCount;
}
