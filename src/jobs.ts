import type {
  Env,
  ParsedBrief,
  RenderJob,
  CampaignSummary,
  CreatomateRenderRequest,
} from "./types";

/**
 * Build Creatomate modifications object from parsed brief.
 * Maps to template element names: S{n}_Header, S{n}_Body, S{n}_Disclaimer, Background, S11_Logo.
 * Screen 1 header/body come from the variant; all others from screens map.
 */
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

  if (parsed.logo) {
    mods["S11_Logo.source"] = `${r2PublicUrl}/${parsed.logo}`;
  }

  // Screen 1 — from variant headline/subheadline
  if (variant) {
    mods["S1_Header.text"] = variant.headline;
    mods["S1_Body.text"] = variant.subheadline;
  }

  // Remaining screens — dynamic, based on whatever the brief contained
  for (const [num, screen] of Object.entries(parsed.screens)) {
    if (num === "1") continue; // S1 handled by variant above

    if (screen.header) {
      mods[`S${num}_Header.text`] = screen.header;
    }
    if (screen.body) {
      mods[`S${num}_Body.text`] = screen.body;
    }
    if (screen.disclaimer) {
      mods[`S${num}_Disclaimer.text`] = screen.disclaimer;
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
