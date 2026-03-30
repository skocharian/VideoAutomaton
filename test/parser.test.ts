import { describe, it, expect } from "vitest";
import { parseBrief, computeVideoCount } from "../src/parser";

describe("parseBrief", () => {
  const baseBriefReq = {
    brief: "",
    backgrounds: ["bg/PinkTrees.mp4"],
    sizes: ["9:16", "4:5"],
    audio: "audio/breethe.mp3",
    badge: "badges/ios.png",
  };

  it("extracts campaign ID from brief text", () => {
    const result = parseBrief({
      ...baseBriefReq,
      brief: "Campaign ID: AX0320\nSome other content",
    });
    expect(result.campaign_id).toBe("AX0320");
  });

  it("extracts campaign ID from inline code pattern", () => {
    const result = parseBrief({
      ...baseBriefReq,
      brief: "This is for campaign AX0320 launching next week",
    });
    expect(result.campaign_id).toBe("AX0320");
  });

  it("generates fallback campaign ID when none found", () => {
    const result = parseBrief({
      ...baseBriefReq,
      brief: "no campaign id here at all",
    });
    expect(result.campaign_id).toMatch(/^CAMP/);
  });

  it("extracts variants with slash separator", () => {
    const brief = `
Campaign ID: AX0320
V1: You're probably breathing wrong / And it's keeping you stressed
V2: What if calm was one breath away / Science-backed breathing
V3: Stress is a breathing problem / Not a thinking problem
V4: 3 minutes to change your nervous system / Try it free
    `.trim();

    const result = parseBrief({ ...baseBriefReq, brief });
    expect(result.variants).toHaveLength(4);
    expect(result.variants[0]).toEqual({
      id: "V1",
      headline: "You're probably breathing wrong",
      subheadline: "And it's keeping you stressed",
    });
    expect(result.variants[3].id).toBe("V4");
  });

  it("extracts variants with pipe separator", () => {
    const brief = `
V1: Headline one | Sub one
V2: Headline two | Sub two
    `.trim();

    const result = parseBrief({ ...baseBriefReq, brief });
    expect(result.variants).toHaveLength(2);
    expect(result.variants[0].headline).toBe("Headline one");
    expect(result.variants[1].subheadline).toBe("Sub two");
  });

  it("extracts screens with header/body labels", () => {
    const brief = `
Screen 2:
Header: The science is clear
Body: Your breathing triggers how your nervous system reacts.
Screen 3:
Header: Stress changes breathing
Body: Guided breathwork sessions
    `.trim();

    const result = parseBrief({ ...baseBriefReq, brief });
    expect(result.screens["2"]).toBeDefined();
    expect(result.screens["2"].header).toBe("The science is clear");
    expect(result.screens["2"].body).toContain("breathing triggers");
    expect(result.screens["3"]).toBeDefined();
    expect(result.screens["3"].header).toBe("Stress changes breathing");
  });

  it("treats two-line screen blocks as header + body", () => {
    const brief = `
Screen 4:
Shallow breaths = high stress.
This starves your blood of oxygen.
    `.trim();

    const result = parseBrief({ ...baseBriefReq, brief });
    expect(result.screens["4"].header).toBe("Shallow breaths = high stress.");
    expect(result.screens["4"].body).toContain("starves your blood");
  });

  it("treats single-line screen block as body", () => {
    const brief = `
Screen 2: The science is clear about breathing.
    `.trim();

    const result = parseBrief({ ...baseBriefReq, brief });
    expect(result.screens["2"].body).toContain("science is clear");
  });

  it("extracts disclaimer field", () => {
    const brief = `
Screen 8:
Header: Stop the anxious spiral
Body: Get fast-acting breathing exercises
Disclaimer: This is not a replacement for medical treatment.
    `.trim();

    const result = parseBrief({ ...baseBriefReq, brief });
    expect(result.screens["8"].disclaimer).toContain("not a replacement");
  });

  it("handles dynamic number of screens", () => {
    const brief = `
Screen 1: Intro
Screen 2: Middle
Screen 3: Another
Screen 4: Yet another
Screen 5: Almost done
Screen 6: Final
    `.trim();

    const result = parseBrief({ ...baseBriefReq, brief });
    expect(Object.keys(result.screens)).toHaveLength(6);
  });

  it("defaults sizes to 9:16 and 4:5 when empty", () => {
    const result = parseBrief({ ...baseBriefReq, sizes: [] });
    expect(result.sizes).toEqual(["9:16", "4:5"]);
  });

  it("passes through backgrounds, audio, badge", () => {
    const result = parseBrief({ ...baseBriefReq, brief: "AX0320" });
    expect(result.backgrounds).toEqual(["bg/PinkTrees.mp4"]);
    expect(result.audio).toBe("audio/breethe.mp3");
    expect(result.badge).toBe("badges/ios.png");
  });

  it("includes novelty when provided", () => {
    const result = parseBrief({
      ...baseBriefReq,
      brief: "AX0320",
      novelty: ["novelty/clip1.mp4"],
    });
    expect(result.novelty).toEqual(["novelty/clip1.mp4"]);
  });

  it("omits novelty when not provided", () => {
    const result = parseBrief({ ...baseBriefReq, brief: "AX0320" });
    expect(result.novelty).toBeUndefined();
  });
});

describe("computeVideoCount", () => {
  it("computes variants x backgrounds x sizes", () => {
    const count = computeVideoCount({
      campaign_id: "AX0320",
      variants: [
        { id: "V1", headline: "H1", subheadline: "S1" },
        { id: "V2", headline: "H2", subheadline: "S2" },
      ],
      screens: {},
      backgrounds: ["bg1.mp4", "bg2.mp4", "bg3.mp4"],
      sizes: ["9:16", "4:5"],
      audio: "",
      badge: "",
    });
    expect(count).toBe(12);
  });

  it("treats empty variants/backgrounds as 1", () => {
    const count = computeVideoCount({
      campaign_id: "X",
      variants: [],
      screens: {},
      backgrounds: [],
      sizes: ["9:16"],
      audio: "",
      badge: "",
    });
    expect(count).toBe(1);
  });
});
