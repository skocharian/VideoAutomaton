import type {
  BackgroundSetting,
  ClosingScreenKind,
  ParsedBrief,
  ParseBriefRequest,
  ParsedClosingScreen,
  ParsedContentScreen,
  Variant,
  ScreenText,
} from "./types";
import { getClosingDefaults } from "./render-layout";
import { stripRichTextMarkup } from "./rich-text";

const DEFAULT_SLIDE_DURATION = 3;
const MAX_SUGGESTED_SLIDE_DURATION = 7;
const READING_WORDS_PER_SECOND = 3.6;
const READING_CHARS_PER_SECOND = 24;
const READING_BASE_SECONDS = 0.9;
const READING_LINE_SECONDS = 0.1;

/**
 * Parse a raw marketing brief into structured data.
 * Extracts campaign ID, variants (V1-V4 headlines/subheadlines),
 * and per-screen text blocks (each screen can have header + body).
 * Number of screens is dynamic — determined by what's in the brief.
 */
export function parseBrief(req: ParseBriefRequest): ParsedBrief {
  const {
    brief,
    backgrounds,
    backgroundSettings,
    sizes,
    audio,
    audioStartSeconds,
    accolade,
    badge,
    logo,
    novelty,
  } = req;
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
  const closingScreenMatches = detectClosingScreenMatches(screens);
  const detectedClosingScreenKeys = detectClosingScreenKeys(closingScreenMatches);
  const ignoredScreenKeys = buildIgnoredClosingScreenKeys(
    detectedClosingScreenKeys,
    closingScreenMatches
  );
  const contentScreens = buildContentScreens(screens, screenDurations, ignoredScreenKeys);
  const closingScreens = buildClosingScreens(screenDurations, detectedClosingScreenKeys);

  return {
    campaign_id: campaignId,
    variants,
    screens,
    contentScreens,
    closingScreens,
    detectedClosingScreenKeys,
    screenDurations,
    backgrounds,
    backgroundSettings: normalizeBackgroundSettings(backgrounds, backgroundSettings),
    sizes: sizes.length > 0 ? sizes : ["9:16", "4:5"],
    audio: audio ?? "",
    audioStartSeconds: normalizeAudioStartSeconds(audioStartSeconds),
    accolade: accolade ?? "",
    badge: badge ?? "",
    logo: logo ?? "",
    ...(novelty && novelty.length > 0 ? { novelty } : {}),
  };
}

function normalizeBackgroundSettings(
  backgrounds: string[],
  backgroundSettings: Record<string, BackgroundSetting> | undefined
): Record<string, BackgroundSetting> {
  return Object.fromEntries(
    backgrounds.map((background) => [
      background,
      {
        speed: normalizeBackgroundSpeed(backgroundSettings?.[background]?.speed),
      },
    ])
  );
}

export function normalizeBackgroundSpeed(value: number | undefined): number {
  if (!Number.isFinite(value)) {
    return 1;
  }

  return Math.max(0.5, Math.min(3, Number(value)));
}

function normalizeAudioStartSeconds(value: number | undefined): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Number(value));
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
    /(?:^|\n)\s*V(\d+)\s*[:\-–]\s*([\s\S]*?)(?=(?:\n\s*V\d+\s*[:\-–])|(?:\n\s*(?:Screen|S)\s*\d+(?:\s*\([^)]*\))?(?:\s*[:\-–]|\s+|$))|(?:\n\s*(?:\*\*|__)?\s*From\s+screen\s+\d+\s+on\b)|$)/gi;

  let match;
  while ((match = variantBlockPattern.exec(normalizedBrief)) !== null) {
    const block = match[2].trim();
    if (!block) continue;

    const lines = block
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    if (lines.length === 0) continue;

    const boundaryIndex = lines.findIndex(isVariantBoundaryLine);
    const variantLines = boundaryIndex >= 0 ? lines.slice(0, boundaryIndex) : lines;
    if (variantLines.length === 0) continue;

    const inlineSplit = variantLines[0].match(/^(.*?)(?:\s+\/\s+|\s+\|\s+)(.+)$/);
    const headline = stripEnclosingQuotes(
      inlineSplit ? inlineSplit[1] : variantLines[0]
    );
    const subheadline = stripEnclosingQuotes(
      inlineSplit ? inlineSplit[2] : variantLines.slice(1).join("\n")
    );

    variants.push({
      id: `V${match[1]}`,
      headline,
      subheadline,
    });
  }

  return variants;
}

function isVariantBoundaryLine(line: string): boolean {
  const normalized = stripRichTextMarkup(line)
    .replace(/^(\*\*|__)\s*/, "")
    .replace(/\s*(\*\*|__)$/, "")
    .trim();

  return (
    /^(?:Screen|S)\s*\d+(?:\s*\([^)]*\))?(?:\s*[:\-–]|\s+|$)/i.test(normalized) ||
    /^From\s+screen\s+\d+\s+on\b/i.test(normalized)
  );
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

function buildContentScreens(
  screens: Record<string, ScreenText>,
  screenDurations: Record<string, number>,
  ignoredKeys: Set<string>
): ParsedContentScreen[] {
  return Object.entries(screens)
    .filter(([key]) => key !== "1" && !ignoredKeys.has(key))
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([key, screen]) => ({
      key,
      duration: screenDurations[key] ?? DEFAULT_SLIDE_DURATION,
      header: screen.header,
      body: screen.body,
      disclaimer: screen.disclaimer,
    }));
}

function buildClosingScreens(
  screenDurations: Record<string, number>,
  detectedClosingScreenKeys: Partial<Record<ClosingScreenKind, string>>
): ParsedClosingScreen[] {
  return (["accolade", "testimonial", "endcard"] as ClosingScreenKind[]).map(
    (kind) => {
      const defaults = getClosingDefaults(kind);
      const detectedKey = detectedClosingScreenKeys[kind];
      const suggestedDuration = estimateScreenDuration({
        header: defaults.header || defaults.fallbackHeader,
        body: defaults.body,
      });
      return {
        kind,
        duration: detectedKey
          ? screenDurations[detectedKey] ?? suggestedDuration
          : suggestedDuration,
        header: defaults.header,
        body: defaults.body,
      };
    }
  );
}

function detectClosingScreenMatches(
  screens: Record<string, ScreenText>
): Record<ClosingScreenKind, string[]> {
  const detected: Record<ClosingScreenKind, string[]> = {
    accolade: [],
    testimonial: [],
    endcard: [],
  };
  const orderedKeys = Object.keys(screens).sort((a, b) => Number(a) - Number(b));

  for (const key of orderedKeys) {
    const screen = screens[key];
    const haystack = `${screen.header ?? ""}\n${screen.body ?? ""}\n${screen.disclaimer ?? ""}`
      .replace(/\s+/g, " ")
      .toLowerCase();

    if (isEndcardScreen(haystack)) {
      detected.endcard.push(key);
    }

    if (isTestimonialScreen(haystack)) {
      detected.testimonial.push(key);
    }

    if (isAccoladeScreen(haystack)) {
      detected.accolade.push(key);
    }
  }

  return detected;
}

function detectClosingScreenKeys(
  matches: Record<ClosingScreenKind, string[]>
): Partial<Record<ClosingScreenKind, string>> {
  return {
    accolade: matches.accolade.at(-1),
    testimonial: matches.testimonial.at(-1),
    endcard: matches.endcard.at(-1),
  };
}

function buildIgnoredClosingScreenKeys(
  detectedClosingScreenKeys: Partial<Record<ClosingScreenKind, string>>,
  matches: Record<ClosingScreenKind, string[]>
): Set<string> {
  const ignored = new Set<string>(
    Object.values(detectedClosingScreenKeys).filter(
      (value): value is string => typeof value === "string" && value.length > 0
    )
  );

  for (const kind of ["accolade", "testimonial", "endcard"] as ClosingScreenKind[]) {
    const detectedKey = detectedClosingScreenKeys[kind];
    if (!detectedKey) continue;
    for (const key of matches[kind]) {
      if (key !== detectedKey) {
        ignored.add(key);
      }
    }
  }

  return ignored;
}

function isAccoladeScreen(haystack: string): boolean {
  return (
    /must have app/.test(haystack) ||
    /downloaded breethe/.test(haystack) ||
    (/selected/.test(haystack) && /apple/.test(haystack))
  );
}

function isTestimonialScreen(haystack: string): boolean {
  return (
    /★★★★★/.test(haystack) ||
    /maggie/.test(haystack) ||
    (/i cried the first time/i.test(haystack) && /anxiety/.test(haystack))
  );
}

function isEndcardScreen(haystack: string): boolean {
  return (
    /feel better\. sleep better\./.test(haystack) ||
    /breethe logo/.test(haystack) ||
    /end card/.test(haystack)
  );
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

function extractDefaultScreenDuration(brief: string): number | undefined {
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

  return undefined;
}

function estimateScreenDuration(screen: ScreenText): number {
  const cleanText = [screen.header, screen.body, screen.disclaimer]
    .map((value) => normalizeDurationCopy(value))
    .filter(Boolean)
    .join("\n");

  if (!cleanText) return DEFAULT_SLIDE_DURATION;

  const lineCount = cleanText.split("\n").filter((line) => line.trim()).length;
  const wordCount = cleanText.match(/[\p{L}\p{N}’'&]+/gu)?.length ?? 0;
  const characterCount = cleanText.replace(/\s+/g, "").length;
  const readingSeconds = Math.max(
    wordCount / READING_WORDS_PER_SECOND,
    characterCount / READING_CHARS_PER_SECOND
  );
  const lineSeconds = Math.max(0, lineCount - 1) * READING_LINE_SECONDS;

  return clampSuggestedDuration(READING_BASE_SECONDS + readingSeconds + lineSeconds);
}

function estimateOpeningDuration(variants: Variant[]): number {
  if (variants.length === 0) return DEFAULT_SLIDE_DURATION;

  return Math.max(
    ...variants.map((variant) =>
      estimateScreenDuration({
        header: variant.headline,
        body: variant.subheadline,
      })
    )
  );
}

function normalizeDurationCopy(value: string | undefined): string {
  return stripRichTextMarkup(value)
    .replace(/<<[^>]+>>/g, " ")
    .replace(/[★☆]/g, " ")
    .replace(/\s+\n/g, "\n")
    .replace(/\n\s+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function clampSuggestedDuration(value: number): number {
  const rounded = Math.round(value * 4) / 4;
  return Math.min(
    MAX_SUGGESTED_SLIDE_DURATION,
    Math.max(DEFAULT_SLIDE_DURATION, rounded)
  );
}

function resolveScreenDurations(
  brief: string,
  variants: Variant[],
  screens: Record<string, ScreenText>,
  explicitDurations: Record<string, number>
): Record<string, number> {
  const globalDefaultDuration = extractDefaultScreenDuration(brief);
  const activeScreenNumbers = new Set<string>();

  if (variants.length > 0) {
    activeScreenNumbers.add("1");
  }

  for (const num of Object.keys(screens)) {
    activeScreenNumbers.add(num);
  }

  const resolved: Record<string, number> = {};
  for (const num of [...activeScreenNumbers].sort((a, b) => Number(a) - Number(b))) {
    resolved[num] =
      explicitDurations[num] ??
      globalDefaultDuration ??
      (num === "1" && variants.length > 0
        ? estimateOpeningDuration(variants)
        : estimateScreenDuration(screens[num] ?? {}));
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
  const openingDuration = parsed.variants.length > 0
    ? parsed.screenDurations["1"] ?? DEFAULT_SLIDE_DURATION
    : 0;
  const contentDuration = parsed.contentScreens.length
    ? parsed.contentScreens.reduce((total, screen) => total + screen.duration, 0)
    : 0;
  const closingDuration = parsed.closingScreens.length
    ? parsed.closingScreens.reduce((total, screen) => total + screen.duration, 0)
    : 0;
  const totalDuration = openingDuration + contentDuration + closingDuration;

  return Number(totalDuration.toFixed(2)) || DEFAULT_SLIDE_DURATION;
}
