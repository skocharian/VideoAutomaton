import type {
  Env,
  ParsedBrief,
  RenderJob,
  CampaignSummary,
  CreatomateRenderRequest,
} from "./types";

export function buildModifications(
  parsed: ParsedBrief,
  variantIndex: number,
  background: string,
  r2PublicUrl: string
): Record<string, string> {
  const variant = parsed.variants[variantIndex];
  const mods: Record<string, string> = {};

  // Background
  if (background) {
    mods["Background.source"] = `${r2PublicUrl}/${background}`;
  }

  // Audio
  if (parsed.audio) {
    mods["Audio.source"] = `${r2PublicUrl}/${parsed.audio}`;
  }

  // Badge
  if (parsed.badge) {
    mods["Badge.source"] = `${r2PublicUrl}/${parsed.badge}`;
  }

  // Screen 1 — variant headline/subheadline
  if (variant) {
    mods["Screen1Headline.text"] = variant.headline;
    mods["Screen1Sub.text"] = variant.subheadline;
  }

  // Remaining screens
  for (const [key, value] of Object.entries(parsed.screens)) {
    // key is like "screen2", "screen3", etc.
    const num = key.replace("screen", "");
    if (num !== "1") {
      mods[`Screen${num}.text`] = value;
    }
  }

  // Novelty clip (first available)
  if (parsed.novelty && parsed.novelty.length > 0) {
    mods["NoveltyClip.source"] = `${r2PublicUrl}/${parsed.novelty[0]}`;
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
          r2PublicUrl
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

  // Store campaign summary
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
    // Rate limited — wait and retry once
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
    const data = (await retryResp.json()) as { id: string }[];
    return data[0].id;
  }

  if (!resp.ok) {
    throw new Error(`Creatomate API error: ${resp.status}`);
  }

  const data = (await resp.json()) as { id: string }[];
  return data[0].id;
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
