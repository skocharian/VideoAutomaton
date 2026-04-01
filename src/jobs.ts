import type {
  BackgroundAnalysisArtifact,
  CampaignSummary,
  CreatomateRenderRequest,
  Env,
  ParsedBrief,
  RenderJob,
  RenderSize,
} from "./types";
import { buildRenderScriptDocument } from "./render-plan";
import { readBackgroundAnalysis } from "./background-analysis";

export async function createRenderJobs(
  parsed: ParsedBrief,
  env: Env,
  workerDomain: string,
  r2PublicUrl: string
): Promise<{ jobs: RenderJob[]; errors: string[] }> {
  const jobs: RenderJob[] = [];
  const errors: string[] = [];
  const renderPromises: Promise<void>[] = [];
  const backgrounds = parsed.backgrounds.length > 0 ? parsed.backgrounds : [""];
  const variantIndices =
    parsed.variants.length > 0 ? parsed.variants.map((_, index) => index) : [0];
  const analysisCache = new Map<string, BackgroundAnalysisArtifact | null>();

  for (const variantIdx of variantIndices) {
    for (const background of backgrounds) {
      for (const size of parsed.sizes) {
        const jobId = generateJobId(parsed.campaign_id, variantIdx, background, size);
        const job: RenderJob = {
          jobId,
          campaignId: parsed.campaign_id,
          variantId: parsed.variants[variantIdx]?.id ?? "V0",
          background,
          size,
          status: "pending",
          createdAt: new Date().toISOString(),
        };

        const promise = (async () => {
          const analysisArtifact = await getCachedAnalysis(
            env,
            analysisCache,
            background
          );
          const renderDocument = buildRenderScriptDocument({
            parsed,
            variantIndex: variantIdx,
            backgroundKey: background,
            size,
            assetBaseUrl: r2PublicUrl,
            analysisArtifact,
          });

          const renderReq: CreatomateRenderRequest = {
            ...renderDocument,
            webhook_url: `${workerDomain}/webhook`,
            metadata: JSON.stringify({
              campaignId: parsed.campaign_id,
              jobId,
              variantId: job.variantId,
              size,
              background,
            }),
          };

          try {
            const renderId = await submitRender(renderReq, env);
            job.renderId = renderId;
            job.status = "rendering";
          } catch (error) {
            job.status = "failed";
            job.error = error instanceof Error ? error.message : String(error);
            errors.push(`${jobId}: ${job.error}`);
          }

          await storeJob(env, job);
          jobs.push(job);
        })();

        renderPromises.push(promise);
      }
    }
  }

  await Promise.all(renderPromises);

  const summary: CampaignSummary = {
    campaignId: parsed.campaign_id,
    totalJobs: jobs.length,
    completed: 0,
    failed: jobs.filter((job) => job.status === "failed").length,
    jobIds: jobs.map((job) => job.jobId),
    createdAt: new Date().toISOString(),
  };

  await env.KV_JOBS.put(`campaign:${parsed.campaign_id}`, JSON.stringify(summary));
  return { jobs, errors };
}

export async function storeJob(env: Env, job: RenderJob): Promise<void> {
  await env.KV_JOBS.put(
    `job:${job.campaignId}:${job.jobId}`,
    JSON.stringify(job)
  );
}

async function getCachedAnalysis(
  env: Env,
  cache: Map<string, BackgroundAnalysisArtifact | null>,
  background: string
): Promise<BackgroundAnalysisArtifact | null> {
  if (!background) return null;
  if (cache.has(background)) {
    return cache.get(background) ?? null;
  }

  const artifact = await readBackgroundAnalysis(env, background);
  cache.set(background, artifact);
  return artifact;
}

async function submitRender(
  renderReq: CreatomateRenderRequest,
  env: Env
): Promise<string> {
  const headers = {
    Authorization: `Bearer ${env.CREATOMATE_API_KEY}`,
    "Content-Type": "application/json",
  };

  const response = await fetch("https://api.creatomate.com/v2/renders", {
    method: "POST",
    headers,
    body: JSON.stringify(renderReq),
  });

  if (response.status === 429) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const retryResponse = await fetch("https://api.creatomate.com/v2/renders", {
      method: "POST",
      headers,
      body: JSON.stringify(renderReq),
    });
    if (!retryResponse.ok) {
      throw new Error(`Creatomate API error: ${retryResponse.status}`);
    }
    const payload = (await retryResponse.json()) as { id: string } | { id: string }[];
    return Array.isArray(payload) ? payload[0].id : payload.id;
  }

  if (!response.ok) {
    throw new Error(`Creatomate API error: ${response.status}`);
  }

  const payload = (await response.json()) as { id: string } | { id: string }[];
  return Array.isArray(payload) ? payload[0].id : payload.id;
}

function generateJobId(
  campaignId: string,
  variantIdx: number,
  background: string,
  size: RenderSize
): string {
  const backgroundSlug = background
    ? background
        .split("/")
        .pop()
        ?.replace(/\.[a-z0-9]+$/i, "")
        .replace(/[^a-z0-9]+/gi, "-")
        .replace(/^-+|-+$/g, "")
        .toLowerCase() ?? "default"
    : "default";

  return `${campaignId}-v${variantIdx + 1}-${backgroundSlug}-${size.replace(":", "x")}`;
}
