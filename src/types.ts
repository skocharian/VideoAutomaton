export interface Env {
  CREATOMATE_API_KEY: string;
  TEMPLATE_9X16_ID: string;
  TEMPLATE_4X5_ID: string;
  NOTIFY_WEBHOOK_URL: string;
  KV_JOBS: KVNamespace;
  R2_ASSETS: R2Bucket;
  __STATIC_CONTENT: KVNamespace;
}

export interface Variant {
  id: string;
  headline: string;
  subheadline: string;
}

/** Each screen can have a header, body, and/or extra fields */
export interface ScreenText {
  header?: string;
  body?: string;
  disclaimer?: string;
}

export interface ParsedBrief {
  campaign_id: string;
  variants: Variant[];
  /** Keyed by screen number: "1", "2", ... "11" */
  screens: Record<string, ScreenText>;
  backgrounds: string[];
  sizes: string[];
  audio: string;
  badge: string;
  novelty?: string[];
}

export interface ParseBriefRequest {
  brief: string;
  backgrounds: string[];
  sizes: string[];
  audio: string;
  badge: string;
  novelty?: string[];
}

export interface RenderJob {
  jobId: string;
  campaignId: string;
  variantId: string;
  background: string;
  size: string;
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

export interface CreatomateRenderRequest {
  template_id: string;
  modifications: Record<string, string>;
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
