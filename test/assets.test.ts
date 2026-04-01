import { afterEach, describe, expect, it, vi } from "vitest";
import {
  finalizeUploadedAsset,
  getUploadUrl,
  uploadAsset,
} from "../src/assets";
import { readBackgroundAnalysis } from "../src/background-analysis";
import type { Env } from "../src/types";

const mocked = vi.hoisted(() => {
  const sign = vi.fn();
  const AwsClient = vi.fn(class {
    sign = sign;
  });

  return {
    sign,
    AwsClient,
  };
});

vi.mock("aws4fetch", () => ({
  AwsClient: mocked.AwsClient,
}));

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

function createMockR2(
  store: Record<string, { body: string; contentType?: string }> = {}
) {
  return {
    store,
    bucket: {
      get: vi.fn(async (key: string) => {
        const entry = store[key];
        if (!entry) return null;
        return {
          body: entry.body,
          httpMetadata: { contentType: entry.contentType },
          json: async () => JSON.parse(entry.body),
          text: async () => entry.body,
        };
      }),
      put: vi.fn(
        async (
          key: string,
          value: string | ArrayBuffer | ReadableStream,
          options?: { httpMetadata?: { contentType?: string } }
        ) => {
          let body = "";
          if (typeof value === "string") {
            body = value;
          } else if (value instanceof ArrayBuffer) {
            body = Buffer.from(value).toString("utf8");
          } else {
            body = "[stream]";
          }

          store[key] = {
            body,
            contentType: options?.httpMetadata?.contentType,
          };
        }
      ),
    } as unknown as R2Bucket,
  };
}

function makeEnv(overrides: Partial<Env> = {}) {
  const r2 = createMockR2();

  return {
    env: {
      CREATOMATE_API_KEY: "test-key",
      NOTIFY_WEBHOOK_URL: "https://hooks.example.com",
      KV_JOBS: {} as KVNamespace,
      R2_ASSETS: r2.bucket,
      __STATIC_CONTENT: {} as KVNamespace,
      R2_BUCKET_NAME: "video-automaton-assets",
      ...overrides,
    } as Env,
    r2Store: r2.store,
  };
}

describe("getUploadUrl", () => {
  it("falls back to the Worker upload proxy when direct upload credentials are missing", async () => {
    const { env } = makeEnv();

    const result = await getUploadUrl(
      env,
      "bg/ocean.mp4",
      "video/mp4",
      "https://worker.example.com"
    );

    expect(result).toEqual({
      key: "bg/ocean.mp4",
      uploadUrl: "/assets/upload/bg%2Focean.mp4",
      method: "PUT",
      headers: {
        "Content-Type": "video/mp4",
      },
      mode: "proxy",
    });
  });

  it("returns a signed direct upload URL when R2 signing credentials are configured", async () => {
    mocked.sign.mockResolvedValue({
      url: "https://video-automaton-assets.account.r2.cloudflarestorage.com/bg/ocean.mp4?X-Amz-Signature=test",
    });

    const { env } = makeEnv({
      R2_ACCOUNT_ID: "account",
      R2_ACCESS_KEY_ID: "access",
      R2_SECRET_ACCESS_KEY: "secret",
    });

    const result = await getUploadUrl(
      env,
      "bg/ocean.mp4",
      "video/mp4",
      "https://worker.example.com"
    );

    expect(mocked.AwsClient).toHaveBeenCalledTimes(1);
    expect(mocked.sign).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      key: "bg/ocean.mp4",
      uploadUrl:
        "https://video-automaton-assets.account.r2.cloudflarestorage.com/bg/ocean.mp4?X-Amz-Signature=test",
      method: "PUT",
      headers: {
        "Content-Type": "video/mp4",
      },
      mode: "direct",
      completeUrl:
        "https://worker.example.com/assets/upload/complete/bg%2Focean.mp4",
    });
  });
});

describe("uploaded asset finalization", () => {
  it("seeds pending background analysis for direct uploads once the browser reports completion", async () => {
    const { env } = makeEnv();

    await finalizeUploadedAsset(env, "bg/ocean.mp4", "video/mp4");

    const artifact = await readBackgroundAnalysis(env, "bg/ocean.mp4");
    expect(artifact?.assetKey).toBe("bg/ocean.mp4");
    expect(artifact?.status).toBe("pending");
  });

  it("still seeds pending background analysis when assets are proxied through the Worker", async () => {
    const { env } = makeEnv();

    await uploadAsset(env, "bg/ocean.mp4", new ArrayBuffer(8), "video/mp4");

    const artifact = await readBackgroundAnalysis(env, "bg/ocean.mp4");
    expect(artifact?.assetKey).toBe("bg/ocean.mp4");
    expect(artifact?.status).toBe("pending");
  });
});
