import { AutoRouter, cors, json, error, type IRequest } from "itty-router";
import { getAssetFromKV } from "@cloudflare/kv-asset-handler";
// @ts-expect-error — virtual module injected by wrangler at build time
import manifestJSON from "__STATIC_CONTENT_MANIFEST";
import type { Env, ParseBriefRequest, CreatomateWebhookPayload } from "./types";
import { parseBrief, computeVideoCount, computeTotalDuration } from "./parser";
import { createRenderJobs } from "./jobs";
import { handleWebhook, sendNotification } from "./webhook";
import { listAssets, getUploadUrl, uploadAsset } from "./assets";
import { buildRichTextSvg, decodeRichTextPayload } from "./rich-text";

const { preflight, corsify } = cors();

const router = AutoRouter<IRequest, [Env, ExecutionContext]>({
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
      totalDuration: computeTotalDuration(parsed),
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

// ─── Rich text SVG rendering ─────────────────────────────────────
router.get("/rich-text.svg", (request) => {
  const url = new URL(request.url);
  const encodedPayload = url.searchParams.get("payload");

  if (!encodedPayload) {
    return error(400, "Missing rich text payload");
  }

  const payload = decodeRichTextPayload(encodedPayload);
  const svg = buildRichTextSvg(payload);

  return new Response(svg, {
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": "public, max-age=86400",
    },
  });
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

// ─── Export with static asset fallback ───────────────────────────
export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ): Promise<Response> {
    const url = new URL(request.url);

    // API routes handled by the router
    const apiPrefixes = [
      "/parseBrief",
      "/createJobs",
      "/webhook",
      "/assets",
      "/rich-text.svg",
      "/campaign",
    ];
    if (apiPrefixes.some((p) => url.pathname.startsWith(p))) {
      return router.fetch(request, env, ctx);
    }

    // Everything else: serve static assets from Workers Sites KV
    const assetManifest = JSON.parse(manifestJSON);
    try {
      return await getAssetFromKV(
        { request, waitUntil: ctx.waitUntil.bind(ctx) },
        { ASSET_NAMESPACE: env.__STATIC_CONTENT, ASSET_MANIFEST: assetManifest }
      );
    } catch {
      // If no static asset found, fall back to index.html (SPA)
      try {
        const indexReq = new Request(
          new URL("/index.html", request.url).toString(),
          request
        );
        return await getAssetFromKV(
          { request: indexReq, waitUntil: ctx.waitUntil.bind(ctx) },
          { ASSET_NAMESPACE: env.__STATIC_CONTENT, ASSET_MANIFEST: assetManifest }
        );
      } catch {
        return new Response("Not found", { status: 404 });
      }
    }
  },
} satisfies ExportedHandler<Env>;
