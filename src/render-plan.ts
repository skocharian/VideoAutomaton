import {
  buildTimelineSampleTimes,
  getAnalysisStatus,
  suggestClosingTheme,
  suggestContentTheme,
} from "./background-analysis";
import {
  getCanvasSize,
  getClosingDefaults,
  getClosingLayouts,
  getContentLayouts,
  getRenderLayoutConfig,
  type LayoutImageConfig,
  type LayoutScrimConfig,
  type LayoutTextConfig,
} from "./render-layout";
import { stripRichTextMarkup } from "./rich-text";
import type {
  BackgroundAnalysisArtifact,
  ClosingScreenKind,
  ParsedBrief,
  ParsedClosingScreen,
  ParsedContentScreen,
  PreviewLayer,
  PreviewModel,
  PreviewSlide,
  RenderElement,
  RenderScriptDocument,
  RenderSize,
  RenderValue,
  ScreenThemeSuggestion,
  TextLayerOverride,
  ThemeSuggestion,
} from "./types";

type TimelineScreen = {
  id: string;
  label: string;
  displayIndex: number;
  kind: "variant" | "content" | ClosingScreenKind;
  sourceKey?: string;
  time: number;
  duration: number;
  header?: string;
  body?: string;
  disclaimer?: string;
};

type RenderPlanOptions = {
  parsed: ParsedBrief;
  variantIndex: number;
  backgroundKey: string;
  size: RenderSize;
  assetBaseUrl: string;
  analysisArtifact: BackgroundAnalysisArtifact | null;
};

type ElementKeys = {
  header?: string;
  body?: string;
  disclaimer?: string;
  image?: string;
  logo?: string;
  badge?: string;
};

type RenderAnimation = Record<string, RenderValue>;

export function buildPreviewModel(options: RenderPlanOptions): PreviewModel {
  const slides = buildTimelineScreens(options.parsed, options.variantIndex).map((screen) =>
    buildPreviewSlide(screen, options)
  );

  return {
    backgroundKey: options.backgroundKey,
    backgroundUrl: assetUrl(options.assetBaseUrl, options.backgroundKey),
    size: options.size,
    totalDuration: Number(
      slides.reduce((total, slide) => total + slide.duration, 0).toFixed(2)
    ),
    analysisStatus: getAnalysisStatus(options.analysisArtifact),
    slides,
  };
}

export function buildRenderScriptDocument(
  options: RenderPlanOptions
): RenderScriptDocument {
  const { parsed, backgroundKey, size, assetBaseUrl } = options;
  const canvas = getCanvasSize(size);
  const screens = buildTimelineScreens(parsed, options.variantIndex);
  const totalDuration = Number(
    screens.reduce((total, screen) => total + screen.duration, 0).toFixed(2)
  );
  const backgroundSource = assetUrl(assetBaseUrl, backgroundKey);
  const backgroundConfig = getRenderLayoutConfig().sizes[size].background;

  const elements: RenderElement[] = [];

  if (backgroundKey) {
    elements.push({
      name: "Background",
      type: "video",
      track: 1,
      time: 0,
      duration: totalDuration,
      source: backgroundSource,
      loop: true,
      fit: backgroundConfig.fit ?? "cover",
      x: backgroundConfig.x,
      y: backgroundConfig.y,
      width: backgroundConfig.width,
      height: backgroundConfig.height,
      x_alignment: backgroundConfig.x_alignment ?? "50%",
      y_alignment: backgroundConfig.y_alignment ?? "50%",
      ...(parsed.audio ? { volume: "0%" } : {}),
    });
  }

  if (parsed.novelty?.length) {
    elements.push({
      name: "NoveltyClip",
      type: "video",
      track: 2,
      time: 0,
      duration: totalDuration,
      source: assetUrl(assetBaseUrl, parsed.novelty[0]),
      fit: "cover",
      x: "50%",
      y: "50%",
      width: "100%",
      height: "100%",
      x_alignment: "50%",
      y_alignment: "50%",
      loop: true,
      volume: "0%",
    });
  }

  screens.forEach((screen, index) => {
    const layers = buildScreenLayers(screen, options, false);
    if (!layers.length) return;

    elements.push({
      name: `Screen_${screen.displayIndex}`,
      type: "composition",
      track: 10 + index,
      time: screen.time,
      duration: screen.duration,
      width: "100%",
      height: "100%",
      elements: layers,
    });
  });

  if (parsed.audio) {
    elements.push({
      name: "Music",
      type: "audio",
      track: 90,
      time: 0,
      duration: totalDuration,
      source: assetUrl(assetBaseUrl, parsed.audio),
    });
  }

  return {
    output_format: "mp4",
    width: canvas.width,
    height: canvas.height,
    duration: totalDuration,
    frame_rate: 30,
    elements,
  };
}

function buildTimelineScreens(
  parsed: ParsedBrief,
  variantIndex: number
): TimelineScreen[] {
  const screens: TimelineScreen[] = [];
  let cursor = 0;
  let displayIndex = 1;

  const variant = parsed.variants[variantIndex] ?? parsed.variants[0];
  if (variant) {
    const duration = parsed.screenDurations["1"] ?? 3;
    screens.push({
      id: "opening",
      label: "S1",
      displayIndex,
      kind: "variant",
      sourceKey: "1",
      time: cursor,
      duration,
      header: variant.headline,
      body: variant.subheadline,
    });
    cursor += duration;
    displayIndex += 1;
  }

  for (const contentScreen of parsed.contentScreens) {
    screens.push({
      id: `content-${contentScreen.key}`,
      label: `S${contentScreen.key}`,
      displayIndex,
      kind: "content",
      sourceKey: contentScreen.key,
      time: Number(cursor.toFixed(2)),
      duration: contentScreen.duration,
      header: contentScreen.header,
      body: contentScreen.body,
      disclaimer: contentScreen.disclaimer,
    });
    cursor += contentScreen.duration;
    displayIndex += 1;
  }

  for (const closingScreen of parsed.closingScreens) {
    screens.push({
      id: `closing-${closingScreen.kind}`,
      label: `S${displayIndex}`,
      displayIndex,
      kind: closingScreen.kind,
      time: Number(cursor.toFixed(2)),
      duration: closingScreen.duration,
      header: closingScreen.header,
      body: closingScreen.body,
      disclaimer: closingScreen.disclaimer,
    });
    cursor += closingScreen.duration;
    displayIndex += 1;
  }

  return screens;
}

function buildPreviewSlide(
  screen: TimelineScreen,
  options: RenderPlanOptions
): PreviewSlide {
  return {
    id: screen.id,
    displayIndex: screen.displayIndex,
    sourceKey: screen.sourceKey,
    kind: screen.kind,
    duration: screen.duration,
    layers: buildScreenLayers(screen, options, true),
  };
}

function buildScreenLayers(
  screen: TimelineScreen,
  options: RenderPlanOptions,
  preview: true
): PreviewLayer[];
function buildScreenLayers(
  screen: TimelineScreen,
  options: RenderPlanOptions,
  preview: false
): RenderElement[];
function buildScreenLayers(
  screen: TimelineScreen,
  options: RenderPlanOptions,
  preview: boolean
): Array<PreviewLayer | RenderElement> {
  const sampleTimes = buildTimelineSampleTimes(screen.time, screen.duration);
  const isContent = screen.kind === "variant" || screen.kind === "content";
  const elementKeys = getElementKeys(screen);

  if (isContent) {
    const theme = suggestContentTheme(options.analysisArtifact, options.size, sampleTimes);
    const screenLayout = getContentLayouts(options.size);
    const layers: Array<PreviewLayer | RenderElement> = [];

    pushScrimLayer(layers, preview, `Scrim_${screen.id}`, screen.duration, screenLayout.scrim, theme);
    pushTextLayer(
      layers,
      preview,
      elementKeys.header,
      screen.duration,
      screenLayout.header,
      options.parsed.textOverrides,
      screen.header ?? "",
      theme.header
    );
    pushTextLayer(
      layers,
      preview,
      elementKeys.body,
      screen.duration,
      screenLayout.body,
      options.parsed.textOverrides,
      screen.body ?? "",
      theme.body
    );
    pushTextLayer(
      layers,
      preview,
      elementKeys.disclaimer,
      screen.duration,
      screenLayout.disclaimer,
      options.parsed.textOverrides,
      screen.disclaimer ?? "",
      theme.disclaimer
    );

    return layers;
  }

  switch (screen.kind) {
    case "accolade": {
      const theme = suggestClosingTheme(
        options.analysisArtifact,
        options.size,
        "accolade",
        sampleTimes
      );
      const screenLayout = getClosingLayouts(options.size, "accolade");
      const layers: Array<PreviewLayer | RenderElement> = [];
      const headerText =
        !options.parsed.accolade && !stripRichTextMarkup(screen.header ?? "").trim()
          ? getClosingDefaults("accolade").fallbackHeader ?? ""
          : screen.header ?? "";

      pushScrimLayer(layers, preview, `Scrim_${screen.id}`, screen.duration, screenLayout.scrim, theme);
      pushImageLayer(
        layers,
        preview,
        elementKeys.image ?? "Closing_Accolade_Image",
        screen.duration,
        screenLayout.image,
        options.parsed.accolade
          ? assetUrl(options.assetBaseUrl, options.parsed.accolade)
          : ""
      );
      pushTextLayer(
        layers,
        preview,
        elementKeys.header,
        screen.duration,
        screenLayout.header,
        options.parsed.textOverrides,
        headerText,
        theme.header
      );
      pushTextLayer(
        layers,
        preview,
        elementKeys.body,
        screen.duration,
        screenLayout.body,
        options.parsed.textOverrides,
        screen.body ?? "",
        theme.body
      );

      return layers;
    }
    case "testimonial": {
      const theme = suggestClosingTheme(
        options.analysisArtifact,
        options.size,
        "testimonial",
        sampleTimes
      );
      const screenLayout = getClosingLayouts(options.size, "testimonial");
      const layers: Array<PreviewLayer | RenderElement> = [];

      pushScrimLayer(layers, preview, `Scrim_${screen.id}`, screen.duration, screenLayout.scrim, theme);
      pushTextLayer(
        layers,
        preview,
        elementKeys.header,
        screen.duration,
        screenLayout.header,
        options.parsed.textOverrides,
        screen.header ?? "",
        theme.header
      );
      pushTextLayer(
        layers,
        preview,
        elementKeys.body,
        screen.duration,
        screenLayout.body,
        options.parsed.textOverrides,
        screen.body ?? "",
        theme.body
      );

      return layers;
    }
    case "endcard": {
      const theme = suggestClosingTheme(
        options.analysisArtifact,
        options.size,
        "endcard",
        sampleTimes
      );
      const screenLayout = getClosingLayouts(options.size, "endcard");
      const layers: Array<PreviewLayer | RenderElement> = [];

      pushScrimLayer(layers, preview, `Scrim_${screen.id}`, screen.duration, screenLayout.scrim, theme);
      pushImageLayer(
        layers,
        preview,
        elementKeys.logo ?? "Closing_Endcard_Logo",
        screen.duration,
        screenLayout.logo,
        options.parsed.logo ? assetUrl(options.assetBaseUrl, options.parsed.logo) : ""
      );
      pushTextLayer(
        layers,
        preview,
        elementKeys.header,
        screen.duration,
        screenLayout.header,
        options.parsed.textOverrides,
        screen.header ?? "",
        theme.header
      );
      pushTextLayer(
        layers,
        preview,
        elementKeys.body,
        screen.duration,
        screenLayout.body,
        options.parsed.textOverrides,
        screen.body ?? "",
        theme.body
      );
      pushImageLayer(
        layers,
        preview,
        elementKeys.badge ?? "Closing_Endcard_Badge",
        screen.duration,
        screenLayout.badge,
        options.parsed.badge
          ? assetUrl(options.assetBaseUrl, options.parsed.badge)
          : ""
      );

      return layers;
    }
  }

  return [];
}

function getElementKeys(screen: TimelineScreen): ElementKeys {
  if (screen.kind === "variant") {
    return {
      header: "S1_Header",
      body: "S1_Body",
    };
  }

  if (screen.kind === "content") {
    const key = screen.sourceKey ?? String(screen.displayIndex);
    return {
      header: `S${key}_Header`,
      body: `S${key}_Body`,
      disclaimer: `S${key}_Disclaimer`,
    };
  }

  if (screen.kind === "accolade") {
    return {
      header: "Closing_Accolade_Header",
      body: "Closing_Accolade_Body",
      image: "Closing_Accolade_Image",
    };
  }

  if (screen.kind === "testimonial") {
    return {
      header: "Closing_Testimonial_Header",
      body: "Closing_Testimonial_Body",
    };
  }

  return {
    header: "Closing_Endcard_Header",
    body: "Closing_Endcard_Body",
    logo: "Closing_Endcard_Logo",
    badge: "Closing_Endcard_Badge",
  };
}

function resolveTextLayout(
  layout: LayoutTextConfig,
  override: TextLayerOverride | undefined
): LayoutTextConfig {
  return {
    ...layout,
    ...(Number.isFinite(override?.fontSize)
      ? { font_size: Number(override?.fontSize) }
      : {}),
    ...(typeof override?.x === "string" && override.x.trim()
      ? { x: override.x.trim() }
      : {}),
    ...(typeof override?.y === "string" && override.y.trim()
      ? { y: override.y.trim() }
      : {}),
  };
}

function pushScrimLayer(
  layers: Array<PreviewLayer | RenderElement>,
  preview: boolean,
  key: string,
  duration: number,
  layout: LayoutScrimConfig,
  theme: ScreenThemeSuggestion
): void {
  const scrim = getPreferredScrim(theme);
  if (!scrim) return;

  layers.push(
    preview
      ? buildPreviewShapeLayer(key, layout, scrim)
      : buildRenderShapeElement(key, duration, layout, scrim)
  );
}

function pushTextLayer(
  layers: Array<PreviewLayer | RenderElement>,
  preview: boolean,
  key: string | undefined,
  duration: number,
  layout: LayoutTextConfig,
  overrides: ParsedBrief["textOverrides"] | undefined,
  text: string,
  theme: ThemeSuggestion | undefined
): void {
  if (!stripRichTextMarkup(text).trim()) return;

  const override = key ? overrides?.[key] : undefined;
  const resolvedLayout = resolveTextLayout(layout, override);
  const resolvedTheme = resolveTheme(theme, override);
  layers.push(
    preview
      ? buildPreviewTextLayer(key, resolvedLayout, text, resolvedTheme)
      : buildRenderTextElement(key, duration, resolvedLayout, text, resolvedTheme)
  );
}

function pushImageLayer(
  layers: Array<PreviewLayer | RenderElement>,
  preview: boolean,
  key: string,
  duration: number,
  layout: LayoutImageConfig,
  src: string
): void {
  if (!src) return;

  layers.push(
    preview
      ? buildPreviewImageLayer(key, layout, src)
      : buildRenderImageElement(key, duration, layout, src)
  );
}

function buildPreviewTextLayer(
  key: string | undefined,
  layout: LayoutTextConfig,
  text: string,
  theme: ThemeSuggestion | undefined
): PreviewLayer {
  return {
    key: key ?? crypto.randomUUID(),
    type: "text",
    x: layout.x,
    y: layout.y,
    width: layout.width,
    height: layout.height,
    xAnchor: layout.x_anchor,
    yAnchor: layout.y_anchor,
    xAlignment: layout.x_alignment,
    yAlignment: layout.y_alignment,
    text,
    color: theme?.fillColor ?? "#ffffff",
    fontFamily: layout.font_family,
    fontSize: layout.font_size,
    fontWeight: layout.font_weight,
    lineHeight: layout.line_height,
    textAlign: layout.text_align,
    textShadow: buildCssTextShadow(theme),
  };
}

function resolveTheme(
  theme: ThemeSuggestion | undefined,
  override: TextLayerOverride | undefined
): ThemeSuggestion | undefined {
  if (!override?.color?.trim()) {
    return theme;
  }

  const baseTheme =
    theme ??
    ({
      styleId: "white",
      fillColor: "#ffffff",
      shadowColor: "rgba(7,26,56,0.72)",
      shadowBlur: 12,
      shadowY: 2,
    } satisfies ThemeSuggestion);

  return {
    ...baseTheme,
    fillColor: override.color.trim(),
  };
}

function buildRenderTextElement(
  key: string | undefined,
  duration: number,
  layout: LayoutTextConfig,
  text: string,
  theme: ThemeSuggestion | undefined
): RenderElement {
  const animations = buildTextAnimations(duration, layout.regionId === "content-disclaimer");
  return {
    ...(key ? { name: key } : {}),
    type: "text",
    track: 10,
    time: 0,
    duration,
    x: layout.x,
    y: layout.y,
    width: layout.width,
    height: layout.height,
    ...(layout.x_anchor ? { x_anchor: layout.x_anchor } : {}),
    ...(layout.y_anchor ? { y_anchor: layout.y_anchor } : {}),
    ...(layout.x_alignment ? { x_alignment: layout.x_alignment } : {}),
    ...(layout.y_alignment ? { y_alignment: layout.y_alignment } : {}),
    fill_color: theme?.fillColor ?? "#ffffff",
    text: stripRichTextMarkup(text),
    font_family: layout.font_family,
    font_size: layout.font_size,
    font_weight: layout.font_weight,
    line_height: layout.line_height,
    text_align: layout.text_align,
    shadow_color: theme?.shadowColor ?? "rgba(7,26,56,0.72)",
    shadow_blur: `${theme?.shadowBlur ?? 12}px`,
    shadow_y: `${theme?.shadowY ?? 2}px`,
    animations,
  };
}

function buildPreviewImageLayer(
  key: string,
  layout: LayoutImageConfig,
  src: string
): PreviewLayer {
  return {
    key,
    type: "image",
    x: layout.x,
    y: layout.y,
    width: layout.width,
    height: layout.height,
    xAlignment: layout.x_alignment,
    yAlignment: layout.y_alignment,
    src,
    fit: layout.fit ?? "contain",
  };
}

function buildRenderImageElement(
  key: string,
  duration: number,
  layout: LayoutImageConfig,
  src: string
): RenderElement {
  return {
    name: key,
    type: "image",
    track: 6,
    time: 0,
    duration,
    x: layout.x,
    y: layout.y,
    width: layout.width,
    height: layout.height,
    x_alignment: layout.x_alignment ?? "50%",
    y_alignment: layout.y_alignment ?? "50%",
    fit: layout.fit ?? "contain",
    source: src,
    animations: buildAssetFadeAnimations(duration),
  };
}

function buildPreviewShapeLayer(
  key: string,
  layout: LayoutScrimConfig,
  theme: ThemeSuggestion
): PreviewLayer {
  return {
    key,
    type: "shape",
    x: layout.x,
    y: layout.y,
    width: layout.width,
    height: layout.height,
    xAnchor: layout.x_anchor,
    yAnchor: layout.y_anchor,
    xAlignment: layout.x_alignment,
    yAlignment: layout.y_alignment,
    color: theme.scrimColor,
    opacity: `${Math.round((theme.scrimOpacity ?? 0.2) * 100)}%`,
    borderRadius: layout.border_radius ?? "0%",
  };
}

function buildRenderShapeElement(
  key: string,
  duration: number,
  layout: LayoutScrimConfig,
  theme: ThemeSuggestion
): RenderElement {
  return {
    name: key,
    type: "shape",
    track: 1,
    time: 0,
    duration,
    x: layout.x,
    y: layout.y,
    width: layout.width,
    height: layout.height,
    ...(layout.x_anchor ? { x_anchor: layout.x_anchor } : {}),
    ...(layout.y_anchor ? { y_anchor: layout.y_anchor } : {}),
    ...(layout.x_alignment ? { x_alignment: layout.x_alignment } : {}),
    ...(layout.y_alignment ? { y_alignment: layout.y_alignment } : {}),
    fill_color: theme.scrimColor ?? "#071a38",
    opacity: `${Math.round((theme.scrimOpacity ?? 0.2) * 100)}%`,
    border_radius: layout.border_radius ?? "0%",
    path: "M 0% 0% L 100% 0% L 100% 100% L 0% 100% Z",
    animations: buildAssetFadeAnimations(duration),
  };
}

function getPreferredScrim(theme: ScreenThemeSuggestion): ThemeSuggestion | null {
  const suggestions = [theme.header, theme.body, theme.disclaimer].filter(
    (item): item is ThemeSuggestion => Boolean(item)
  );
  const scrimSuggestion = suggestions.find((item) => item?.scrimColor);
  return scrimSuggestion ?? null;
}

function buildCssTextShadow(theme: ThemeSuggestion | undefined): string {
  if (!theme) {
    return "0 2px 12px rgba(7, 26, 56, 0.72)";
  }
  return `0 ${theme.shadowY}px ${theme.shadowBlur}px ${theme.shadowColor}`;
}

function buildTextAnimations(duration: number, subtle = false): RenderAnimation[] {
  const config = getRenderLayoutConfig().motion.textSlide;
  const animationDuration = clamp(
    duration * config.durationRatio,
    config.minDuration,
    subtle ? Math.min(config.maxDuration, 0.5) : config.maxDuration
  );

  return [
    {
      time: 0,
      duration: Number(Math.min(animationDuration * 0.72, animationDuration).toFixed(2)),
      type: "fade",
    },
    {
      time: 0,
      duration: Number(animationDuration.toFixed(2)),
      easing: "quadratic-out",
      type: "text-slide",
      scope: "split-clip",
      split: subtle ? "line" : "line",
      overlap: "100%",
      direction: "up",
      background_effect: "scaling-clip",
    },
  ];
}

function buildAssetFadeAnimations(duration: number) {
  const config = getRenderLayoutConfig().motion.assetFade;
  const animationDuration = clamp(
    duration * config.durationRatio,
    config.minDuration,
    config.maxDuration
  );

  return [
    {
      time: 0,
      duration: Number(animationDuration.toFixed(2)),
      type: "fade",
    },
  ] as RenderAnimation[];
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function assetUrl(assetBaseUrl: string, key: string): string {
  if (!key) return "";
  const normalizedBase = assetBaseUrl.replace(/\/$/, "");
  return `${normalizedBase}/${key
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/")}`;
}

export function buildDefaultClosingScreens(
  parsed: ParsedBrief
): ParsedClosingScreen[] {
  const defaults = getRenderLayoutConfig().closingDefaults;
  return (["accolade", "testimonial", "endcard"] as ClosingScreenKind[]).map((kind) => {
    const detectedKey = parsed.detectedClosingScreenKeys?.[kind];
    const detectedDuration =
      detectedKey && parsed.screenDurations[detectedKey]
        ? parsed.screenDurations[detectedKey]
        : undefined;
    return {
      kind,
      duration: detectedDuration ?? defaults[kind].duration,
      header: defaults[kind].header,
      body: defaults[kind].body,
    };
  });
}

export function buildDefaultContentScreens(
  screens: Record<string, { header?: string; body?: string; disclaimer?: string }>,
  screenDurations: Record<string, number>,
  ignoredKeys: Set<string>
): ParsedContentScreen[] {
  return Object.entries(screens)
    .filter(([key]) => key !== "1" && !ignoredKeys.has(key))
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([key, screen]) => ({
      key,
      duration: screenDurations[key] ?? 3,
      header: screen.header,
      body: screen.body,
      disclaimer: screen.disclaimer,
    }));
}
