import { describe, it, expect, vi } from "vitest";
import { handleWebhook } from "../src/webhook";
import type { Env, CreatomateWebhookPayload, RenderJob, CampaignSummary } from "../src/types";

function createMockKV(store: Record<string, string> = {}) {
  return {
    get: vi.fn(async (key: string) => store[key] ?? null),
    put: vi.fn(async (key: string, value: string) => {
      store[key] = value;
    }),
  };
}

function makeMockEnv(kvStore: Record<string, string> = {}): Env {
  return {
    KV_JOBS: createMockKV(kvStore) as unknown as KVNamespace,
    CREATOMATE_API_KEY: "test",
    TEMPLATE_9X16_ID: "t1",
    TEMPLATE_4X5_ID: "t2",
    NOTIFY_WEBHOOK_URL: "https://hooks.example.com",
    R2_ASSETS: {} as any,
  };
}

describe("handleWebhook", () => {
  it("returns early if no metadata", async () => {
    const env = makeMockEnv();
    const result = await handleWebhook(
      { id: "r1", status: "succeeded" } as CreatomateWebhookPayload,
      env
    );
    expect(result.allDone).toBe(false);
    expect(result.campaignId).toBeNull();
  });

  it("updates job to completed on success", async () => {
    const job: RenderJob = {
      jobId: "j1",
      campaignId: "C1",
      variantId: "V1",
      background: "bg.mp4",
      size: "9:16",
      status: "rendering",
      createdAt: "2025-01-01",
    };
    const summary: CampaignSummary = {
      campaignId: "C1",
      totalJobs: 1,
      completed: 0,
      failed: 0,
      jobIds: ["j1"],
      createdAt: "2025-01-01",
    };

    const store: Record<string, string> = {
      "job:C1:j1": JSON.stringify(job),
      "campaign:C1": JSON.stringify(summary),
    };

    const env = makeMockEnv(store);

    const payload: CreatomateWebhookPayload = {
      id: "render-abc",
      status: "succeeded",
      url: "https://cdn.creatomate.com/renders/abc.mp4",
      metadata: JSON.stringify({ campaignId: "C1", jobId: "j1" }),
    };

    const result = await handleWebhook(payload, env);

    // Job should be updated
    const updatedJob: RenderJob = JSON.parse(store["job:C1:j1"]);
    expect(updatedJob.status).toBe("completed");
    expect(updatedJob.finalUrl).toBe("https://cdn.creatomate.com/renders/abc.mp4");

    // Campaign should show all done
    expect(result.allDone).toBe(true);
    expect(result.campaignId).toBe("C1");
  });

  it("updates job to failed on error", async () => {
    const job: RenderJob = {
      jobId: "j1",
      campaignId: "C1",
      variantId: "V1",
      background: "bg.mp4",
      size: "9:16",
      status: "rendering",
      createdAt: "2025-01-01",
    };
    const summary: CampaignSummary = {
      campaignId: "C1",
      totalJobs: 1,
      completed: 0,
      failed: 0,
      jobIds: ["j1"],
      createdAt: "2025-01-01",
    };

    const store: Record<string, string> = {
      "job:C1:j1": JSON.stringify(job),
      "campaign:C1": JSON.stringify(summary),
    };

    const env = makeMockEnv(store);

    const payload: CreatomateWebhookPayload = {
      id: "render-abc",
      status: "failed",
      error_message: "Template rendering timeout",
      metadata: JSON.stringify({ campaignId: "C1", jobId: "j1" }),
    };

    const result = await handleWebhook(payload, env);

    const updatedJob: RenderJob = JSON.parse(store["job:C1:j1"]);
    expect(updatedJob.status).toBe("failed");
    expect(updatedJob.error).toBe("Template rendering timeout");
    expect(result.allDone).toBe(true);
  });

  it("does not report allDone when jobs are still pending", async () => {
    const job1: RenderJob = {
      jobId: "j1", campaignId: "C1", variantId: "V1",
      background: "bg.mp4", size: "9:16", status: "rendering", createdAt: "2025-01-01",
    };
    const job2: RenderJob = {
      jobId: "j2", campaignId: "C1", variantId: "V2",
      background: "bg.mp4", size: "9:16", status: "rendering", createdAt: "2025-01-01",
    };
    const summary: CampaignSummary = {
      campaignId: "C1", totalJobs: 2, completed: 0, failed: 0,
      jobIds: ["j1", "j2"], createdAt: "2025-01-01",
    };

    const store: Record<string, string> = {
      "job:C1:j1": JSON.stringify(job1),
      "job:C1:j2": JSON.stringify(job2),
      "campaign:C1": JSON.stringify(summary),
    };

    const env = makeMockEnv(store);

    // Only j1 completes
    const result = await handleWebhook(
      {
        id: "r1",
        status: "succeeded",
        url: "https://cdn.creatomate.com/r1.mp4",
        metadata: JSON.stringify({ campaignId: "C1", jobId: "j1" }),
      },
      env
    );

    expect(result.allDone).toBe(false);
  });
});
