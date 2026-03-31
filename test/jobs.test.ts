import { describe, it, expect } from "vitest";
import { buildModifications, getTemplateId } from "../src/jobs";
import type { ParsedBrief, Env } from "../src/types";

const mockEnv = {
  TEMPLATE_9X16_ID: "tmpl-916",
  TEMPLATE_4X5_ID: "tmpl-45",
} as unknown as Env;

const parsed: ParsedBrief = {
  campaign_id: "AX0320",
  variants: [
    { id: "V1", headline: "Breathe better", subheadline: "Feel calmer" },
    { id: "V2", headline: "Calm in 3 min", subheadline: "Try free" },
  ],
  screens: {
    "2": { body: "Science-backed breathing techniques" },
    "3": { header: "Stress changes breathing", body: "Guided sessions\nPersonalized plans" },
    "4": { header: "Shallow breaths = high stress", body: "This starves your blood of oxygen." },
    "8": { header: "Stop the spiral", body: "Get breathing exercises", disclaimer: "Not medical treatment." },
    "9": {
      header: "Selected\nMUST HAVE APP\nby Apple",
      body: "Join more than 18,000,000 people who have downloaded Breethe.",
    },
    "11": {
      body: "Feel better. Sleep better.",
    },
  },
  screenDurations: {
    "1": 2.5,
    "2": 3,
    "3": 3.5,
    "4": 3,
    "8": 4,
    "9": 3,
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

describe("buildModifications", () => {
  const r2Url = "https://worker.example.com/assets/public";

  it("sets background source", () => {
    const mods = buildModifications(parsed, 0, "bg/PinkTrees.mp4", r2Url);
    expect(mods["Background.source"]).toBe(`${r2Url}/bg/PinkTrees.mp4`);
    expect(mods["Background.duration"]).toBe(23.5);
  });

  it("sets S1_Header and S1_Body from variant", () => {
    const mods = buildModifications(parsed, 0, "bg/PinkTrees.mp4", r2Url);
    expect(mods["S1_Header.text"]).toBe("Breathe better");
    expect(mods["S1_Body.text"]).toBe("Feel calmer");
  });

  it("uses correct variant by index", () => {
    const mods = buildModifications(parsed, 1, "bg/PinkTrees.mp4", r2Url);
    expect(mods["S1_Header.text"]).toBe("Calm in 3 min");
    expect(mods["S1_Body.text"]).toBe("Try free");
  });

  it("maps screen body-only correctly", () => {
    const mods = buildModifications(parsed, 0, "bg/PinkTrees.mp4", r2Url);
    expect(mods["S2_Body.text"]).toBe("Science-backed breathing techniques");
    expect(mods["S2_Header.text"]).toBe("");
  });

  it("maps screen header + body", () => {
    const mods = buildModifications(parsed, 0, "bg/PinkTrees.mp4", r2Url);
    expect(mods["S3_Header.text"]).toBe("Stress changes breathing");
    expect(mods["S3_Body.text"]).toContain("Guided sessions");
  });

  it("maps disclaimer field", () => {
    const mods = buildModifications(parsed, 0, "bg/PinkTrees.mp4", r2Url);
    expect(mods["S8_Disclaimer.text"]).toBe("Not medical treatment.");
  });

  it("uses body copy for screen 9 but skips text header when accolade image is provided", () => {
    const mods = buildModifications(parsed, 0, "bg/PinkTrees.mp4", r2Url);
    expect(mods["S9_Body.text"]).toContain("18,000,000");
    expect(mods["S9_Header.text"]).toBe("");
  });

  it("applies per-screen timing to template layers", () => {
    const mods = buildModifications(parsed, 0, "bg/PinkTrees.mp4", r2Url);
    expect(mods["duration"]).toBe(23.5);
    expect(mods["S1_Header.time"]).toBe(0);
    expect(mods["S1_Header.duration"]).toBe(2.5);
    expect(mods["S2_Body.time"]).toBe(2.5);
    expect(mods["S2_Body.duration"]).toBe(3);
    expect(mods["S11_Body.time"]).toBe(19);
    expect(mods["S11_Body.duration"]).toBe(4.5);
  });

  it("includes novelty clip source", () => {
    const mods = buildModifications(parsed, 0, "bg/PinkTrees.mp4", r2Url);
    expect(mods["NoveltyClip.source"]).toBe(`${r2Url}/novelty/clip1.mp4`);
  });

  it("injects dynamic assets and audio elements", () => {
    const mods = buildModifications(parsed, 0, "bg/PinkTrees.mp4", r2Url);
    const dynamicElements = mods["elements.add"] as Array<Record<string, unknown>>;

    expect(dynamicElements.some((element) => element.name === "S9_Accolade_Dynamic")).toBe(true);
    expect(dynamicElements.some((element) => element.name === "S11_Badge_Dynamic")).toBe(true);
    expect(dynamicElements.some((element) => element.name === "S11_Logo_Dynamic")).toBe(true);
    expect(dynamicElements.some((element) => element.name === "Music_Dynamic")).toBe(true);
  });

  it("strips bold markup before sending plain text modifications when rich rendering is unavailable", () => {
    const richParsed = {
      ...parsed,
      screens: {
        ...parsed.screens,
        "2": { body: "If you want to **block overthinking**" },
      },
    };
    const mods = buildModifications(richParsed, 0, "bg/PinkTrees.mp4", r2Url);
    expect(mods["S2_Body.text"]).toBe("If you want to block overthinking");
  });

  it("does not add render-time highlight overlays for marked phrases", () => {
    const richParsed = {
      ...parsed,
      screens: {
        ...parsed.screens,
        "2": { body: "If you want to **block overthinking**" },
      },
    };
    const mods = buildModifications(
      richParsed,
      0,
      "bg/PinkTrees.mp4",
      r2Url
    );

    expect(mods["S2_Body.text"]).toBe("If you want to block overthinking");
    const dynamicElements = mods["elements.add"] as Array<Record<string, unknown>>;
    const highlightOverlay = dynamicElements?.find(
      (element) => element.name === "S2_Body_Highlight_1_Dynamic"
    );
    expect(highlightOverlay).toBeUndefined();
  });

  it("applies local text overrides to creatomate modifications", () => {
    const overriddenParsed: ParsedBrief = {
      ...parsed,
      textOverrides: {
        S3_Header: {
          fontSize: 36,
          color: "#ffcc00",
          x: "18%",
          y: "20%",
        },
      },
    };

    const mods = buildModifications(overriddenParsed, 0, "bg/PinkTrees.mp4", r2Url);

    expect(mods["S3_Header.text"]).toBe("Stress changes breathing");
    expect(mods["S3_Header.font_size"]).toBe(36);
    expect(mods["S3_Header.fill_color"]).toBe("#ffcc00");
    expect(mods["S3_Header.x"]).toBe("18%");
    expect(mods["S3_Header.y"]).toBe("20%");
  });

  it("handles empty background gracefully", () => {
    const mods = buildModifications(parsed, 0, "", r2Url);
    expect(mods["Background.source"]).toBeUndefined();
  });
});

describe("getTemplateId", () => {
  it("returns 4:5 template for 4:5 size", () => {
    expect(getTemplateId("4:5", mockEnv)).toBe("tmpl-45");
  });

  it("returns 9:16 template for 9:16 size", () => {
    expect(getTemplateId("9:16", mockEnv)).toBe("tmpl-916");
  });

  it("defaults to 9:16 for unknown sizes", () => {
    expect(getTemplateId("16:9", mockEnv)).toBe("tmpl-916");
  });
});
