import { AutoRouter, cors, json, error, type IRequest } from "itty-router";
import type { Env, ParseBriefRequest, CreatomateWebhookPayload } from "./types";
import { parseBrief, computeVideoCount } from "./parser";
import { createRenderJobs } from "./jobs";
import { handleWebhook, sendNotification } from "./webhook";
import { listAssets, getUploadUrl, uploadAsset } from "./assets";

const { preflight, corsify } = cors();

const router = AutoRouter<IRequest, [Env]>({
  before: [preflight],
  finally: [corsify],
});

// ─── Parse Brief ─────────────────────────────────────────────────
router.post("/parseBrief", async (request, env) => {
  const body = (await request.json()) as ParseBriefRequest;

  if (!body.brief || typeof body.brief !== "string") {
    return error(400, "Missing or invalid 'brief' field");
  }

  const parsed = parseBrief(body);
  const videoCount = computeVideoCount(parsed);

  return json({
    parsed,
    summary: {
      campaignId: parsed.campaign_id,
      variantCount: parsed.variants.length,
      backgroundCount: parsed.backgrounds.length,
      sizeCount: parsed.sizes.length,
      totalVideos: videoCount,
    },
  });
});

// ─── Create Jobs ─────────────────────────────────────────────────
router.post("/createJobs", async (request, env) => {
  const body = (await request.json()) as {
    parsed: ReturnType<typeof parseBrief>;
    r2PublicUrl?: string;
  };

  if (!body.parsed || !body.parsed.campaign_id) {
    return error(400, "Missing parsed brief data");
  }

  const workerDomain = new URL(request.url).origin;
  const r2PublicUrl =
    body.r2PublicUrl ?? `${workerDomain}/assets/public`;

  const result = await createRenderJobs(
    body.parsed,
    env,
    workerDomain,
    r2PublicUrl
  );

  return json({
    campaignId: body.parsed.campaign_id,
    totalJobs: result.jobs.length,
    rendering: result.jobs.filter((j) => j.status === "rendering").length,
    failed: result.jobs.filter((j) => j.status === "failed").length,
    errors: result.errors,
  });
});

// ─── Webhook (Creatomate callback) ──────────────────────────────
router.post("/webhook", async (request, env) => {
  const payload = (await request.json()) as CreatomateWebhookPayload;

  if (!payload.id || !payload.status) {
    return error(400, "Invalid webhook payload");
  }

  const { allDone, campaignId } = await handleWebhook(payload, env);

  if (allDone && campaignId) {
    // Fire notification asynchronously
    await sendNotification(campaignId, env);
  }

  return json({ received: true });
});

// ─── Assets: List ────────────────────────────────────────────────
router.get("/assets", async (request, env) => {
  const url = new URL(request.url);
  const prefix = url.searchParams.get("prefix") ?? undefined;
  const assets = await listAssets(env, prefix);
  return json({ assets });
});

// ─── Assets: Get upload URL ──────────────────────────────────────
router.post("/assets/uploadUrl", async (request, env) => {
  const body = (await request.json()) as { key: string };

  if (!body.key) {
    return error(400, "Missing 'key' field");
  }

  const result = await getUploadUrl(env, body.key);
  return json(result);
});

// ─── Assets: Upload (proxy PUT) ──────────────────────────────────
router.put("/assets/upload/:key", async (request, env) => {
  const key = decodeURIComponent(request.params.key);
  const contentType =
    request.headers.get("content-type") ?? "application/octet-stream";

  if (!request.body) {
    return error(400, "No file body provided");
  }

  await uploadAsset(env, key, request.body, contentType);
  return json({ uploaded: key });
});

// ─── Assets: Serve public files ──────────────────────────────────
router.get("/assets/public/:key+", async (request, env) => {
  const key = decodeURIComponent(request.params.key);
  const obj = await env.R2_ASSETS.get(key);

  if (!obj) {
    return error(404, "Asset not found");
  }

  const headers = new Headers();
  headers.set(
    "Content-Type",
    obj.httpMetadata?.contentType ?? "application/octet-stream"
  );
  headers.set("Cache-Control", "public, max-age=86400");

  return new Response(obj.body, { headers });
});

// ─── Campaign status ─────────────────────────────────────────────
router.get("/campaign/:id", async (request, env) => {
  const campaignId = request.params.id;
  const summaryData = await env.KV_JOBS.get(`campaign:${campaignId}`);

  if (!summaryData) {
    return error(404, "Campaign not found");
  }

  const summary = JSON.parse(summaryData);
  return json(summary);
});

// ─── Catch-all ───────────────────────────────────────────────────
router.all("*", () => error(404, "Not found"));

export default {
  fetch: router.fetch,
} satisfies ExportedHandler<Env>;
