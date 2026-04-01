import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../src/types";

const mocked = vi.hoisted(() => {
  const startAndWaitForPorts = vi.fn();
  const containerFetch = vi.fn();
  const getContainer = vi.fn(() => ({
    startAndWaitForPorts,
    fetch: containerFetch,
  }));

  return {
    startAndWaitForPorts,
    containerFetch,
    getContainer,
  };
});

vi.mock("@cloudflare/containers", () => ({
  Container: class {},
  getContainer: mocked.getContainer,
}));

import { triggerBackgroundAnalysis } from "../src/container";

describe("triggerBackgroundAnalysis", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.startAndWaitForPorts.mockResolvedValue(undefined);
    mocked.containerFetch.mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 })
    );
  });

  it("returns false when the container binding is not configured", async () => {
    const env = {
      CREATOMATE_API_KEY: "test",
      NOTIFY_WEBHOOK_URL: "https://hooks.example.com",
      KV_JOBS: {} as KVNamespace,
      R2_ASSETS: {} as R2Bucket,
      __STATIC_CONTENT: {} as KVNamespace,
    } as Env;

    const result = await triggerBackgroundAnalysis(
      env,
      "https://worker.example.com",
      "bg/ocean.mp4"
    );

    expect(result).toBe(false);
    expect(mocked.getContainer).not.toHaveBeenCalled();
  });

  it("starts a named container instance and posts the analysis job payload", async () => {
    const env = {
      CREATOMATE_API_KEY: "test",
      NOTIFY_WEBHOOK_URL: "https://hooks.example.com",
      KV_JOBS: {} as KVNamespace,
      R2_ASSETS: {} as R2Bucket,
      __STATIC_CONTENT: {} as KVNamespace,
      BACKGROUND_ANALYZER: {} as DurableObjectNamespace,
    } as Env;

    const result = await triggerBackgroundAnalysis(
      env,
      "https://worker.example.com",
      "bg/ocean waves.mp4"
    );

    expect(result).toBe(true);
    expect(mocked.getContainer).toHaveBeenCalledTimes(1);
    expect(mocked.startAndWaitForPorts).toHaveBeenCalledTimes(1);
    expect(mocked.containerFetch).toHaveBeenCalledWith(
      "http://container/analyze",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
      })
    );

    const payload = JSON.parse(mocked.containerFetch.mock.calls[0][1].body);
    expect(payload).toEqual({
      assetKey: "bg/ocean waves.mp4",
      assetUrl: "https://worker.example.com/assets/public/bg/ocean%20waves.mp4",
      callbackUrl: "https://worker.example.com/analysis/background",
    });
  });
});
