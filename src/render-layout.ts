import renderConfigJson from "../config/render-config.json";
import type {
  AnalysisRegionKey,
  ClosingScreenKind,
  RenderSize,
} from "./types";

type LayoutTextConfig = {
  regionId: AnalysisRegionKey;
  x: string;
  y: string;
  width: string;
  height: string;
  x_anchor?: string;
  y_anchor?: string;
  x_alignment?: string;
  y_alignment?: string;
  font_family: string;
  font_size: number;
  font_weight: number;
  line_height: string;
  text_align: "left" | "center";
};

type LayoutImageConfig = {
  x: string;
  y: string;
  width: string;
  height: string;
  x_alignment?: string;
  y_alignment?: string;
  fit?: "contain" | "cover" | "fill";
};

type LayoutScrimConfig = {
  x: string;
  y: string;
  width: string;
  height: string;
  x_anchor?: string;
  y_anchor?: string;
  x_alignment?: string;
  y_alignment?: string;
  border_radius?: string;
};

type LayoutSizeConfig = {
  canvas: {
    width: number;
    height: number;
  };
  background: LayoutImageConfig;
  regions: {
    content: {
      scrim: LayoutScrimConfig;
      header: LayoutTextConfig;
      body: LayoutTextConfig;
      disclaimer: LayoutTextConfig;
    };
    accolade: {
      scrim: LayoutScrimConfig;
      image: LayoutImageConfig;
      header: LayoutTextConfig;
      body: LayoutTextConfig;
    };
    testimonial: {
      scrim: LayoutScrimConfig;
      header: LayoutTextConfig;
      body: LayoutTextConfig;
    };
    endcard: {
      scrim: LayoutScrimConfig;
      logo: LayoutImageConfig;
      header: LayoutTextConfig;
      body: LayoutTextConfig;
      badge: LayoutImageConfig;
    };
  };
};

type RenderLayoutConfig = {
  palette: Record<string, string>;
  sampleRatios: number[];
  fonts: {
    primary: string;
    wordmark: string;
  };
  closingDefaults: Record<
    ClosingScreenKind,
    {
      header: string;
      fallbackHeader?: string;
      body: string;
      duration: number;
    }
  >;
  motion: {
    compositionFade: {
      durationRatio: number;
      minDuration: number;
      maxDuration: number;
    };
    textSlide: {
      durationRatio: number;
      minDuration: number;
      maxDuration: number;
    };
    assetFade: {
      durationRatio: number;
      minDuration: number;
      maxDuration: number;
    };
  };
  sizes: Record<RenderSize, LayoutSizeConfig>;
};

const renderConfig = renderConfigJson as RenderLayoutConfig;

export function getRenderLayoutConfig(): RenderLayoutConfig {
  return renderConfig;
}

export function getRenderSizeConfig(size: RenderSize): LayoutSizeConfig {
  return renderConfig.sizes[size];
}

export function getCanvasSize(size: RenderSize): {
  width: number;
  height: number;
} {
  return getRenderSizeConfig(size).canvas;
}

export function getClosingDefaults(kind: ClosingScreenKind): {
  header: string;
  fallbackHeader?: string;
  body: string;
  duration: number;
} {
  return renderConfig.closingDefaults[kind];
}

export function getContentLayouts(size: RenderSize): LayoutSizeConfig["regions"]["content"] {
  return getRenderSizeConfig(size).regions.content;
}

export function getClosingLayouts(
  size: RenderSize,
  kind: "accolade"
): LayoutSizeConfig["regions"]["accolade"];
export function getClosingLayouts(
  size: RenderSize,
  kind: "testimonial"
): LayoutSizeConfig["regions"]["testimonial"];
export function getClosingLayouts(
  size: RenderSize,
  kind: "endcard"
): LayoutSizeConfig["regions"]["endcard"];
export function getClosingLayouts(
  size: RenderSize,
  kind: ClosingScreenKind
):
  | LayoutSizeConfig["regions"]["accolade"]
  | LayoutSizeConfig["regions"]["testimonial"]
  | LayoutSizeConfig["regions"]["endcard"] {
  return getRenderSizeConfig(size).regions[kind];
}

export type {
  LayoutImageConfig,
  LayoutScrimConfig,
  LayoutSizeConfig,
  LayoutTextConfig,
  RenderLayoutConfig,
};
