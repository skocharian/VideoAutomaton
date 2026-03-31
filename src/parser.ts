import type { ParsedBrief, ParseBriefRequest, Variant, ScreenText } from "./types";

const DEFAULT_SLIDE_DURATION = 3;

/**
 * Parse a raw marketing brief into structured data.
 * Extracts campaign ID, variants (V1-V4 headlines/subheadlines),
 * and per-screen text blocks (each screen can have header + body).
 * Number of screens is dynamic — determined by what's in the brief.
 */
export function parseBrief(req: ParseBriefRequest): ParsedBrief {
  const { brief, backgrounds, sizes, audio, accolade, badge, logo, novelty } = req;
  const normalizedBrief = normalizeStructuralHeadings(brief);

  const campaignId = extractCampaignId(brief);
  const variants = extractVariants(normalizedBrief);
  const { screens, explicitDurations } = extractScreens(normalizedBrief);
  const screenDurations = resolveScreenDurations(
    normalizedBrief,
    variants,
    screens,
    explicitDurations
  );

  return {
    campaign_id: campaignId,
    variants,
    screens,
    screenDurations,
    backgrounds,
    sizes: sizes.length > 0 ? sizes : ["9:16", "4:5"],
    audio: audio ?? "",
    accolade: accolade ?? "",
    badge: badge ?? "",
    logo: logo ?? "",
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

function normalizeStructuralHeadings(brief: string): string {
  return brief
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => normalizeStructuralHeadingLine(line))
    .join("\n");
}

function normalizeStructuralHeadingLine(line: string): string {
  const headingCore = String.raw`(?:V\d+|(?:Screen|S)\s*\d+(?:\s*\([^)]*\))?)`;
  const structuralHeadingLine = String.raw`(?:V\d+|(?:Screen|S)\s*\d+)\b[^\n]*`;
  const markdownWholeLine = new RegExp(
    String.raw`^(\s*)(\*\*|__)\s*(${structuralHeadingLine})\s*\2(\s*)$`,
    "i"
  );
  const markdownWrapped = new RegExp(
    String.raw`^(\s*)(\*\*|__)\s*(${headingCore}\s*[:\-–]?)\s*\2(\s*)(.*)$`,
    "i"
  );
  const markdownColonOutside = new RegExp(
    String.raw`^(\s*)(\*\*|__)\s*(${headingCore})\s*\2(\s*[:\-–]\s*)(.*)$`,
    "i"
  );
  const htmlWholeLine = new RegExp(
    String.raw`^(\s*)<\s*(?:strong|b)\s*>\s*(${structuralHeadingLine})\s*<\s*\/\s*(?:strong|b)\s*>(\s*)$`,
    "i"
  );
  const htmlWrapped = new RegExp(
    String.raw`^(\s*)<\s*(?:strong|b)\s*>\s*(${headingCore}\s*[:\-–]?)\s*<\s*\/\s*(?:strong|b)\s*>(\s*)(.*)$`,
    "i"
  );
  const htmlColonOutside = new RegExp(
    String.raw`^(\s*)<\s*(?:strong|b)\s*>\s*(${headingCore})\s*<\s*\/\s*(?:strong|b)\s*>(\s*[:\-–]\s*)(.*)$`,
    "i"
  );

  return line
    .replace(markdownWholeLine, "$1$3$4")
    .replace(markdownWrapped, "$1$3$4$5")
    .replace(markdownColonOutside, "$1$3$4$5")
    .replace(htmlWholeLine, "$1$2$3")
    .replace(htmlWrapped, "$1$2$3$4")
    .replace(htmlColonOutside, "$1$2$3$4");
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
function extractScreens(brief: string): {
  screens: Record<string, ScreenText>;
  explicitDurations: Record<string, number>;
} {
  const screens: Record<string, ScreenText> = {};
  const explicitDurations: Record<string, number> = {};
  const normalizedBrief = brief.replace(/\r\n/g, "\n");

  // Match "Screen N:" blocks, capturing everything until the next "Screen N:" or end.
  const screenPattern =
    /(?:^|\n)\s*(?:Screen|S)\s*(\d+)(?:\s*\(([^)]+)\))?\s*[:\s\-–]+\s*([\s\S]*?)(?=\n\s*(?:Screen|S)\s*\d+(?:\s*\([^)]*\))?\s*[:\s\-–]+|$)/gi;

  let match;
  while ((match = screenPattern.exec(normalizedBrief)) !== null) {
    const num = match[1];
    const headingDuration = parseDurationText(match[2]);
    const block = match[3].trim();

    if (!block) continue;
    const parsedBlock = parseScreenBlock(block);
    if (headingDuration !== undefined) {
      explicitDurations[num] = headingDuration;
    }
    if (parsedBlock.duration !== undefined) {
      explicitDurations[num] = parsedBlock.duration;
    }
    if (num === "1" && /(?:^|\n)\s*V\d+\s*[:\-–]/i.test(block)) continue;

    screens[num] = parsedBlock.screen;
  }

  return { screens, explicitDurations };
}

/**
 * Parse a single screen's text block into header/body/disclaimer.
 * If the block contains "Header:" / "Body:" labels, use those.
 * Otherwise, treat the whole block as body text.
 */
function parseScreenBlock(block: string): {
  screen: ScreenText;
  duration?: number;
} {
  const screen: ScreenText = {};
  let duration: number | undefined;
  const lines = block
    .split("\n")
    .map((line) => stripScreenLineNotes(line.trim()))
    .filter((line) => !isNonCopyScreenLine(line))
    .filter(Boolean);

  // Parse explicit labels only when they appear at the start of a line.
  const labeled: ScreenText = {};
  let currentField: "header" | "body" | "disclaimer" | null = null;
  for (const line of lines) {
    const durationMatch = line.match(/^duration\s*[:\-]?\s*(.+)$/i);
    if (durationMatch) {
      duration = parseDurationText(durationMatch[1]) ?? duration;
      continue;
    }
    const labelMatch = line.match(/^(header|body|disclaimer)\s*:\s*(.*)$/i);
    if (labelMatch) {
      currentField = labelMatch[1].toLowerCase() as "header" | "body" | "disclaimer";
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
    return { screen, ...(duration !== undefined ? { duration } : {}) };
  }

  const disclaimerStart = lines.findIndex((line) => /^\*(?!\*)/.test(line));
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

  return { screen, ...(duration !== undefined ? { duration } : {}) };
}

function stripScreenLineNotes(line: string): string {
  return line
    .replace(
      /\s*\((?:(?:first|second)(?:\s+sentence)?|in very small print(?:\s+at bottom)?)\)\s*/gi,
      " "
    )
    .replace(/\s{2,}/g, " ")
    .trim();
}

function isNonCopyScreenLine(line: string): boolean {
  return /^<<.*>>$/.test(line) || /^end\s*card(?:\s*\(.*\))?$/i.test(line);
}

function parseDurationText(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const match = value.match(/(\d+(?:\.\d+)?)\s*(?:s|sec|secs|second|seconds)\b/i);
  if (!match) return undefined;
  const seconds = Number.parseFloat(match[1]);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : undefined;
}

function extractDefaultScreenDuration(brief: string): number {
  const patterns = [
    /(?:each|every)\s+(?:slide|screen)\s*(?:is|should be|:)?\s*(\d+(?:\.\d+)?)\s*(?:s|sec|secs|second|seconds)\b/i,
    /(?:slide|screen)\s+duration(?:\s+is|\s+should be)?\s*[:\-]?\s*(\d+(?:\.\d+)?)\s*(?:s|sec|secs|second|seconds)\b/i,
    /duration(?:\s+per\s+(?:slide|screen))?\s*[:\-]?\s*(\d+(?:\.\d+)?)\s*(?:s|sec|secs|second|seconds)\s*(?:each|per)?\b/i,
  ];

  for (const pattern of patterns) {
    const match = brief.match(pattern);
    if (!match) continue;
    const seconds = parseDurationText(match[0]);
    if (seconds !== undefined) return seconds;
  }

  return DEFAULT_SLIDE_DURATION;
}

function resolveScreenDurations(
  brief: string,
  variants: Variant[],
  screens: Record<string, ScreenText>,
  explicitDurations: Record<string, number>
): Record<string, number> {
  const defaultDuration = extractDefaultScreenDuration(brief);
  const activeScreenNumbers = new Set<string>();

  if (variants.length > 0) {
    activeScreenNumbers.add("1");
  }

  for (const num of Object.keys(screens)) {
    activeScreenNumbers.add(num);
  }

  const resolved: Record<string, number> = {};
  for (const num of [...activeScreenNumbers].sort((a, b) => Number(a) - Number(b))) {
    resolved[num] = explicitDurations[num] ?? defaultDuration;
  }

  return resolved;
}

export function computeVideoCount(parsed: ParsedBrief): number {
  const variantCount = Math.max(parsed.variants.length, 1);
  const bgCount = Math.max(parsed.backgrounds.length, 1);
  const sizeCount = parsed.sizes.length;
  return variantCount * bgCount * sizeCount;
}

export function computeTotalDuration(parsed: ParsedBrief): number {
  const orderedScreens = Object.keys(parsed.screenDurations).sort(
    (a, b) => Number(a) - Number(b)
  );

  if (orderedScreens.length === 0) {
    return DEFAULT_SLIDE_DURATION;
  }

  return Number(
    orderedScreens
      .reduce((total, num) => total + (parsed.screenDurations[num] ?? DEFAULT_SLIDE_DURATION), 0)
      .toFixed(2)
  );
}
