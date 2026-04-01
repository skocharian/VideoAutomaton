import type {
  AnalysisRegionKey,
  BackgroundAnalysisArtifact,
  BackgroundAnalysisFrame,
  BackgroundAnalysisRef,
  BackgroundAnalysisSize,
  Env,
  RegionMetrics,
  RenderSize,
  ScreenThemeSuggestion,
  ThemeStyleId,
  ThemeSuggestion,
} from "./types";
import { getRenderLayoutConfig } from "./render-layout";

const THEME_STYLE_PRIORITY: ThemeStyleId[] = [
  "white",
  "white-shadow",
  "white-scrim",
  "navy",
  "navy-scrim",
];

const THEME_STYLE_DETAILS: Record<ThemeStyleId, ThemeSuggestion> = {
  white: {
    styleId: "white",
    fillColor: "#ffffff",
    shadowColor: "rgba(7,26,56,0.72)",
    shadowBlur: 12,
    shadowY: 2,
  },
  "white-shadow": {
    styleId: "white-shadow",
    fillColor: "#ffffff",
    shadowColor: "rgba(4,17,39,0.90)",
    shadowBlur: 18,
    shadowY: 4,
  },
  "white-scrim": {
    styleId: "white-scrim",
    fillColor: "#ffffff",
    shadowColor: "rgba(4,17,39,0.90)",
    shadowBlur: 18,
    shadowY: 4,
    scrimColor: "#071a38",
    scrimOpacity: 0.24,
  },
  navy: {
    styleId: "navy",
    fillColor: "#0c2340",
    shadowColor: "rgba(255,255,255,0.18)",
    shadowBlur: 4,
    shadowY: 1,
  },
  "navy-scrim": {
    styleId: "navy-scrim",
    fillColor: "#0c2340",
    shadowColor: "rgba(255,255,255,0.18)",
    shadowBlur: 4,
    shadowY: 1,
    scrimColor: "#ffffff",
    scrimOpacity: 0.16,
  },
};

const CONTENT_REGION_IDS: Record<
  "header" | "body" | "disclaimer",
  AnalysisRegionKey
> = {
  header: "content-header",
  body: "content-body",
  disclaimer: "content-disclaimer",
};

const CLOSING_REGION_IDS: Record<
  "accolade" | "testimonial" | "endcard",
  Record<"header" | "body", AnalysisRegionKey>
> = {
  accolade: {
    header: "closing-accolade-body",
    body: "closing-accolade-body",
  },
  testimonial: {
    header: "closing-testimonial-header",
    body: "closing-testimonial-body",
  },
  endcard: {
    header: "closing-endcard-header",
    body: "closing-endcard-body",
  },
};

export function getBackgroundAnalysisArtifactKey(assetKey: string): string {
  return `analysis/${assetKey}.json`;
}

export function buildPendingBackgroundAnalysisArtifact(
  assetKey: string
): BackgroundAnalysisArtifact {
  return {
    version: 1,
    assetKey,
    status: "pending",
    source: "pending",
    updatedAt: new Date().toISOString(),
    sizes: {},
  };
}

export async function seedBackgroundAnalysis(
  env: Env,
  assetKey: string
): Promise<void> {
  const artifact = buildPendingBackgroundAnalysisArtifact(assetKey);
  await env.R2_ASSETS.put(
    getBackgroundAnalysisArtifactKey(assetKey),
    JSON.stringify(artifact, null, 2),
    {
      httpMetadata: {
        contentType: "application/json",
      },
    }
  );
}

export async function readBackgroundAnalysis(
  env: Env,
  assetKey: string
): Promise<BackgroundAnalysisArtifact | null> {
  const object = await env.R2_ASSETS.get(getBackgroundAnalysisArtifactKey(assetKey));
  if (!object) return null;
  return (await object.json()) as BackgroundAnalysisArtifact;
}

export async function writeBackgroundAnalysis(
  env: Env,
  artifact: BackgroundAnalysisArtifact
): Promise<BackgroundAnalysisArtifact> {
  const existing = await readBackgroundAnalysis(env, artifact.assetKey);
  const merged = mergeBackgroundAnalysis(existing, artifact);
  await env.R2_ASSETS.put(
    getBackgroundAnalysisArtifactKey(artifact.assetKey),
    JSON.stringify(merged, null, 2),
    {
      httpMetadata: {
        contentType: "application/json",
      },
    }
  );
  return merged;
}

export async function getBackgroundAnalysisRef(
  env: Env,
  assetKey: string
): Promise<BackgroundAnalysisRef> {
  const artifactKey = getBackgroundAnalysisArtifactKey(assetKey);
  const artifact = await readBackgroundAnalysis(env, assetKey);
  if (!artifact) {
    return {
      key: assetKey,
      artifactKey,
      status: "missing",
    };
  }

  return {
    key: assetKey,
    artifactKey,
    status: artifact.status,
    source: artifact.source,
    updatedAt: artifact.updatedAt,
  };
}

export function suggestContentTheme(
  artifact: BackgroundAnalysisArtifact | null,
  size: RenderSize,
  sampleTimes: number[]
): ScreenThemeSuggestion {
  const header = getThemeForRegion(artifact, size, CONTENT_REGION_IDS.header, sampleTimes);
  const body = getThemeForRegion(artifact, size, CONTENT_REGION_IDS.body, sampleTimes);
  const disclaimer = getThemeForRegion(
    artifact,
    size,
    CONTENT_REGION_IDS.disclaimer,
    sampleTimes
  );
  const sharedTheme = harmonizeContentTheme([header, body, disclaimer]);

  return {
    header: sharedTheme,
    body: sharedTheme,
    disclaimer: sharedTheme,
  };
}

export function suggestClosingTheme(
  artifact: BackgroundAnalysisArtifact | null,
  size: RenderSize,
  kind: "accolade" | "testimonial" | "endcard",
  sampleTimes: number[]
): ScreenThemeSuggestion {
  const regionIds = CLOSING_REGION_IDS[kind];
  return {
    header: getThemeForRegion(artifact, size, regionIds.header, sampleTimes),
    body: getThemeForRegion(artifact, size, regionIds.body, sampleTimes),
  };
}

export function getAnalysisStatus(
  artifact: BackgroundAnalysisArtifact | null
): "missing" | "pending" | "temporary" | "ready" {
  return artifact?.status ?? "missing";
}

export function buildTimelineSampleTimes(
  startTime: number,
  duration: number
): number[] {
  const ratios = getRenderLayoutConfig().sampleRatios;
  return ratios.map((ratio) => Number((startTime + duration * ratio).toFixed(3)));
}

function mergeBackgroundAnalysis(
  existing: BackgroundAnalysisArtifact | null,
  incoming: BackgroundAnalysisArtifact
): BackgroundAnalysisArtifact {
  if (!existing) {
    return incoming;
  }

  if (existing.source === "canonical" && incoming.source !== "canonical") {
    return {
      ...existing,
      sizes: {
        ...existing.sizes,
        ...Object.fromEntries(
          Object.entries(incoming.sizes).filter(
            ([size]) => !existing.sizes[size as RenderSize]
          )
        ),
      },
    };
  }

  return {
    ...existing,
    ...incoming,
    sizes: {
      ...existing.sizes,
      ...incoming.sizes,
    },
    status:
      incoming.source === "canonical"
        ? "ready"
        : incoming.status === "temporary" || existing.status === "temporary"
          ? "temporary"
          : incoming.status,
  };
}

function getThemeForRegion(
  artifact: BackgroundAnalysisArtifact | null,
  size: RenderSize,
  regionId: AnalysisRegionKey,
  sampleTimes: number[]
): ThemeSuggestion {
  const defaultTheme = THEME_STYLE_DETAILS.white;
  if (!artifact) return defaultTheme;

  const sizeData = artifact.sizes[size];
  if (!sizeData) return defaultTheme;

  const aggregated = aggregateRegionMetrics(sizeData, artifact.sourceDuration, regionId, sampleTimes);
  if (!aggregated) {
    const fallbackStyle = sizeData.defaultSuggestions?.[regionId] ?? "white";
    return THEME_STYLE_DETAILS[fallbackStyle];
  }

  for (const styleId of THEME_STYLE_PRIORITY) {
    if (meetsLegibilityThreshold(aggregated, styleId)) {
      return THEME_STYLE_DETAILS[styleId];
    }
  }

  return THEME_STYLE_DETAILS["white-scrim"];
}

function harmonizeContentTheme(
  suggestions: Array<ThemeSuggestion | undefined>
): ThemeSuggestion {
  const styles = suggestions
    .filter((item): item is ThemeSuggestion => Boolean(item))
    .map((item) => normalizeContentStyle(item.styleId));

  if (!styles.length) {
    return THEME_STYLE_DETAILS.white;
  }

  const sharedStyle = styles.reduce((strongest, styleId) =>
    CONTENT_STYLE_STRENGTH[styleId] > CONTENT_STYLE_STRENGTH[strongest]
      ? styleId
      : strongest
  );

  return THEME_STYLE_DETAILS[sharedStyle];
}

const CONTENT_STYLE_STRENGTH: Record<"white" | "white-shadow" | "white-scrim", number> = {
  white: 0,
  "white-shadow": 1,
  "white-scrim": 2,
};

function normalizeContentStyle(
  styleId: ThemeStyleId
): "white" | "white-shadow" | "white-scrim" {
  if (styleId === "white" || styleId === "white-shadow" || styleId === "white-scrim") {
    return styleId;
  }

  return "white-scrim";
}

function aggregateRegionMetrics(
  sizeData: BackgroundAnalysisSize,
  sourceDuration: number | undefined,
  regionId: AnalysisRegionKey,
  sampleTimes: number[]
) {
  const metrics = sampleTimes
    .map((time) => {
      const sourceTime = resolveSourceTime(time, sourceDuration);
      const frame = pickNearestFrame(sizeData.frames, sourceTime);
      return frame?.regions?.[regionId];
    })
    .filter((item): item is RegionMetrics => Boolean(item));

  if (!metrics.length) return null;

  const count = metrics.length;
  return {
    avgLuminance: metrics.reduce((sum, item) => sum + item.avgLuminance, 0) / count,
    variance: metrics.reduce((sum, item) => sum + item.variance, 0) / count,
    brightRatio: Math.max(...metrics.map((item) => item.brightRatio)),
    darkRatio: Math.max(...metrics.map((item) => item.darkRatio)),
    detail: metrics.reduce((sum, item) => sum + item.detail, 0) / count,
  };
}

function resolveSourceTime(renderTime: number, sourceDuration?: number): number {
  if (!sourceDuration || sourceDuration <= 0) {
    return Number(renderTime.toFixed(3));
  }
  const mod = renderTime % sourceDuration;
  return Number((mod < 0 ? mod + sourceDuration : mod).toFixed(3));
}

function pickNearestFrame(
  frames: BackgroundAnalysisFrame[],
  sourceTime: number
): BackgroundAnalysisFrame | undefined {
  if (!frames.length) return undefined;

  return frames.reduce((closest, frame) => {
    if (!closest) return frame;
    return Math.abs(frame.sourceTime - sourceTime) <
      Math.abs(closest.sourceTime - sourceTime)
      ? frame
      : closest;
  });
}

function meetsLegibilityThreshold(
  metrics: {
    avgLuminance: number;
    variance: number;
    brightRatio: number;
    darkRatio: number;
    detail: number;
  },
  styleId: ThemeStyleId
): boolean {
  const score = scoreThemeStyle(metrics, styleId);
  return score >= 4.0;
}

function scoreThemeStyle(
  metrics: {
    avgLuminance: number;
    variance: number;
    brightRatio: number;
    darkRatio: number;
    detail: number;
  },
  styleId: ThemeStyleId
): number {
  const effectiveBackgroundLuminance = getEffectiveBackgroundLuminance(
    metrics.avgLuminance,
    styleId
  );
  const textLuminance = styleId.startsWith("navy") ? 0.02 : 1;
  const contrast = getContrastRatio(textLuminance, effectiveBackgroundLuminance);
  const noisePenalty = metrics.variance * 1.6 + metrics.detail * 0.12;
  const glarePenalty = styleId.startsWith("white")
    ? metrics.brightRatio * 2.4
    : metrics.darkRatio * 1.8;
  const shadowBonus = styleId.includes("shadow") ? 0.45 : 0;
  const scrimBonus = styleId.includes("scrim") ? 0.95 : 0;
  return contrast - noisePenalty - glarePenalty + shadowBonus + scrimBonus;
}

function getEffectiveBackgroundLuminance(
  avgLuminance: number,
  styleId: ThemeStyleId
): number {
  if (styleId === "white-scrim") {
    return Math.max(0, avgLuminance * 0.68);
  }
  if (styleId === "navy-scrim") {
    return Math.min(1, avgLuminance * 0.72 + 0.18);
  }
  return avgLuminance;
}

function getContrastRatio(foreground: number, background: number): number {
  const lighter = Math.max(foreground, background);
  const darker = Math.min(foreground, background);
  return (lighter + 0.05) / (darker + 0.05);
}
