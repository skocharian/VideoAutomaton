import { getUploadUrl } from "./assets";
import { normalizeBackgroundSpeed } from "./parser";
import type { Env, ParsedBrief } from "./types";

export type BackgroundPreparationStatus = "pending" | "processing" | "ready" | "failed";
const STALE_PREPARATION_MS = 2 * 60 * 1000;

export interface SpeedAdjustedBackgroundTarget {
  background: string;
  speed: number;
}

export interface PreparedBackgroundVariant extends SpeedAdjustedBackgroundTarget {
  preparedKey: string;
  status: BackgroundPreparationStatus;
  updatedAt: string;
  error?: string;
}

export function getBackgroundSpeed(parsed: ParsedBrief, backgroundKey: string): number {
  return normalizeBackgroundSpeed(parsed.backgroundSettings?.[backgroundKey]?.speed);
}

export function listSpeedAdjustedBackgrounds(
  parsed: ParsedBrief
): SpeedAdjustedBackgroundTarget[] {
  const seen = new Set<string>();
  return (parsed.backgrounds || [])
    .map((background) => ({
      background,
      speed: getBackgroundSpeed(parsed, background),
    }))
    .filter(({ background, speed }) => {
      if (!background || speed === 1 || !isVideoAsset(background)) {
        return false;
      }
      if (seen.has(background)) {
        return false;
      }
      seen.add(background);
      return true;
    });
}

export async function prepareBackgroundVariants(
  parsed: ParsedBrief,
  env: Env,
  workerOrigin: string
): Promise<PreparedBackgroundVariant[]> {
  const targets = listSpeedAdjustedBackgrounds(parsed);
  return Promise.all(
    targets.map(({ background, speed }) =>
      queueBackgroundSpeedPreparation(env, workerOrigin, background, speed)
    )
  );
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

  return prepareBackgroundSpeedVariantNow(env, workerOrigin, backgroundKey, speed);
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

export async function queueBackgroundSpeedPreparation(
  env: Env,
  workerOrigin: string,
  backgroundKey: string,
  requestedSpeed: number
): Promise<PreparedBackgroundVariant> {
  const speed = normalizeBackgroundSpeed(requestedSpeed);
  const derivedKey = getDerivedBackgroundKey(backgroundKey, speed);
  const now = new Date().toISOString();

  if (!backgroundKey || speed === 1 || !isVideoAsset(backgroundKey)) {
    return {
      background: backgroundKey,
      speed,
      preparedKey: backgroundKey,
      status: "ready",
      updatedAt: now,
    };
  }

  const existing = await env.R2_ASSETS.get(derivedKey);
  if (existing) {
    const readyState: PreparedBackgroundVariant = {
      background: backgroundKey,
      speed,
      preparedKey: derivedKey,
      status: "ready",
      updatedAt: now,
    };
    await writeBackgroundSpeedPreparation(env, readyState);
    return readyState;
  }

  const current = await readBackgroundSpeedPreparation(env, backgroundKey, speed);
  if (
    current &&
    (current.status === "pending" || current.status === "processing") &&
    !isStalePreparationState(current)
  ) {
    return current;
  }

  if (!env.BACKGROUND_ANALYZER) {
    const failedState: PreparedBackgroundVariant = {
      background: backgroundKey,
      speed,
      preparedKey: derivedKey,
      status: "failed",
      updatedAt: now,
      error: "Background speed transforms require the background analyzer container",
    };
    await writeBackgroundSpeedPreparation(env, failedState);
    return failedState;
  }

  const pendingState: PreparedBackgroundVariant = {
    background: backgroundKey,
    speed,
    preparedKey: derivedKey,
    status: "pending",
    updatedAt: now,
  };
  await writeBackgroundSpeedPreparation(env, pendingState);
  try {
    await startBackgroundSpeedPreparation(env, workerOrigin, backgroundKey, speed);
    const processingState: PreparedBackgroundVariant = {
      ...pendingState,
      status: "processing",
      updatedAt: new Date().toISOString(),
    };
    await writeBackgroundSpeedPreparation(env, processingState);
    return processingState;
  } catch (error) {
    const failedState: PreparedBackgroundVariant = {
      ...pendingState,
      status: "failed",
      updatedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error),
    };
    await writeBackgroundSpeedPreparation(env, failedState);
    return failedState;
  }
}

export async function readBackgroundSpeedPreparation(
  env: Env,
  backgroundKey: string,
  requestedSpeed: number
): Promise<PreparedBackgroundVariant | null> {
  const speed = normalizeBackgroundSpeed(requestedSpeed);
  const raw = await env.KV_JOBS.get(getBackgroundSpeedPreparationKvKey(backgroundKey, speed));
  if (!raw) {
    return null;
  }

  return JSON.parse(raw) as PreparedBackgroundVariant;
}

export async function writeBackgroundSpeedPreparationState(
  env: Env,
  state: PreparedBackgroundVariant
): Promise<void> {
  await writeBackgroundSpeedPreparation(env, state);
}

async function prepareBackgroundSpeedVariantNow(
  env: Env,
  workerOrigin: string,
  backgroundKey: string,
  requestedSpeed: number
): Promise<string> {
  const speed = normalizeBackgroundSpeed(requestedSpeed);
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

async function startBackgroundSpeedPreparation(
  env: Env,
  workerOrigin: string,
  backgroundKey: string,
  requestedSpeed: number
): Promise<void> {
  const speed = normalizeBackgroundSpeed(requestedSpeed);
  const derivedKey = getDerivedBackgroundKey(backgroundKey, speed);

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
}

async function writeBackgroundSpeedPreparation(
  env: Env,
  state: PreparedBackgroundVariant
): Promise<void> {
  await env.KV_JOBS.put(
    getBackgroundSpeedPreparationKvKey(state.background, state.speed),
    JSON.stringify(state)
  );
}

function getBackgroundSpeedPreparationKvKey(
  backgroundKey: string,
  requestedSpeed: number
): string {
  const speed = normalizeBackgroundSpeed(requestedSpeed);
  return `speedprep:${getDerivedBackgroundKey(backgroundKey, speed)}`;
}

function isStalePreparationState(state: PreparedBackgroundVariant): boolean {
  const updatedAt = Date.parse(state.updatedAt || "");
  if (!Number.isFinite(updatedAt)) {
    return true;
  }

  return Date.now() - updatedAt > STALE_PREPARATION_MS;
}
