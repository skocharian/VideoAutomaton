import { getUploadUrl } from "./assets";
import { normalizeBackgroundSpeed } from "./parser";
import type { Env, ParsedBrief } from "./types";

export function getBackgroundSpeed(parsed: ParsedBrief, backgroundKey: string): number {
  return normalizeBackgroundSpeed(parsed.backgroundSettings?.[backgroundKey]?.speed);
}

export async function ensureBackgroundSpeedVariant(
  env: Env,
  workerOrigin: string,
  backgroundKey: string,
  requestedSpeed: number
): Promise<string> {
  const speed = normalizeBackgroundSpeed(requestedSpeed);
  if (!backgroundKey || speed === 1 || !isVideoAsset(backgroundKey)) {
    return backgroundKey;
  }

  const derivedKey = getDerivedBackgroundKey(backgroundKey, speed);
  const existing = await env.R2_ASSETS.get(derivedKey);
  if (existing) {
    return derivedKey;
  }

  if (!env.BACKGROUND_ANALYZER) {
    throw new Error("Background speed transforms require the background analyzer container");
  }

  const uploadTarget = await getUploadUrl(env, derivedKey, "video/mp4", workerOrigin);
  const { triggerBackgroundSpeedTransform } = await import("./container");
  await triggerBackgroundSpeedTransform(
    env,
    workerOrigin,
    backgroundKey,
    speed,
    derivedKey,
    uploadTarget
  );

  return derivedKey;
}

export function getDerivedBackgroundKey(backgroundKey: string, requestedSpeed: number): string {
  const speed = normalizeBackgroundSpeed(requestedSpeed);
  const extension = isVideoAsset(backgroundKey)
    ? ".mp4"
    : backgroundKey.match(/\.[a-z0-9]+$/i)?.[0] || "";
  const baseName = backgroundKey
    .replace(/^bg\//, "")
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[^a-z0-9/_-]+/gi, "-")
    .replace(/\/+/g, "/");
  const speedTag = String(speed.toFixed(2)).replace(".", "_");
  return `derived/bg/${baseName}--speed-${speedTag}${extension}`;
}

function isVideoAsset(key: string): boolean {
  return /\.(mp4|mov|webm)$/i.test(key || "");
}
