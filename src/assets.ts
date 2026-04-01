import type { Env } from "./types";
import { seedBackgroundAnalysis } from "./background-analysis";

export async function listAssets(
  env: Env,
  prefix?: string
): Promise<{ key: string; size: number }[]> {
  const listed = await env.R2_ASSETS.list({ prefix: prefix ?? undefined });
  return listed.objects.map((obj) => ({
    key: obj.key,
    size: obj.size,
  }));
}

export async function getUploadUrl(
  env: Env,
  key: string
): Promise<{ key: string; uploadUrl: string }> {
  // For R2, we return the key and the client uploads via a Worker proxy.
  // In production you'd use presigned URLs via S3-compatible API.
  // Here we provide the Worker endpoint path for PUT uploads.
  return {
    key,
    uploadUrl: `/assets/upload/${encodeURIComponent(key)}`,
  };
}

export async function uploadAsset(
  env: Env,
  key: string,
  body: ReadableStream | ArrayBuffer,
  contentType: string
): Promise<void> {
  await env.R2_ASSETS.put(key, body, {
    httpMetadata: { contentType },
  });

  if (key.startsWith("bg/") && isAnalyzableBackgroundAsset(key, contentType)) {
    await seedBackgroundAnalysis(env, key);
  }
}

function isAnalyzableBackgroundAsset(key: string, contentType: string): boolean {
  return (
    /^video\//.test(contentType) ||
    /^image\//.test(contentType) ||
    /\.(mp4|mov|webm|png|jpe?g)$/i.test(key)
  );
}
