import { AwsClient } from "aws4fetch";
import type { Env } from "./types";
import { seedBackgroundAnalysis } from "./background-analysis";

type UploadTarget = {
  key: string;
  uploadUrl: string;
  method: "PUT";
  headers: Record<string, string>;
  mode: "direct" | "proxy";
  completeUrl?: string;
};

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
  key: string,
  contentType: string,
  workerOrigin: string
): Promise<UploadTarget> {
  const directUpload = await getDirectUploadTarget(env, key, contentType, workerOrigin);
  if (directUpload) {
    return directUpload;
  }

  return {
    key,
    uploadUrl: `/assets/upload/${encodeURIComponent(key)}`,
    method: "PUT",
    headers: {
      "Content-Type": contentType,
    },
    mode: "proxy",
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

  await finalizeUploadedAsset(env, key, contentType);
}

export async function finalizeUploadedAsset(
  env: Env,
  key: string,
  contentType: string
): Promise<void> {
  if (key.startsWith("bg/") && isAnalyzableBackgroundAsset(key, contentType)) {
    await seedBackgroundAnalysis(env, key);
  }
}

async function getDirectUploadTarget(
  env: Env,
  key: string,
  contentType: string,
  workerOrigin: string
): Promise<UploadTarget | null> {
  if (
    !env.R2_ACCOUNT_ID ||
    !env.R2_ACCESS_KEY_ID ||
    !env.R2_SECRET_ACCESS_KEY
  ) {
    return null;
  }

  const bucketName = env.R2_BUCKET_NAME || "video-automaton-assets";
  const signedUrl = await signR2PutUrl(
    env,
    bucketName,
    key,
    contentType || "application/octet-stream"
  );

  return {
    key,
    uploadUrl: signedUrl,
    method: "PUT",
    headers: {
      "Content-Type": contentType || "application/octet-stream",
    },
    mode: "direct",
    completeUrl: `${workerOrigin}/assets/upload/complete/${encodeURIComponent(key)}`,
  };
}

async function signR2PutUrl(
  env: Env,
  bucketName: string,
  key: string,
  contentType: string
): Promise<string> {
  const client = new AwsClient({
    accessKeyId: env.R2_ACCESS_KEY_ID!,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY!,
    service: "s3",
    region: "auto",
  });

  const signedRequest = await client.sign(
    new Request(
      `https://${bucketName}.${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${encodeR2Key(
        key
      )}`,
      {
        method: "PUT",
        headers: {
          "Content-Type": contentType,
        },
      }
    ),
    {
      aws: {
        signQuery: true,
      },
    }
  );

  return signedRequest.url;
}

function encodeR2Key(key: string): string {
  return key
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function isAnalyzableBackgroundAsset(key: string, contentType: string): boolean {
  return (
    /^video\//.test(contentType) ||
    /^image\//.test(contentType) ||
    /\.(mp4|mov|webm|png|jpe?g)$/i.test(key)
  );
}
