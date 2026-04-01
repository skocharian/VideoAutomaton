export type RenderSize = "9:16" | "4:5";

export type ClosingScreenKind = "accolade" | "testimonial" | "endcard";

export type BackgroundAnalysisStatus = "missing" | "pending" | "temporary" | "ready";

export type BackgroundAnalysisSource = "pending" | "browser-temporary" | "canonical";

export type ThemeStyleId =
  | "white"
  | "white-shadow"
  | "white-scrim"
  | "navy"
  | "navy-scrim";

export type AnalysisRegionKey =
  | "content-header"
  | "content-body"
  | "content-disclaimer"
  | "closing-accolade-body"
  | "closing-testimonial-header"
  | "closing-testimonial-body"
  | "closing-endcard-header"
  | "closing-endcard-body";

export interface Env {
  CREATOMATE_API_KEY: string;
  NOTIFY_WEBHOOK_URL: string;
  KV_JOBS: KVNamespace;
  R2_ASSETS: R2Bucket;
  __STATIC_CONTENT: KVNamespace;
  BACKGROUND_ANALYZER?: DurableObjectNamespace;
  R2_ACCOUNT_ID?: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
  R2_BUCKET_NAME?: string;
}

export interface Variant {
  id: string;
  headline: string;
  subheadline: string;
}

export interface ScreenText {
  header?: string;
  body?: string;
  disclaimer?: string;
}

export interface TextLayerOverride {
  fontSize?: number;
  color?: string;
  x?: string;
  y?: string;
}

export interface ParsedContentScreen extends ScreenText {
  key: string;
  duration: number;
}

export interface ParsedClosingScreen extends ScreenText {
  kind: ClosingScreenKind;
  duration: number;
}

export interface BackgroundAnalysisRef {
  key: string;
  artifactKey: string;
  status: BackgroundAnalysisStatus;
  source?: BackgroundAnalysisSource;
  updatedAt?: string;
}

export interface ParsedBrief {
  campaign_id: string;
  variants: Variant[];
  screens: Record<string, ScreenText>;
  contentScreens: ParsedContentScreen[];
  closingScreens: ParsedClosingScreen[];
  detectedClosingScreenKeys?: Partial<Record<ClosingScreenKind, string>>;
  textOverrides?: Record<string, TextLayerOverride>;
  screenDurations: Record<string, number>;
  backgrounds: string[];
  backgroundAnalysis?: Record<string, BackgroundAnalysisRef>;
  sizes: RenderSize[];
  audio: string;
  accolade: string;
  badge: string;
  logo: string;
  novelty?: string[];
}

export interface ParseBriefRequest {
  brief: string;
  backgrounds: string[];
  sizes: RenderSize[];
  audio: string;
  accolade: string;
  badge: string;
  logo: string;
  novelty?: string[];
}

export interface RenderJob {
  jobId: string;
  campaignId: string;
  variantId: string;
  background: string;
  size: RenderSize;
  renderId?: string;
  status: "pending" | "rendering" | "completed" | "failed";
  finalUrl?: string;
  error?: string;
  createdAt: string;
}

export interface CampaignSummary {
  campaignId: string;
  totalJobs: number;
  completed: number;
  failed: number;
  jobIds: string[];
  createdAt: string;
}

export type RenderElement = {
  [key: string]: RenderValue;
} & {
  type: string;
  name?: string;
  track?: number;
  time?: number;
  duration?: number;
};

export interface RenderScriptDocument {
  output_format: "mp4";
  width: number;
  height: number;
  duration: number;
  frame_rate?: number;
  elements: RenderElement[];
}

export interface CreatomateRenderRequest extends RenderScriptDocument {
  webhook_url: string;
  metadata: string;
}

export interface CreatomateWebhookPayload {
  id: string;
  status: "succeeded" | "failed";
  url?: string;
  error_message?: string;
  metadata?: string;
}

export interface RegionMetrics {
  avgLuminance: number;
  variance: number;
  brightRatio: number;
  darkRatio: number;
  detail: number;
}

export interface BackgroundAnalysisFrame {
  sourceTime: number;
  regions: Partial<Record<AnalysisRegionKey, RegionMetrics>>;
}

export interface BackgroundAnalysisSize {
  sampleTimes: number[];
  crop: {
    sourceX: number;
    sourceY: number;
    sourceWidth: number;
    sourceHeight: number;
  };
  frames: BackgroundAnalysisFrame[];
  defaultSuggestions?: Partial<Record<AnalysisRegionKey, ThemeStyleId>>;
}

export interface BackgroundAnalysisArtifact {
  version: 1;
  assetKey: string;
  status: Exclude<BackgroundAnalysisStatus, "missing">;
  source: BackgroundAnalysisSource;
  updatedAt: string;
  sourceDuration?: number;
  sourceWidth?: number;
  sourceHeight?: number;
  sizes: Partial<Record<RenderSize, BackgroundAnalysisSize>>;
}

export interface ThemeSuggestion {
  styleId: ThemeStyleId;
  fillColor: string;
  shadowColor: string;
  shadowBlur: number;
  shadowY: number;
  scrimColor?: string;
  scrimOpacity?: number;
}

export interface ScreenThemeSuggestion {
  header?: ThemeSuggestion;
  body?: ThemeSuggestion;
  disclaimer?: ThemeSuggestion;
}

export interface PreviewLayer {
  key: string;
  type: "text" | "image" | "shape";
  x: string;
  y: string;
  width: string;
  height: string;
  xAnchor?: string;
  yAnchor?: string;
  xAlignment?: string;
  yAlignment?: string;
  text?: string;
  src?: string;
  color?: string;
  opacity?: string;
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: number | string;
  lineHeight?: string;
  textAlign?: "left" | "center";
  textShadow?: string;
  fit?: "contain" | "cover" | "fill";
  borderRadius?: string;
}

export interface PreviewSlide {
  id: string;
  displayIndex: number;
  sourceKey?: string;
  kind: "variant" | "content" | ClosingScreenKind;
  duration: number;
  layers: PreviewLayer[];
}

export interface PreviewModel {
  backgroundKey: string;
  backgroundUrl: string;
  size: RenderSize;
  totalDuration: number;
  analysisStatus: BackgroundAnalysisStatus;
  slides: PreviewSlide[];
}

export type RenderValue =
  | string
  | number
  | boolean
  | null
  | RenderValue[]
  | { [key: string]: RenderValue };
