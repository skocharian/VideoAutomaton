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
    screen2: "Science-backed breathing techniques",
    screen3: "Guided sessions\nPersonalized plans",
    screen4: "Download free today",
  },
  backgrounds: ["bg/PinkTrees.mp4"],
  sizes: ["9:16", "4:5"],
  audio: "audio/track.mp3",
  badge: "badges/ios.png",
  novelty: ["novelty/clip1.mp4"],
};

describe("buildModifications", () => {
  const r2Url = "https://worker.example.com/assets/public";

  it("sets background, audio, badge sources", () => {
    const mods = buildModifications(parsed, 0, "bg/PinkTrees.mp4", r2Url);
    expect(mods["Background.source"]).toBe(`${r2Url}/bg/PinkTrees.mp4`);
    expect(mods["Audio.source"]).toBe(`${r2Url}/audio/track.mp3`);
    expect(mods["Badge.source"]).toBe(`${r2Url}/badges/ios.png`);
  });

  it("sets screen 1 headline and subheadline from variant", () => {
    const mods = buildModifications(parsed, 0, "bg/PinkTrees.mp4", r2Url);
    expect(mods["Screen1Headline.text"]).toBe("Breathe better");
    expect(mods["Screen1Sub.text"]).toBe("Feel calmer");
  });

  it("uses correct variant by index", () => {
    const mods = buildModifications(parsed, 1, "bg/PinkTrees.mp4", r2Url);
    expect(mods["Screen1Headline.text"]).toBe("Calm in 3 min");
    expect(mods["Screen1Sub.text"]).toBe("Try free");
  });

  it("maps remaining screens correctly", () => {
    const mods = buildModifications(parsed, 0, "bg/PinkTrees.mp4", r2Url);
    expect(mods["Screen2.text"]).toBe("Science-backed breathing techniques");
    expect(mods["Screen3.text"]).toContain("Guided sessions");
    expect(mods["Screen4.text"]).toBe("Download free today");
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
