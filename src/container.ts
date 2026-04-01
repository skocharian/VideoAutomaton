import { Container, getContainer } from "@cloudflare/containers";
import type { Env } from "./types";

export class BackgroundAnalyzer extends Container {
  defaultPort = 8080;
  requiredPorts = [8080];
  sleepAfter = "10m";
}

export async function triggerBackgroundAnalysis(
  env: Env,
  workerOrigin: string,
  assetKey: string
): Promise<boolean> {
  if (!assetKey || !env.BACKGROUND_ANALYZER) {
    return false;
  }

  const container = getContainer(
    env.BACKGROUND_ANALYZER as DurableObjectNamespace<BackgroundAnalyzer>,
    getBackgroundAnalysisContainerId(assetKey)
  );

  await container.startAndWaitForPorts({
    cancellationOptions: {
      instanceGetTimeoutMS: 45_000,
      portReadyTimeoutMS: 45_000,
      waitInterval: 500,
    },
  });

  const response = await container.fetch("http://container/analyze", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      assetKey,
      assetUrl: buildWorkerAssetUrl(workerOrigin, assetKey),
      callbackUrl: `${workerOrigin}/analysis/background`,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Background analysis container failed: ${response.status} ${body}`);
  }

  return true;
}

function getBackgroundAnalysisContainerId(assetKey: string): string {
  const encoded = btoa(assetKey).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  return `background-analysis-${encoded}`;
}

function buildWorkerAssetUrl(workerOrigin: string, assetKey: string): string {
  const normalizedOrigin = workerOrigin.replace(/\/$/, "");
  const encodedKey = assetKey
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `${normalizedOrigin}/assets/public/${encodedKey}`;
}
