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
  getSafeZone,
  type LayoutImageConfig,
  type LayoutSafeZoneConfig,
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
  StyleProfile,
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
    const audioStartSeconds = Number.isFinite(parsed.audioStartSeconds)
      ? Math.max(0, Number(parsed.audioStartSeconds))
      : 0;
    elements.push({
      name: "Music",
      type: "audio",
      track: 90,
      time: 0,
      duration: totalDuration,
      source: assetUrl(assetBaseUrl, parsed.audio),
      trim_start: audioStartSeconds,
      trim_duration: totalDuration,
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
  const canvas = getCanvasSize(options.size);
  const safeZone = getSafeZone(options.size);
  const styleProfile = getEffectiveStyleProfile(
    options.parsed,
    options.backgroundKey,
    options.size
  );
  const isContent = screen.kind === "variant" || screen.kind === "content";
  const elementKeys = getElementKeys(screen);

  if (isContent) {
    const theme = suggestContentTheme(options.analysisArtifact, options.size, sampleTimes);
    const screenLayout = getContentLayouts(options.size);
    const layers: Array<PreviewLayer | RenderElement> = [];
    const headerOverride = getTextOverride(elementKeys.header, styleProfile.textOverrides);
    const bodyOverride = getTextOverride(elementKeys.body, styleProfile.textOverrides);
    const disclaimerOverride = getTextOverride(
      elementKeys.disclaimer,
      styleProfile.textOverrides
    );
    const contentLayouts = buildContentFlowLayouts(
      screenLayout,
      screen,
      elementKeys,
      styleProfile.textOverrides,
      canvas,
      safeZone
    );

    if (isScrimEnabled(screen.id, styleProfile)) {
      pushScrimLayer(
        layers,
        preview,
        `Scrim_${screen.id}`,
        screen.duration,
        screenLayout.scrim,
        theme,
        canvas
      );
    }
    pushPreparedTextLayer(
      layers,
      preview,
      elementKeys.header,
      screen.duration,
      5,
      contentLayouts.header,
      screen.header ?? "",
      resolveTheme(theme.header, headerOverride)
    );
    pushPreparedTextLayer(
      layers,
      preview,
      elementKeys.body,
      screen.duration,
      4,
      contentLayouts.body,
      screen.body ?? "",
      resolveTheme(theme.body, bodyOverride)
    );
    pushPreparedTextLayer(
      layers,
      preview,
      elementKeys.disclaimer,
      screen.duration,
      6,
      contentLayouts.disclaimer,
      screen.disclaimer ?? "",
      resolveTheme(theme.disclaimer, disclaimerOverride)
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
      const resolvedHeaderLayout = applyTextSafeZone(
        screenLayout.header,
        safeZone
      );
      const resolvedBodyLayout = applyTextSafeZone(
        screenLayout.body,
        safeZone
      );
      const resolvedImageLayout = applyImageSafeZone(
        screenLayout.image,
        safeZone
      );
      const headerText =
        options.parsed.accolade
          ? ""
          : !stripRichTextMarkup(screen.header ?? "").trim()
          ? getClosingDefaults("accolade").fallbackHeader ?? ""
          : screen.header ?? "";

      if (isScrimEnabled(screen.id, styleProfile)) {
        pushScrimLayer(
          layers,
          preview,
          `Scrim_${screen.id}`,
          screen.duration,
          screenLayout.scrim,
          theme,
          canvas
        );
      }
      pushImageLayer(
        layers,
        preview,
        elementKeys.image ?? "Closing_Accolade_Image",
        screen.duration,
        3,
        resolvedImageLayout,
        options.parsed.accolade
          ? assetUrl(options.assetBaseUrl, options.parsed.accolade)
          : ""
      );
      pushTextLayer(
        layers,
        preview,
        elementKeys.header,
        screen.duration,
        5,
        resolvedHeaderLayout,
        styleProfile.textOverrides,
        headerText,
        theme.header
      );
      pushTextLayer(
        layers,
        preview,
        elementKeys.body,
        screen.duration,
        4,
        resolvedBodyLayout,
        styleProfile.textOverrides,
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
      const resolvedHeaderLayout = applyTextSafeZone(
        screenLayout.header,
        safeZone
      );
      const resolvedBodyLayout = applyTextSafeZone(
        screenLayout.body,
        safeZone
      );

      if (isScrimEnabled(screen.id, styleProfile)) {
        pushScrimLayer(
          layers,
          preview,
          `Scrim_${screen.id}`,
          screen.duration,
          screenLayout.scrim,
          theme,
          canvas
        );
      }
      pushTextLayer(
        layers,
        preview,
        elementKeys.header,
        screen.duration,
        5,
        resolvedHeaderLayout,
        styleProfile.textOverrides,
        screen.header ?? "",
        theme.header
      );
      pushTextLayer(
        layers,
        preview,
        elementKeys.body,
        screen.duration,
        4,
        resolvedBodyLayout,
        styleProfile.textOverrides,
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
      const resolvedLogoLayout = applyImageSafeZone(
        screenLayout.logo,
        safeZone
      );
      const resolvedHeaderLayout = applyTextSafeZone(
        screenLayout.header,
        safeZone
      );
      const resolvedBodyLayout = applyTextSafeZone(
        screenLayout.body,
        safeZone
      );
      const resolvedBadgeLayout = applyImageSafeZone(
        screenLayout.badge,
        safeZone
      );

      if (isScrimEnabled(screen.id, styleProfile)) {
        pushScrimLayer(
          layers,
          preview,
          `Scrim_${screen.id}`,
          screen.duration,
          screenLayout.scrim,
          theme,
          canvas
        );
      }
      pushImageLayer(
        layers,
        preview,
        elementKeys.logo ?? "Closing_Endcard_Logo",
        screen.duration,
        3,
        resolvedLogoLayout,
        options.parsed.logo ? assetUrl(options.assetBaseUrl, options.parsed.logo) : ""
      );
      pushTextLayer(
        layers,
        preview,
        elementKeys.header,
        screen.duration,
        5,
        resolvedHeaderLayout,
        styleProfile.textOverrides,
        screen.header ?? "",
        theme.header
      );
      pushTextLayer(
        layers,
        preview,
        elementKeys.body,
        screen.duration,
        4,
        resolvedBodyLayout,
        styleProfile.textOverrides,
        screen.body ?? "",
        theme.body
      );
      pushImageLayer(
        layers,
        preview,
        elementKeys.badge ?? "Closing_Endcard_Badge",
        screen.duration,
        2,
        resolvedBadgeLayout,
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
  theme: ScreenThemeSuggestion,
  canvas: { width: number; height: number }
): void {
  const scrim = getPreferredScrim(theme);
  if (!scrim) return;

  layers.push(
    preview
      ? buildPreviewShapeLayer(key, layout, scrim)
      : buildRenderShapeElement(key, duration, layout, scrim, canvas)
  );
}

function pushTextLayer(
  layers: Array<PreviewLayer | RenderElement>,
  preview: boolean,
  key: string | undefined,
  duration: number,
  track: number,
  layout: LayoutTextConfig,
  overrides: ParsedBrief["textOverrides"] | undefined,
  text: string,
  theme: ThemeSuggestion | undefined
): void {
  if (!stripRichTextMarkup(text).trim()) return;

  const override = key ? overrides?.[key] : undefined;
  const resolvedLayout = resolveTextLayout(layout, override);
  pushPreparedTextLayer(
    layers,
    preview,
    key,
    duration,
    track,
    resolvedLayout,
    text,
    resolveTheme(theme, override)
  );
}

function pushPreparedTextLayer(
  layers: Array<PreviewLayer | RenderElement>,
  preview: boolean,
  key: string | undefined,
  duration: number,
  track: number,
  layout: LayoutTextConfig | undefined,
  text: string,
  theme: ThemeSuggestion | undefined
): void {
  if (!layout || !stripRichTextMarkup(text).trim()) return;

  layers.push(
    preview
      ? buildPreviewTextLayer(key, layout, text, theme)
      : buildRenderTextElement(key, duration, track, layout, text, theme)
  );
}

function pushImageLayer(
  layers: Array<PreviewLayer | RenderElement>,
  preview: boolean,
  key: string,
  duration: number,
  track: number,
  layout: LayoutImageConfig,
  src: string
): void {
  if (!src) return;

  layers.push(
    preview
      ? buildPreviewImageLayer(key, layout, src)
      : buildRenderImageElement(key, duration, track, layout, src)
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
  track: number,
  layout: LayoutTextConfig,
  text: string,
  theme: ThemeSuggestion | undefined
): RenderElement {
  const animations = buildTextAnimations(duration, layout.regionId === "content-disclaimer");
  return {
    ...(key ? { name: key } : {}),
    type: "text",
    track,
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
  track: number,
  layout: LayoutImageConfig,
  src: string
): RenderElement {
  return {
    name: key,
    type: "image",
    track,
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
  theme: ThemeSuggestion,
  canvas: { width: number; height: number }
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
    border_radius: convertBorderRadiusForRender(layout.border_radius, canvas),
    path: "M 0% 0% L 100% 0% L 100% 100% L 0% 100% Z",
    animations: buildAssetFadeAnimations(duration),
  };
}

function convertBorderRadiusForRender(
  borderRadius: string | undefined,
  canvas: { width: number; height: number }
): string {
  if (!borderRadius?.trim()) {
    return "0px";
  }

  const value = borderRadius.trim();
  if (!value.endsWith("%")) {
    return value;
  }

  const numeric = Number.parseFloat(value.slice(0, -1));
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return "0px";
  }

  const px = (Math.min(canvas.width, canvas.height) * numeric) / 100;
  return `${Math.round(px)}px`;
}

function getPreferredScrim(theme: ScreenThemeSuggestion): ThemeSuggestion | null {
  const suggestions = [theme.header, theme.body, theme.disclaimer].filter(
    (item): item is ThemeSuggestion => Boolean(item)
  );
  const scrimSuggestion = suggestions.find((item) => item?.scrimColor);
  return scrimSuggestion ?? null;
}

function buildContentFlowLayouts(
  screenLayout: ReturnType<typeof getContentLayouts>,
  screen: TimelineScreen,
  elementKeys: ElementKeys,
  overrides: ParsedBrief["textOverrides"] | undefined,
  canvas: { width: number; height: number },
  safeZone?: LayoutSafeZoneConfig
): {
  header?: LayoutTextConfig;
  body?: LayoutTextConfig;
  disclaimer?: LayoutTextConfig;
} {
  const headerText = screen.header ?? "";
  const bodyText = screen.body ?? "";
  const disclaimerText = screen.disclaimer ?? "";

  const headerOverride = getTextOverride(elementKeys.header, overrides);
  const bodyOverride = getTextOverride(elementKeys.body, overrides);
  const disclaimerOverride = getTextOverride(elementKeys.disclaimer, overrides);

  const header = applyTextSafeZone(
    resolveTextLayout(screenLayout.header, headerOverride),
    safeZone
  );
  const body = applyTextSafeZone(
    resolveTextLayout(screenLayout.body, bodyOverride),
    safeZone
  );
  const disclaimer = applyTextSafeZone(
    resolveTextLayout(screenLayout.disclaimer, disclaimerOverride),
    safeZone
  );

  const scrimTop = parsePercent(screenLayout.scrim.y);
  const safeTop = safeZone?.top ?? 0;
  const safeBottom = safeZone ? 100 - safeZone.bottom : 100;
  const mainTop = Math.max(scrimTop + 2.1, safeTop + 0.8);
  const gapPct = pixelsToPercent(Math.max(12, canvas.height * 0.012), canvas.height);
  const disclaimerReserve = stripRichTextMarkup(disclaimerText).trim()
    ? parsePercent(disclaimer.height) + gapPct + 0.8
    : 0;
  const mainBottom = Math.max(mainTop + 8, safeBottom - disclaimerReserve);

  let fittedHeader: LayoutTextConfig | undefined;
  let fittedBody: LayoutTextConfig | undefined;

  if (stripRichTextMarkup(headerText).trim()) {
    const headerY = hasYOverride(headerOverride)
      ? parsePercent(header.y)
      : Math.max(mainTop, parsePercent(header.y) - 0.8);
    const availableHeight = stripRichTextMarkup(bodyText).trim()
      ? Math.max(7, Math.min(mainBottom - headerY - 7, parsePercent(header.height) * 1.7))
      : Math.max(8, mainBottom - headerY);

    fittedHeader = fitTextToBox(
      {
        ...header,
        y: formatPercent(headerY),
        height: formatPercent(availableHeight),
      },
      headerText,
      canvas,
      {
        minScale: 0.66,
        minimumHeight: header.height,
      }
    );
  }

  if (stripRichTextMarkup(bodyText).trim()) {
    const bodyY = hasYOverride(bodyOverride)
      ? parsePercent(body.y)
      : fittedHeader
        ? parsePercent(fittedHeader.y) + parsePercent(fittedHeader.height) + gapPct
        : mainTop;
    const availableHeight = Math.max(8, mainBottom - Math.min(bodyY, mainBottom - 8));
    const boostedBody = !stripRichTextMarkup(headerText).trim()
      ? { ...body, font_size: Math.round(body.font_size * 1.08) }
      : body;

    fittedBody = fitTextToBox(
      {
        ...boostedBody,
        y: formatPercent(Math.min(bodyY, mainBottom - 8)),
        height: formatPercent(availableHeight),
      },
      bodyText,
      canvas,
      {
        minScale: stripRichTextMarkup(headerText).trim() ? 0.62 : 0.72,
        minimumHeight: body.height,
      }
    );
  }

  const fittedDisclaimer = stripRichTextMarkup(disclaimerText).trim()
    ? (() => {
        const disclaimerLayout = fitTextToBox(disclaimer, disclaimerText, canvas, {
          minScale: 0.9,
          minimumHeight: disclaimer.height,
        });
        const disclaimerHeight = parsePercent(disclaimerLayout.height);
        const disclaimerY = Math.max(
          fittedBody
            ? parsePercent(fittedBody.y) + parsePercent(fittedBody.height) + gapPct
            : mainTop,
          safeBottom - disclaimerHeight
        );

        return applyTextSafeZone(
          {
            ...disclaimerLayout,
            y: formatPercent(disclaimerY),
          },
          safeZone
        );
      })()
    : undefined;

  return {
    header: fittedHeader ? applyTextSafeZone(fittedHeader, safeZone) : undefined,
    body: fittedBody ? applyTextSafeZone(fittedBody, safeZone) : undefined,
    disclaimer: fittedDisclaimer,
  };
}

function fitTextToBox(
  layout: LayoutTextConfig,
  text: string,
  canvas: { width: number; height: number },
  options: {
    minScale?: number;
    minimumHeight?: string;
  } = {}
): LayoutTextConfig {
  const cleanText = stripRichTextMarkup(text);
  if (!cleanText.trim()) {
    return layout;
  }

  const widthPx = percentToPixels(layout.width, canvas.width);
  const maxHeightPx = percentToPixels(layout.height, canvas.height);
  const lineHeightRatio = parseLineHeight(layout.line_height);
  const minFont = Math.max(12, Math.round(layout.font_size * (options.minScale ?? 0.68)));
  const minimumHeightPx = options.minimumHeight
    ? percentToPixels(options.minimumHeight, canvas.height)
    : 0;
  let fontSize = layout.font_size;
  let textHeight = estimateTextHeight(
    cleanText,
    widthPx,
    fontSize,
    lineHeightRatio,
    layout.font_weight
  );

  while (fontSize > minFont && textHeight > maxHeightPx) {
    fontSize -= 1;
    textHeight = estimateTextHeight(
      cleanText,
      widthPx,
      fontSize,
      lineHeightRatio,
      layout.font_weight
    );
  }

  const paddedHeight = Math.min(
    maxHeightPx,
    Math.max(
      minimumHeightPx,
      textHeight + Math.max(fontSize * 0.58, fontSize * lineHeightRatio * 0.25)
    )
  );

  return {
    ...layout,
    font_size: fontSize,
    height: formatPercent(Math.max(pixelsToPercent(paddedHeight, canvas.height), 3.2)),
  };
}

function estimateTextHeight(
  text: string,
  widthPx: number,
  fontSize: number,
  lineHeightRatio: number,
  fontWeight: number
): number {
  const lines = estimateWrappedLineCount(text, widthPx, fontSize, fontWeight);
  return lines * fontSize * lineHeightRatio;
}

function estimateWrappedLineCount(
  text: string,
  widthPx: number,
  fontSize: number,
  fontWeight: number
): number {
  const avgCharWidth = fontSize * (fontWeight >= 700 ? 0.61 : 0.58);
  const maxCharsPerLine = Math.max(1, Math.floor(widthPx / avgCharWidth));

  return text
    .split("\n")
    .reduce((lineCount, paragraph) => {
      const trimmed = paragraph.trim();
      if (!trimmed) {
        return lineCount + 1;
      }

      let paragraphLines = 1;
      let currentLineLength = 0;

      for (const word of trimmed.split(/\s+/)) {
        const wordLength = word.length;
        if (!currentLineLength) {
          currentLineLength = wordLength;
          paragraphLines += Math.max(0, Math.ceil(wordLength / maxCharsPerLine) - 1);
          currentLineLength = Math.min(currentLineLength, maxCharsPerLine);
          continue;
        }

        if (currentLineLength + 1 + wordLength <= maxCharsPerLine) {
          currentLineLength += 1 + wordLength;
          continue;
        }

        paragraphLines += 1;
        currentLineLength = Math.min(wordLength, maxCharsPerLine);
        paragraphLines += Math.max(0, Math.ceil(wordLength / maxCharsPerLine) - 1);
      }

      return lineCount + paragraphLines;
    }, 0);
}

function applyTextSafeZone(
  layout: LayoutTextConfig,
  safeZone: LayoutSafeZoneConfig | undefined
): LayoutTextConfig {
  if (!safeZone) {
    return layout;
  }

  const bounds = getSafeZoneBox(layout, safeZone);

  return {
    ...layout,
    x: formatPercent(resolveAlignedCoordinate(bounds.left, bounds.width, layout.x_alignment)),
    y: formatPercent(resolveAlignedCoordinate(bounds.top, bounds.height, layout.y_alignment)),
    width: formatPercent(bounds.width),
    height: formatPercent(bounds.height),
  };
}

function applyImageSafeZone(
  layout: LayoutImageConfig,
  safeZone: LayoutSafeZoneConfig | undefined
): LayoutImageConfig {
  if (!safeZone) {
    return layout;
  }

  const bounds = getSafeZoneBox(layout, safeZone);

  return {
    ...layout,
    x: formatPercent(resolveAlignedCoordinate(bounds.left, bounds.width, layout.x_alignment)),
    y: formatPercent(resolveAlignedCoordinate(bounds.top, bounds.height, layout.y_alignment)),
    width: formatPercent(bounds.width),
    height: formatPercent(bounds.height),
  };
}

function getSafeZoneBox(
  layout: { x: string; y: string; width: string; height: string; x_alignment?: string; y_alignment?: string },
  safeZone: LayoutSafeZoneConfig
): {
  left: number;
  top: number;
  width: number;
  height: number;
} {
  const minLeft = safeZone.left;
  const minTop = safeZone.top;
  const maxRight = 100 - safeZone.right;
  const maxBottom = 100 - safeZone.bottom;

  const width = Math.min(parsePercent(layout.width), maxRight - minLeft);
  const height = Math.min(parsePercent(layout.height), maxBottom - minTop);

  const left = clamp(
    resolveAlignedStart(parsePercent(layout.x), width, layout.x_alignment),
    minLeft,
    maxRight - width
  );
  const top = clamp(
    resolveAlignedStart(parsePercent(layout.y), height, layout.y_alignment),
    minTop,
    maxBottom - height
  );

  return { left, top, width, height };
}

function resolveAlignedStart(value: number, size: number, alignment?: string): number {
  if (alignment === "50%") {
    return value - size / 2;
  }
  if (alignment === "100%") {
    return value - size;
  }
  return value;
}

function resolveAlignedCoordinate(
  start: number,
  size: number,
  alignment?: string
): number {
  if (alignment === "50%") {
    return start + size / 2;
  }
  if (alignment === "100%") {
    return start + size;
  }
  return start;
}

function getTextOverride(
  key: string | undefined,
  overrides: ParsedBrief["textOverrides"] | undefined
): TextLayerOverride | undefined {
  return key ? overrides?.[key] : undefined;
}

function getEffectiveStyleProfile(
  parsed: ParsedBrief,
  backgroundKey: string,
  size: RenderSize
): StyleProfile {
  const scopedKey = getStyleProfileKey(size, backgroundKey);
  const scopedProfile = scopedKey ? parsed.styleProfiles?.[scopedKey] : undefined;

  return {
    textOverrides: {
      ...(parsed.textOverrides ?? {}),
      ...(scopedProfile?.textOverrides ?? {}),
    },
    screenStyleOverrides: {
      ...(parsed.screenStyleOverrides ?? {}),
      ...(scopedProfile?.screenStyleOverrides ?? {}),
    },
  };
}

function getStyleProfileKey(size: RenderSize, backgroundKey: string): string | null {
  if (!backgroundKey) return null;
  return `${size}|${backgroundKey}`;
}

function isScrimEnabled(screenId: string, styleProfile: StyleProfile): boolean {
  return styleProfile.screenStyleOverrides?.[screenId]?.scrimEnabled !== false;
}

function hasYOverride(override: TextLayerOverride | undefined): boolean {
  return typeof override?.y === "string" && override.y.trim().length > 0;
}

function parseLineHeight(value: string | undefined): number {
  if (!value?.trim()) {
    return 1;
  }
  if (value.endsWith("%")) {
    const numeric = Number.parseFloat(value.slice(0, -1));
    if (Number.isFinite(numeric) && numeric > 0) {
      return numeric / 100;
    }
  }
  const numeric = Number.parseFloat(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 1;
}

function parsePercent(value: string): number {
  const numeric = Number.parseFloat(value.replace("%", ""));
  return Number.isFinite(numeric) ? numeric : 0;
}

function formatPercent(value: number): string {
  return `${Number(value.toFixed(2))}%`;
}

function percentToPixels(value: string, total: number): number {
  return (parsePercent(value) / 100) * total;
}

function pixelsToPercent(value: number, total: number): number {
  return (value / total) * 100;
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
