import { AutoRouter, cors, error, json, type IRequest } from "itty-router";
import { getAssetFromKV } from "@cloudflare/kv-asset-handler";
// @ts-expect-error — virtual module injected by wrangler at build time
import manifestJSON from "__STATIC_CONTENT_MANIFEST";
import type {
  BackgroundAnalysisArtifact,
  CreatomateWebhookPayload,
  Env,
  ParseBriefRequest,
  PreviewModel,
  RenderSize,
} from "./types";
import { computeTotalDuration, computeVideoCount, parseBrief } from "./parser";
import { createRenderJobs } from "./jobs";
import { handleWebhook, sendNotification } from "./webhook";
import { getUploadUrl, listAssets, uploadAsset } from "./assets";
import { buildRichTextSvg, decodeRichTextPayload } from "./rich-text";
import {
  getBackgroundAnalysisRef,
  readBackgroundAnalysis,
  writeBackgroundAnalysis,
} from "./background-analysis";
import { buildPreviewModel } from "./render-plan";
import { getRenderLayoutConfig } from "./render-layout";

const { preflight, corsify } = cors();

const router = AutoRouter<IRequest, [Env, ExecutionContext]>({
  before: [preflight],
  finally: [corsify],
});

router.post("/parseBrief", async (request, env) => {
  const body = (await request.json()) as ParseBriefRequest;

  if (!body.brief || typeof body.brief !== "string") {
    return error(400, "Missing or invalid 'brief' field");
  }

  const parsed = parseBrief(body);
  parsed.backgroundAnalysis = await loadBackgroundAnalysisRefs(
    parsed.backgrounds,
    env
  );
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

router.post("/previewModel", async (request, env) => {
  const body = (await request.json()) as {
    parsed: ReturnType<typeof parseBrief>;
    variantIndex?: number;
    background?: string;
    size?: RenderSize;
    r2PublicUrl?: string;
  };

  if (!body.parsed?.campaign_id) {
    return error(400, "Missing parsed brief data");
  }

  const workerDomain = new URL(request.url).origin;
  const r2PublicUrl = body.r2PublicUrl ?? `${workerDomain}/assets/public`;
  const backgroundKey = body.background ?? body.parsed.backgrounds[0] ?? "";
  const size = body.size ?? body.parsed.sizes[0] ?? "9:16";
  const analysisArtifact = backgroundKey
    ? await readBackgroundAnalysis(env, backgroundKey)
    : null;

  const previewModel: PreviewModel = buildPreviewModel({
    parsed: body.parsed,
    variantIndex: body.variantIndex ?? 0,
    backgroundKey,
    size,
    assetBaseUrl: r2PublicUrl,
    analysisArtifact,
  });

  return json(previewModel);
});

router.get("/render-config", () => {
  return json(getRenderLayoutConfig());
});

router.post("/createJobs", async (request, env) => {
  const body = (await request.json()) as {
    parsed: ReturnType<typeof parseBrief>;
    r2PublicUrl?: string;
  };

  if (!body.parsed?.campaign_id) {
    return error(400, "Missing parsed brief data");
  }

  const workerDomain = new URL(request.url).origin;
  const r2PublicUrl = body.r2PublicUrl ?? `${workerDomain}/assets/public`;
  const result = await createRenderJobs(body.parsed, env, workerDomain, r2PublicUrl);

  return json({
    campaignId: body.parsed.campaign_id,
    totalJobs: result.jobs.length,
    rendering: result.jobs.filter((job) => job.status === "rendering").length,
    failed: result.jobs.filter((job) => job.status === "failed").length,
    errors: result.errors,
  });
});

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

router.get("/assets", async (request, env) => {
  const url = new URL(request.url);
  const prefix = url.searchParams.get("prefix") ?? undefined;
  const assets = await listAssets(env, prefix);
  return json({ assets });
});

router.post("/assets/uploadUrl", async (request, env) => {
  const body = (await request.json()) as { key: string };
  if (!body.key) {
    return error(400, "Missing 'key' field");
  }

  return json(await getUploadUrl(env, body.key));
});

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

router.get("/assets/public/:key+", async (request, env) => {
  const key = decodeURIComponent(request.params.key);
  const object = await env.R2_ASSETS.get(key);

  if (!object) {
    return error(404, "Asset not found");
  }

  const headers = new Headers();
  headers.set(
    "Content-Type",
    object.httpMetadata?.contentType ?? "application/octet-stream"
  );
  headers.set("Cache-Control", "public, max-age=86400");

  return new Response(object.body, { headers });
});

router.get("/analysis/background/:key+", async (request, env) => {
  const key = decodeURIComponent(request.params.key);
  const artifact = await readBackgroundAnalysis(env, key);
  const ref = await getBackgroundAnalysisRef(env, key);
  return json({ ref, artifact });
});

router.post("/analysis/background", async (request, env) => {
  const body = (await request.json()) as {
    artifact?: BackgroundAnalysisArtifact;
  };

  if (!body.artifact?.assetKey) {
    return error(400, "Missing background analysis artifact");
  }

  const artifact = await writeBackgroundAnalysis(env, body.artifact);
  return json({ artifact });
});

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

router.get("/campaign/:id", async (request, env) => {
  const campaignId = request.params.id;
  const summaryData = await env.KV_JOBS.get(`campaign:${campaignId}`);

  if (!summaryData) {
    return error(404, "Campaign not found");
  }

  return json(JSON.parse(summaryData));
});

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ): Promise<Response> {
    const url = new URL(request.url);
    const apiPrefixes = [
      "/parseBrief",
      "/render-config",
      "/previewModel",
      "/createJobs",
      "/webhook",
      "/assets",
      "/analysis",
      "/rich-text.svg",
      "/campaign",
    ];

    if (apiPrefixes.some((prefix) => url.pathname.startsWith(prefix))) {
      return router.fetch(request, env, ctx);
    }

    const assetManifest = JSON.parse(manifestJSON);
    try {
      return await getAssetFromKV(
        { request, waitUntil: ctx.waitUntil.bind(ctx) },
        { ASSET_NAMESPACE: env.__STATIC_CONTENT, ASSET_MANIFEST: assetManifest }
      );
    } catch {
      try {
        const indexRequest = new Request(
          new URL("/index.html", request.url).toString(),
          request
        );
        return await getAssetFromKV(
          { request: indexRequest, waitUntil: ctx.waitUntil.bind(ctx) },
          { ASSET_NAMESPACE: env.__STATIC_CONTENT, ASSET_MANIFEST: assetManifest }
        );
      } catch {
        return new Response("Not found", { status: 404 });
      }
    }
  },
} satisfies ExportedHandler<Env>;

async function loadBackgroundAnalysisRefs(
  backgrounds: string[],
  env: Env
): Promise<Record<string, Awaited<ReturnType<typeof getBackgroundAnalysisRef>>>> {
  const refs = await Promise.all(
    backgrounds.map(async (background) => [
      background,
      await getBackgroundAnalysisRef(env, background),
    ] as const)
  );
  return Object.fromEntries(refs);
}
