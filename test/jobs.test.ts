import { afterEach, describe, expect, it, vi } from "vitest";
import { uploadAsset } from "../src/assets";
import {
  getBackgroundAnalysisArtifactKey,
  readBackgroundAnalysis,
  suggestContentTheme,
  writeBackgroundAnalysis,
} from "../src/background-analysis";
import { createRenderJobs } from "../src/jobs";
import { buildPreviewModel, buildRenderScriptDocument } from "../src/render-plan";
import type {
  BackgroundAnalysisArtifact,
  BackgroundAnalysisFrame,
  BackgroundAnalysisSize,
  Env,
  ParsedBrief,
  RegionMetrics,
  RenderElement,
  RenderSize,
} from "../src/types";

const assetBaseUrl = "https://worker.example.com/assets/public";
const workerDomain = "https://worker.example.com";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function makeParsed(overrides: Partial<ParsedBrief> = {}): ParsedBrief {
  const base: ParsedBrief = {
    campaign_id: "AX0320",
    variants: [
      { id: "V1", headline: "Breathe better", subheadline: "Feel calmer" },
      { id: "V2", headline: "Calm in 3 min", subheadline: "Try free" },
    ],
    screens: {
      "2": { body: "Science-backed breathing techniques" },
      "3": {
        header: "Stress changes breathing",
        body: "Guided breathwork sessions",
      },
      "8": {
        header: "Stop the spiral",
        body: "Get breathing exercises",
        disclaimer: "Not medical treatment.",
      },
      "9": {
        body: "Join more than\n18,000,000\npeople who have\ndownloaded Breethe.",
      },
      "10": {
        header: "“I cried the first time\nI used it because\nI had so much relief\nfrom my anxiety.”",
        body: "★★★★★ Maggie S.",
      },
      "11": {
        body: "Feel better. Sleep better.",
      },
    },
    contentScreens: [
      { key: "2", duration: 3, body: "Science-backed breathing techniques" },
      {
        key: "3",
        duration: 3.5,
        header: "Stress changes breathing",
        body: "Guided breathwork sessions",
      },
      {
        key: "8",
        duration: 4,
        header: "Stop the spiral",
        body: "Get breathing exercises",
        disclaimer: "Not medical treatment.",
      },
    ],
    closingScreens: [
      {
        kind: "accolade",
        duration: 3,
        header: "",
        body: "Join more than\n18,000,000\npeople who have\ndownloaded Breethe.",
      },
      {
        kind: "testimonial",
        duration: 3,
        header: "“I cried the first time\nI used it because\nI had so much relief\nfrom my anxiety.”",
        body: "★★★★★ Maggie S.",
      },
      {
        kind: "endcard",
        duration: 4.5,
        header: "Breethe",
        body: "Feel better. Sleep better.",
      },
    ],
    screenDurations: {
      "1": 2.5,
      "2": 3,
      "3": 3.5,
      "8": 4,
      "9": 3,
      "10": 3,
      "11": 4.5,
    },
    backgrounds: ["bg/PinkTrees.mp4"],
    sizes: ["9:16", "4:5"],
    audio: "audio/track.mp3",
    accolade: "accolades/must-have-app.png",
    badge: "badges/ios.png",
    logo: "logos/breethe.png",
    novelty: ["novelty/clip1.mp4"],
  };

  return {
    ...base,
    ...overrides,
    variants: overrides.variants ?? base.variants,
    screens: overrides.screens ?? base.screens,
    contentScreens: overrides.contentScreens ?? base.contentScreens,
    closingScreens: overrides.closingScreens ?? base.closingScreens,
    screenDurations: overrides.screenDurations ?? base.screenDurations,
    backgrounds: overrides.backgrounds ?? base.backgrounds,
    sizes: overrides.sizes ?? base.sizes,
    textOverrides: overrides.textOverrides ?? base.textOverrides,
    backgroundAnalysis: overrides.backgroundAnalysis ?? base.backgroundAnalysis,
    novelty: overrides.novelty ?? base.novelty,
  };
}

function makeMetrics(overrides: Partial<RegionMetrics> = {}): RegionMetrics {
  return {
    avgLuminance: 0.18,
    variance: 0.04,
    brightRatio: 0.08,
    darkRatio: 0.74,
    detail: 0.08,
    ...overrides,
  };
}

function makeSizeData(
  frames: BackgroundAnalysisFrame[],
  defaultStyle?: BackgroundAnalysisSize["defaultSuggestions"]
): BackgroundAnalysisSize {
  return {
    sampleTimes: frames.map((frame) => frame.sourceTime),
    crop: {
      sourceX: 0,
      sourceY: 0,
      sourceWidth: 720,
      sourceHeight: 1280,
    },
    frames,
    ...(defaultStyle ? { defaultSuggestions: defaultStyle } : {}),
  };
}

function makeArtifact(
  sizes: Partial<Record<RenderSize, BackgroundAnalysisSize>>,
  sourceDuration = 8
): BackgroundAnalysisArtifact {
  return {
    version: 1,
    assetKey: "bg/PinkTrees.mp4",
    status: "ready",
    source: "canonical",
    updatedAt: "2026-04-01T00:00:00.000Z",
    sourceDuration,
    sourceWidth: 720,
    sourceHeight: 1280,
    sizes,
  };
}

function getComposition(
  document: ReturnType<typeof buildRenderScriptDocument>,
  name: string
): RenderElement & { elements: RenderElement[] } {
  return document.elements.find(
    (element) => element.type === "composition" && element.name === name
  ) as RenderElement & { elements: RenderElement[] };
}

function getNestedElement(
  composition: RenderElement & { elements: RenderElement[] },
  name: string
): RenderElement | undefined {
  return composition.elements.find((element) => element.name === name);
}

function createMockKV(store: Record<string, string> = {}) {
  return {
    store,
    namespace: {
      get: vi.fn(async (key: string) => store[key] ?? null),
      put: vi.fn(async (key: string, value: string) => {
        store[key] = value;
      }),
    } as unknown as KVNamespace,
  };
}

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
      list: vi.fn(async ({ prefix }: { prefix?: string } = {}) => ({
        objects: Object.entries(store)
          .filter(([key]) => !prefix || key.startsWith(prefix))
          .map(([key, value]) => ({
            key,
            size: value.body.length,
          })),
      })),
    } as unknown as R2Bucket,
  };
}

function makeEnv() {
  const kv = createMockKV();
  const r2 = createMockR2();

  return {
    env: {
      KV_JOBS: kv.namespace,
      CREATOMATE_API_KEY: "test-key",
      NOTIFY_WEBHOOK_URL: "https://hooks.example.com",
      R2_ASSETS: r2.bucket,
      __STATIC_CONTENT: kv.namespace,
    } as Env,
    kvStore: kv.store,
    r2Store: r2.store,
  };
}

describe("buildRenderScriptDocument", () => {
  it("builds a full RenderScript document with dynamic content screens and fixed branded closing screens", () => {
    const analysisArtifact = makeArtifact({
      "9:16": makeSizeData([], {
        "content-header": "white-scrim",
        "content-body": "white-scrim",
        "content-disclaimer": "white-scrim",
      }),
    });

    const document = buildRenderScriptDocument({
      parsed: makeParsed(),
      variantIndex: 0,
      backgroundKey: "bg/PinkTrees.mp4",
      size: "9:16",
      assetBaseUrl,
      analysisArtifact,
    });

    expect(document.duration).toBe(23.5);
    expect(document.width).toBe(720);
    expect(document.height).toBe(1280);
    expect(document).not.toHaveProperty("template_id");

    expect(document.elements.some((element) => element.name === "Background")).toBe(true);
    expect(document.elements.some((element) => element.name === "NoveltyClip")).toBe(true);
    expect(document.elements.some((element) => element.name === "Music")).toBe(true);

    const compositions = document.elements.filter(
      (element) => element.type === "composition"
    ) as Array<RenderElement & { elements: RenderElement[] }>;
    expect(compositions).toHaveLength(7);

    const accoladeComposition = getComposition(document, "Screen_5");
    expect(getNestedElement(accoladeComposition, "Closing_Accolade_Image")).toBeDefined();
    expect(getNestedElement(accoladeComposition, "Closing_Accolade_Body")?.text).toContain(
      "18,000,000"
    );

    const contentComposition = getComposition(document, "Screen_2");
    expect(getNestedElement(contentComposition, "Scrim_content-2")?.border_radius).toBe("29px");

    const endcardComposition = getComposition(document, "Screen_7");
    expect(getNestedElement(endcardComposition, "Closing_Endcard_Logo")).toBeDefined();
    expect(getNestedElement(endcardComposition, "Closing_Endcard_Badge")).toBeDefined();
    expect(getNestedElement(endcardComposition, "Closing_Endcard_Body")?.text).toBe(
      "Feel better. Sleep better."
    );
  });

  it("keeps the closing sequence fixed even when the content screen count changes", () => {
    const parsed = makeParsed({
      screens: {
        "2": { body: "Only one content screen" },
      },
      contentScreens: [
        { key: "2", duration: 3, body: "Only one content screen" },
      ],
      screenDurations: {
        "1": 2.5,
        "2": 3,
      },
    });

    const document = buildRenderScriptDocument({
      parsed,
      variantIndex: 0,
      backgroundKey: "bg/PinkTrees.mp4",
      size: "9:16",
      assetBaseUrl,
      analysisArtifact: null,
    });

    const compositions = document.elements.filter(
      (element) => element.type === "composition"
    ) as Array<RenderElement & { elements: RenderElement[] }>;
    expect(compositions).toHaveLength(5);

    const closingCompositions = compositions.slice(-3);
    expect(getNestedElement(closingCompositions[0], "Closing_Accolade_Body")).toBeDefined();
    expect(getNestedElement(closingCompositions[1], "Closing_Testimonial_Header")).toBeDefined();
    expect(getNestedElement(closingCompositions[2], "Closing_Endcard_Body")).toBeDefined();
  });

  it("uses the same layout tokens in preview and render, and manual overrides win over auto theme suggestions", () => {
    const analysisArtifact = makeArtifact({
      "9:16": makeSizeData([
        {
          sourceTime: 0,
          regions: {
            "content-header": makeMetrics({ avgLuminance: 0.92, brightRatio: 0.86, detail: 0.62 }),
            "content-body": makeMetrics({ avgLuminance: 0.9, brightRatio: 0.82, detail: 0.6 }),
            "content-disclaimer": makeMetrics({ avgLuminance: 0.88, brightRatio: 0.8, detail: 0.55 }),
            "closing-accolade-body": makeMetrics({ avgLuminance: 0.9, brightRatio: 0.82, detail: 0.6 }),
            "closing-testimonial-header": makeMetrics({ avgLuminance: 0.9, brightRatio: 0.82, detail: 0.6 }),
            "closing-testimonial-body": makeMetrics({ avgLuminance: 0.9, brightRatio: 0.82, detail: 0.6 }),
            "closing-endcard-header": makeMetrics({ avgLuminance: 0.9, brightRatio: 0.82, detail: 0.6 }),
            "closing-endcard-body": makeMetrics({ avgLuminance: 0.9, brightRatio: 0.82, detail: 0.6 }),
          },
        },
      ]),
    });

    const parsed = makeParsed({
      textOverrides: {
        S3_Header: {
          fontSize: 52,
          color: "#ffcc00",
          x: "12%",
          y: "14%",
        },
      },
    });

    const preview = buildPreviewModel({
      parsed,
      variantIndex: 0,
      backgroundKey: "bg/PinkTrees.mp4",
      size: "9:16",
      assetBaseUrl,
      analysisArtifact,
    });
    const document = buildRenderScriptDocument({
      parsed,
      variantIndex: 0,
      backgroundKey: "bg/PinkTrees.mp4",
      size: "9:16",
      assetBaseUrl,
      analysisArtifact,
    });

    const previewScreen = preview.slides.find((slide) => slide.sourceKey === "3");
    const previewHeader = previewScreen?.layers.find((layer) => layer.key === "S3_Header");
    const renderScreen = getComposition(document, "Screen_3");
    const renderHeader = getNestedElement(renderScreen, "S3_Header");

    expect(previewHeader?.x).toBe("12%");
    expect(previewHeader?.y).toBe("14%");
    expect(previewHeader?.fontSize).toBe(52);
    expect(previewHeader?.color).toBe("#ffcc00");

    expect(renderHeader?.x).toBe("12%");
    expect(renderHeader?.y).toBe("14%");
    expect(renderHeader?.font_size).toBe(52);
    expect(renderHeader?.fill_color).toBe("#ffcc00");
  });
});

describe("background analysis and theme suggestions", () => {
  it("keeps white as the default on readable dark backgrounds", () => {
    const artifact = makeArtifact({
      "9:16": makeSizeData([
        {
          sourceTime: 0,
          regions: {
            "content-header": makeMetrics(),
            "content-body": makeMetrics(),
            "content-disclaimer": makeMetrics(),
          },
        },
      ]),
    });

    const theme = suggestContentTheme(artifact, "9:16", [0]);
    expect(theme.header?.styleId).toBe("white");
    expect(theme.body?.styleId).toBe("white");
  });

  it("produces different size-aware theme suggestions when the crop analysis differs", () => {
    const artifact = makeArtifact({
      "9:16": makeSizeData([
        {
          sourceTime: 0,
          regions: {
            "content-header": makeMetrics({ avgLuminance: 0.18, brightRatio: 0.06, detail: 0.08 }),
            "content-body": makeMetrics({ avgLuminance: 0.18, brightRatio: 0.06, detail: 0.08 }),
            "content-disclaimer": makeMetrics({ avgLuminance: 0.18, brightRatio: 0.06, detail: 0.08 }),
          },
        },
      ]),
      "4:5": makeSizeData([
        {
          sourceTime: 0,
          regions: {
            "content-header": makeMetrics({ avgLuminance: 0.92, variance: 0.22, brightRatio: 0.84, darkRatio: 0.04, detail: 0.62 }),
            "content-body": makeMetrics({ avgLuminance: 0.92, variance: 0.22, brightRatio: 0.84, darkRatio: 0.04, detail: 0.62 }),
            "content-disclaimer": makeMetrics({ avgLuminance: 0.92, variance: 0.22, brightRatio: 0.84, darkRatio: 0.04, detail: 0.62 }),
          },
        },
      ]),
    });

    const vertical = suggestContentTheme(artifact, "9:16", [0]);
    const portrait = suggestContentTheme(artifact, "4:5", [0]);

    expect(vertical.body?.styleId).toBe("white");
    expect(portrait.body?.styleId).not.toBe("white");
  });

  it("uses modulo sampling when a looped background is shorter than the ad duration", () => {
    const artifact = makeArtifact(
      {
        "9:16": makeSizeData([
          {
            sourceTime: 1,
            regions: {
              "content-header": makeMetrics({ avgLuminance: 0.92, variance: 0.22, brightRatio: 0.84, darkRatio: 0.04, detail: 0.62 }),
              "content-body": makeMetrics({ avgLuminance: 0.92, variance: 0.22, brightRatio: 0.84, darkRatio: 0.04, detail: 0.62 }),
              "content-disclaimer": makeMetrics({ avgLuminance: 0.92, variance: 0.22, brightRatio: 0.84, darkRatio: 0.04, detail: 0.62 }),
            },
          },
          {
            sourceTime: 4,
            regions: {
              "content-header": makeMetrics({ avgLuminance: 0.18, brightRatio: 0.06, detail: 0.08 }),
              "content-body": makeMetrics({ avgLuminance: 0.18, brightRatio: 0.06, detail: 0.08 }),
              "content-disclaimer": makeMetrics({ avgLuminance: 0.18, brightRatio: 0.06, detail: 0.08 }),
            },
          },
        ]),
      },
      5
    );

    const loopedTheme = suggestContentTheme(artifact, "9:16", [6]);
    const directTheme = suggestContentTheme(artifact, "9:16", [1]);
    const differentMomentTheme = suggestContentTheme(artifact, "9:16", [4]);

    expect(loopedTheme.header?.styleId).toBe(directTheme.header?.styleId);
    expect(loopedTheme.header?.styleId).not.toBe(differentMomentTheme.header?.styleId);
  });
});

describe("background analysis storage and render submission", () => {
  it("seeds a pending analysis artifact when a background video is uploaded", async () => {
    const { env } = makeEnv();
    await uploadAsset(env, "bg/ocean.mp4", new ArrayBuffer(8), "video/mp4");

    const artifact = await readBackgroundAnalysis(env, "bg/ocean.mp4");
    expect(artifact?.assetKey).toBe("bg/ocean.mp4");
    expect(artifact?.status).toBe("pending");
    expect(artifact?.source).toBe("pending");
  });

  it("submits full RenderScript jobs even while background analysis is still pending", async () => {
    const { env, r2Store } = makeEnv();
    await uploadAsset(env, "bg/PinkTrees.mp4", new ArrayBuffer(8), "video/mp4");

    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "render-1" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const { jobs, errors } = await createRenderJobs(
      makeParsed({ sizes: ["9:16"], backgrounds: ["bg/PinkTrees.mp4"], variants: [makeParsed().variants[0]] }),
      env,
      workerDomain,
      assetBaseUrl
    );

    expect(errors).toEqual([]);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].status).toBe("rendering");

    const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(requestBody.template_id).toBeUndefined();
    expect(requestBody.output_format).toBe("mp4");
    expect(requestBody.elements.some((element: { name?: string }) => element.name === "Background")).toBe(true);
    expect(requestBody.metadata).toContain('"campaignId":"AX0320"');

    expect(r2Store[getBackgroundAnalysisArtifactKey("bg/PinkTrees.mp4")]).toBeDefined();
  });

  it("uses cached canonical analysis artifacts when they already exist", async () => {
    const { env } = makeEnv();
    const artifact = makeArtifact({
      "9:16": makeSizeData([
        {
          sourceTime: 0,
          regions: {
            "content-header": makeMetrics({ avgLuminance: 0.9, variance: 0.22, brightRatio: 0.84, darkRatio: 0.04, detail: 0.62 }),
            "content-body": makeMetrics({ avgLuminance: 0.9, variance: 0.22, brightRatio: 0.84, darkRatio: 0.04, detail: 0.62 }),
            "content-disclaimer": makeMetrics({ avgLuminance: 0.9, variance: 0.22, brightRatio: 0.84, darkRatio: 0.04, detail: 0.62 }),
            "closing-accolade-body": makeMetrics({ avgLuminance: 0.9, variance: 0.22, brightRatio: 0.84, darkRatio: 0.04, detail: 0.62 }),
            "closing-testimonial-header": makeMetrics({ avgLuminance: 0.9, variance: 0.22, brightRatio: 0.84, darkRatio: 0.04, detail: 0.62 }),
            "closing-testimonial-body": makeMetrics({ avgLuminance: 0.9, variance: 0.22, brightRatio: 0.84, darkRatio: 0.04, detail: 0.62 }),
            "closing-endcard-header": makeMetrics({ avgLuminance: 0.9, variance: 0.22, brightRatio: 0.84, darkRatio: 0.04, detail: 0.62 }),
            "closing-endcard-body": makeMetrics({ avgLuminance: 0.9, variance: 0.22, brightRatio: 0.84, darkRatio: 0.04, detail: 0.62 }),
          },
        },
      ]),
    });
    await writeBackgroundAnalysis(env, artifact);

    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "render-2" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await createRenderJobs(
      makeParsed({ sizes: ["9:16"], backgrounds: ["bg/PinkTrees.mp4"], variants: [makeParsed().variants[0]] }),
      env,
      workerDomain,
      assetBaseUrl
    );

    const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    const firstComposition = requestBody.elements.find(
      (element: { type: string; name?: string }) => element.type === "composition" && element.name === "Screen_1"
    );
    const header = firstComposition.elements.find(
      (element: { name?: string }) => element.name === "S1_Header"
    );

    expect(header.fill_color).toBe("#0c2340");
  });
});
