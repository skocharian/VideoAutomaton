import type {
  Env,
  CreatomateWebhookPayload,
  RenderJob,
  CampaignSummary,
} from "./types";

export async function handleWebhook(
  payload: CreatomateWebhookPayload,
  env: Env
): Promise<{ allDone: boolean; campaignId: string | null }> {
  if (!payload.metadata) {
    return { allDone: false, campaignId: null };
  }

  const meta = JSON.parse(payload.metadata) as {
    campaignId: string;
    jobId: string;
  };

  // Update job record
  const jobKey = `job:${meta.campaignId}:${meta.jobId}`;
  const jobData = await env.KV_JOBS.get(jobKey);
  if (!jobData) {
    return { allDone: false, campaignId: meta.campaignId };
  }

  const job: RenderJob = JSON.parse(jobData);
  if (payload.status === "succeeded") {
    job.status = "completed";
    job.finalUrl = payload.url;
  } else {
    job.status = "failed";
    job.error = payload.error_message ?? "Unknown render error";
  }
  await env.KV_JOBS.put(jobKey, JSON.stringify(job));

  // Update campaign summary
  const summaryKey = `campaign:${meta.campaignId}`;
  const summaryData = await env.KV_JOBS.get(summaryKey);
  if (!summaryData) {
    return { allDone: false, campaignId: meta.campaignId };
  }

  const summary: CampaignSummary = JSON.parse(summaryData);

  // Count terminal states across all jobs
  let completed = 0;
  let failed = 0;
  for (const jobId of summary.jobIds) {
    const jData = await env.KV_JOBS.get(`job:${meta.campaignId}:${jobId}`);
    if (!jData) continue;
    const j: RenderJob = JSON.parse(jData);
    if (j.status === "completed") completed++;
    if (j.status === "failed") failed++;
  }

  summary.completed = completed;
  summary.failed = failed;
  await env.KV_JOBS.put(summaryKey, JSON.stringify(summary));

  const allDone = completed + failed >= summary.totalJobs;
  return { allDone, campaignId: meta.campaignId };
}

export async function sendNotification(
  campaignId: string,
  env: Env
): Promise<void> {
  const summaryData = await env.KV_JOBS.get(`campaign:${campaignId}`);
  if (!summaryData) return;

  const summary: CampaignSummary = JSON.parse(summaryData);

  // Gather completed video URLs
  const videoLines: string[] = [];
  for (const jobId of summary.jobIds) {
    const jData = await env.KV_JOBS.get(`job:${campaignId}:${jobId}`);
    if (!jData) continue;
    const job: RenderJob = JSON.parse(jData);
    if (job.status === "completed" && job.finalUrl) {
      videoLines.push(
        `- ${job.variantId} | ${job.size} | ${job.background || "default"}${formatBackgroundSpeed(job.backgroundSpeed)}: ${job.finalUrl}`
      );
    } else if (job.status === "failed") {
      videoLines.push(
        `- ${job.variantId} | ${job.size} | ${job.background || "default"}${formatBackgroundSpeed(job.backgroundSpeed)}: FAILED — ${job.error}`
      );
    }
  }

  const message = {
    text: [
      `*Campaign ${campaignId} — Rendering Complete*`,
      `Total: ${summary.totalJobs} | Completed: ${summary.completed} | Failed: ${summary.failed}`,
      "",
      ...videoLines,
    ].join("\n"),
  };

  await fetch(env.NOTIFY_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(message),
  });
}

function formatBackgroundSpeed(speed: number | undefined): string {
  if (!Number.isFinite(speed) || Number(speed) === 1) {
    return "";
  }

  return ` @ ${Number(speed).toFixed(2)}x`;
}
