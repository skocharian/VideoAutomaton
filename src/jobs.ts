import type {
  Env,
  ModificationValue,
  ParsedBrief,
  RenderJob,
  CampaignSummary,
  CreatomateRenderRequest,
  TextLayerOverride,
} from "./types";
import { computeTotalDuration } from "./parser";
import {
  stripRichTextMarkup,
} from "./rich-text";
import {
  getTemplateElementLayout,
} from "./template-layout";

/**
 * Build Creatomate modifications object from parsed brief.
 * Maps to template element names:
 * S{n}_Header, S{n}_Body, S{n}_Disclaimer, Background.
 * Image/audio extras are injected dynamically using `elements.add`.
 * Screen 1 header/body come from the variant; all others from screens map.
 */
export function buildModifications(
  parsed: ParsedBrief,
  variantIndex: number,
  background: string,
  r2PublicUrl: string,
  workerDomain = "",
  size = "9:16"
): Record<string, ModificationValue> {
  const variant = parsed.variants[variantIndex];
  const mods: Record<string, ModificationValue> = {};
  const addedElements: ModificationValue[] = [];
  const timeline = buildScreenTimeline(parsed);
  const totalDuration = computeTotalDuration(parsed);

  initializeDynamicTextLayers(mods);

  mods["duration"] = totalDuration;

  // Background
  if (background) {
    mods["Background.source"] = `${r2PublicUrl}/${background}`;
  }
  mods["Background.duration"] = totalDuration;
  if (parsed.audio) {
    mods["Background.volume"] = "0%";
  }

  // Screen 1 — from variant headline/subheadline
  if (variant && timeline["1"]) {
    setElementTiming(mods, "S1_Header", timeline["1"]);
    setElementTiming(mods, "S1_Body", timeline["1"]);
    applyTextLayerModifications(
      mods,
      addedElements,
      "S1_Header",
      variant.headline,
      timeline["1"],
      workerDomain,
      size,
      parsed
    );
    applyTextLayerModifications(
      mods,
      addedElements,
      "S1_Body",
      variant.subheadline,
      timeline["1"],
      workerDomain,
      size,
      parsed
    );
  }

  // Remaining screens — dynamic, based on whatever the brief contained
  for (const [num, screen] of Object.entries(parsed.screens)) {
    if (num === "1") continue; // S1 handled by variant above
    const timing = timeline[num];
    if (!timing) continue;

    const headerText = num === "11" ? screen.header ?? "Breethe" : screen.header;

    if (headerText && !(num === "9" && parsed.accolade)) {
      setElementTiming(mods, `S${num}_Header`, timing);
      applyTextLayerModifications(
        mods,
        addedElements,
        `S${num}_Header`,
        headerText,
        timing,
        workerDomain,
        size,
        parsed
      );
    }
    if (screen.body) {
      setElementTiming(mods, `S${num}_Body`, timing);
      applyTextLayerModifications(
        mods,
        addedElements,
        `S${num}_Body`,
        screen.body,
        timing,
        workerDomain,
        size,
        parsed
      );
    }
    if (screen.disclaimer) {
      setElementTiming(mods, `S${num}_Disclaimer`, timing);
      applyTextLayerModifications(
        mods,
        addedElements,
        `S${num}_Disclaimer`,
        screen.disclaimer,
        timing,
        workerDomain,
        size,
        parsed
      );
    }

    if (num === "9" && parsed.accolade) {
      const accoladeElement = createDynamicImageElement(
        "S9_Accolade",
        `${r2PublicUrl}/${parsed.accolade}`,
        timing,
        size
      );
      if (accoladeElement) {
        addedElements.push(accoladeElement);
      }
    }

    if (num === "11") {
      if (!screen.header) {
        setElementTiming(mods, "S11_Header", timing);
        applyTextLayerModifications(
          mods,
          addedElements,
          "S11_Header",
          "Breethe",
          timing,
          workerDomain,
          size,
          parsed
        );
      }

      if (parsed.logo) {
        const logoElement = createDynamicImageElement(
          "S11_Logo",
          `${r2PublicUrl}/${parsed.logo}`,
          timing,
          size
        );
        if (logoElement) {
          addedElements.push(logoElement);
        }
      }

      if (parsed.badge) {
        const badgeElement = createDynamicImageElement(
          "S11_Badge",
          `${r2PublicUrl}/${parsed.badge}`,
          timing,
          size
        );
        if (badgeElement) {
          addedElements.push(badgeElement);
        }
      }
    }
  }

  // Novelty clip (first available)
  if (parsed.novelty && parsed.novelty.length > 0) {
    mods["NoveltyClip.source"] = `${r2PublicUrl}/${parsed.novelty[0]}`;
    mods["NoveltyClip.time"] = 0;
    mods["NoveltyClip.duration"] = totalDuration;
    mods["NoveltyClip.volume"] = "0%";
  }

  if (parsed.audio) {
    addedElements.push({
      name: "Music_Dynamic",
      type: "audio",
      track: 90,
      time: 0,
      duration: totalDuration,
      source: `${r2PublicUrl}/${parsed.audio}`,
    });
  }

  if (addedElements.length > 0) {
    mods["elements.add"] = addedElements;
  }

  return mods;
}

export function getTemplateId(size: string, env: Env): string {
  if (size === "4:5") return env.TEMPLATE_4X5_ID;
  return env.TEMPLATE_9X16_ID;
}

export async function createRenderJobs(
  parsed: ParsedBrief,
  env: Env,
  workerDomain: string,
  r2PublicUrl: string
): Promise<{ jobs: RenderJob[]; errors: string[] }> {
  const jobs: RenderJob[] = [];
  const errors: string[] = [];
  const renderPromises: Promise<void>[] = [];

  const backgrounds =
    parsed.backgrounds.length > 0 ? parsed.backgrounds : [""];
  const variantIndices =
    parsed.variants.length > 0
      ? parsed.variants.map((_, i) => i)
      : [0];

  for (const variantIdx of variantIndices) {
    for (const bg of backgrounds) {
      for (const size of parsed.sizes) {
        const jobId = generateJobId(parsed.campaign_id, variantIdx, bg, size);
        const job: RenderJob = {
          jobId,
          campaignId: parsed.campaign_id,
          variantId: parsed.variants[variantIdx]?.id ?? "V0",
          background: bg,
          size,
          status: "pending",
          createdAt: new Date().toISOString(),
        };

        const modifications = buildModifications(
          parsed,
          variantIdx,
          bg,
          r2PublicUrl,
          workerDomain,
          size
        );
        const templateId = getTemplateId(size, env);
        const metadata = JSON.stringify({
          campaignId: parsed.campaign_id,
          jobId,
          variantId: job.variantId,
          size,
          background: bg,
        });

        const renderReq: CreatomateRenderRequest = {
          template_id: templateId,
          modifications,
          webhook_url: `${workerDomain}/webhook`,
          metadata,
        };

        const promise = submitRender(renderReq, env)
          .then(async (renderId) => {
            job.renderId = renderId;
            job.status = "rendering";
            await storeJob(env, job);
            jobs.push(job);
          })
          .catch(async (err) => {
            job.status = "failed";
            job.error = err instanceof Error ? err.message : String(err);
            await storeJob(env, job);
            jobs.push(job);
            errors.push(`${jobId}: ${job.error}`);
          });

        renderPromises.push(promise);
      }
    }
  }

  await Promise.all(renderPromises);

  const summary: CampaignSummary = {
    campaignId: parsed.campaign_id,
    totalJobs: jobs.length,
    completed: 0,
    failed: jobs.filter((j) => j.status === "failed").length,
    jobIds: jobs.map((j) => j.jobId),
    createdAt: new Date().toISOString(),
  };
  await env.KV_JOBS.put(
    `campaign:${parsed.campaign_id}`,
    JSON.stringify(summary)
  );

  return { jobs, errors };
}

type ScreenTiming = {
  time: number;
  duration: number;
};

function buildScreenTimeline(parsed: ParsedBrief): Record<string, ScreenTiming> {
  const orderedScreens = [
    ...(parsed.variants.length > 0 ? ["1"] : []),
    ...Object.keys(parsed.screens)
      .filter((num) => num !== "1")
      .sort((a, b) => Number(a) - Number(b)),
  ];

  const timeline: Record<string, ScreenTiming> = {};
  let cursor = 0;

  for (const num of orderedScreens) {
    const duration = parsed.screenDurations[num] ?? 3;
    timeline[num] = {
      time: Number(cursor.toFixed(2)),
      duration,
    };
    cursor += duration;
  }

  return timeline;
}

function initializeDynamicTextLayers(
  mods: Record<string, ModificationValue>
): void {
  for (let index = 1; index <= 11; index += 1) {
    mods[`S${index}_Header.text`] = "";
    mods[`S${index}_Body.text`] = "";
    if (index >= 2) {
      mods[`S${index}_Disclaimer.text`] = "";
    }
  }
}

function setElementTiming(
  mods: Record<string, ModificationValue>,
  elementName: string,
  timing: ScreenTiming
): void {
  mods[`${elementName}.time`] = timing.time;
  mods[`${elementName}.duration`] = timing.duration;
}

function applyTextLayerModifications(
  mods: Record<string, ModificationValue>,
  addedElements: ModificationValue[],
  elementName: string,
  text: string,
  timing: ScreenTiming,
  workerDomain: string,
  size: string,
  parsed?: ParsedBrief
): void {
  void workerDomain;
  const strippedText = stripRichTextMarkup(text).trim();

  if (!strippedText) {
    mods[`${elementName}.text`] = "";
    return;
  }

  mods[`${elementName}.text`] = strippedText;
  applyTextLayerOverrides(mods, elementName, parsed?.textOverrides?.[elementName]);
}

function applyTextLayerOverrides(
  mods: Record<string, ModificationValue>,
  elementName: string,
  override: TextLayerOverride | undefined
): void {
  if (!override) return;

  if (Number.isFinite(override.fontSize) && Number(override.fontSize) > 0) {
    mods[`${elementName}.font_size`] = Number(override.fontSize);
  }

  if (typeof override.color === "string" && override.color.trim()) {
    mods[`${elementName}.fill_color`] = override.color.trim();
  }

  if (typeof override.x === "string" && override.x.trim()) {
    mods[`${elementName}.x`] = override.x.trim();
  }

  if (typeof override.y === "string" && override.y.trim()) {
    mods[`${elementName}.y`] = override.y.trim();
  }
}

function createDynamicImageElement(
  elementName: string,
  source: string,
  timing: ScreenTiming,
  size: string
): ModificationValue | null {
  const layout = getTemplateElementLayout(elementName, size);
  if (!layout) return null;

  return {
    name: `${elementName}_Dynamic`,
    type: "image",
    track: Number(layout.track ?? 10) + 10,
    time: timing.time,
    duration: timing.duration,
    x: pickLayoutValue(layout.x, "50%"),
    y: pickLayoutValue(layout.y, "50%"),
    ...(pickOptionalLayoutValue(layout.x_anchor) !== undefined
      ? { x_anchor: pickOptionalLayoutValue(layout.x_anchor) }
      : {}),
    ...(pickOptionalLayoutValue(layout.y_anchor) !== undefined
      ? { y_anchor: pickOptionalLayoutValue(layout.y_anchor) }
      : {}),
    width: pickLayoutValue(layout.width, "30%"),
    height: pickLayoutValue(layout.height, "10%"),
    x_alignment: pickLayoutValue(layout.x_alignment, "50%"),
    y_alignment: pickLayoutValue(layout.y_alignment, "50%"),
    fit: typeof layout.fit === "string" ? layout.fit : "contain",
    source,
  };
}


function pickLayoutValue(
  value: unknown,
  fallback: string | number
): string | number {
  if (typeof value === "string" || typeof value === "number") {
    return value;
  }

  return fallback;
}


function pickOptionalLayoutValue(
  value: unknown
): string | number | undefined {
  if (typeof value === "string" || typeof value === "number") {
    return value;
  }

  return undefined;
}

function toPixels(value: unknown, baseSize: number): number {
  if (typeof value === "number") return value;
  if (typeof value !== "string") return baseSize;

  const trimmed = value.trim();
  if (trimmed.endsWith("%")) {
    return Math.round((baseSize * Number.parseFloat(trimmed)) / 100);
  }
  if (trimmed.endsWith("px")) {
    return Math.round(Number.parseFloat(trimmed));
  }

  const parsed = Number.parseFloat(trimmed);
  return Number.isFinite(parsed) ? Math.round(parsed) : baseSize;
}

async function submitRender(
  renderReq: CreatomateRenderRequest,
  env: Env
): Promise<string> {
  const resp = await fetch("https://api.creatomate.com/v2/renders", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.CREATOMATE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(renderReq),
  });

  if (resp.status === 429) {
    await new Promise((r) => setTimeout(r, 2000));
    const retryResp = await fetch("https://api.creatomate.com/v2/renders", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.CREATOMATE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(renderReq),
    });
    if (!retryResp.ok) {
      throw new Error(`Creatomate API error: ${retryResp.status}`);
    }
    const data = (await retryResp.json()) as { id: string } | { id: string }[];
    return Array.isArray(data) ? data[0].id : data.id;
  }

  if (!resp.ok) {
    throw new Error(`Creatomate API error: ${resp.status}`);
  }

  const data = (await resp.json()) as { id: string } | { id: string }[];
  return Array.isArray(data) ? data[0].id : data.id;
}

export async function storeJob(env: Env, job: RenderJob): Promise<void> {
  await env.KV_JOBS.put(
    `job:${job.campaignId}:${job.jobId}`,
    JSON.stringify(job)
  );
}

function generateJobId(
  campaignId: string,
  variantIdx: number,
  bg: string,
  size: string
): string {
  const bgSlug = bg
    ? bg.replace(/[^a-zA-Z0-9]/g, "").slice(0, 10)
    : "nobg";
  const sizeSlug = size.replace(":", "x");
  return `${campaignId}-V${variantIdx + 1}-${bgSlug}-${sizeSlug}`;
}
