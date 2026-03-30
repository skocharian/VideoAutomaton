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
  },
  backgrounds: ["bg/PinkTrees.mp4"],
  sizes: ["9:16", "4:5"],
  audio: "audio/track.mp3",
  badge: "badges/ios.png",
  novelty: ["novelty/clip1.mp4"],
};

describe("buildModifications", () => {
  const r2Url = "https://worker.example.com/assets/public";

  it("sets background source", () => {
    const mods = buildModifications(parsed, 0, "bg/PinkTrees.mp4", r2Url);
    expect(mods["Background.source"]).toBe(`${r2Url}/bg/PinkTrees.mp4`);
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
    expect(mods["S2_Header.text"]).toBeUndefined();
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

  it("includes novelty clip source", () => {
    const mods = buildModifications(parsed, 0, "bg/PinkTrees.mp4", r2Url);
    expect(mods["NoveltyClip.source"]).toBe(`${r2Url}/novelty/clip1.mp4`);
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
