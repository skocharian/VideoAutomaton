import { describe, it, expect } from "vitest";
import { parseBrief, computeTotalDuration, computeVideoCount } from "../src/parser";

describe("parseBrief", () => {
  const baseBriefReq = {
    brief: "",
    backgrounds: ["bg/PinkTrees.mp4"],
    sizes: ["9:16", "4:5"],
    audio: "audio/breethe.mp3",
    audioStartSeconds: 0,
    accolade: "accolades/must-have-app.png",
    badge: "badges/ios.png",
    logo: "logos/breethe.png",
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
    expect(result.screenDurations["1"]).toBe(3.75);
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

  it("extracts indented multi-line variants separately", () => {
    const brief = `
Variants:
  V1: Headline one
  Sub one
  V2: Headline two
  Sub two
  V3: Headline three
  Sub three
    `.trim();

    const result = parseBrief({ ...baseBriefReq, brief });
    expect(result.variants).toHaveLength(3);
    expect(result.variants[0]).toEqual({
      id: "V1",
      headline: "Headline one",
      subheadline: "Sub one",
    });
    expect(result.variants[2]).toEqual({
      id: "V3",
      headline: "Headline three",
      subheadline: "Sub three",
    });
  });

  it("stops variant parsing when screens begin", () => {
    const brief = `
V1: Headline one
Sub one
V2: Headline two
Sub two

Screen 2:
Header: The science is clear
Body: Your breathing triggers how your nervous system reacts.
    `.trim();

    const result = parseBrief({ ...baseBriefReq, brief });
    expect(result.variants).toHaveLength(2);
    expect(result.variants[1]).toEqual({
      id: "V2",
      headline: "Headline two",
      subheadline: "Sub two",
    });
    expect(result.screens["2"].header).toBe("The science is clear");
  });

  it("stops variant parsing before bare screen headings and production notes", () => {
    const brief = `
Screen 1:

V1:
Your brain "/**shoots**/"** **you with **anxiety**
(and you don’t even notice)

**From screen 2 on, please use a phased approach to sentences - first sentence, second sentence, third, etc.**

Screen 2
Something **stressful **happens for real.      (first)
That’s the first "/**shot**/".                 (second)

Screen 3
Then your mind starts spinning,                (first)
piling on more **anxious thoughts.**           (second)
    `.trim();

    const result = parseBrief({ ...baseBriefReq, brief });
    expect(result.variants).toHaveLength(1);
    expect(result.variants[0]).toEqual({
      id: "V1",
      headline: `Your brain "/**shoots**/"** **you with **anxiety**`,
      subheadline: "(and you don’t even notice)",
    });
    expect(result.screens["2"]).toEqual({
      header: "Something **stressful **happens for real.",
      body: `That’s the first "/**shot**/".`,
    });
    expect(result.screens["3"]).toEqual({
      header: "Then your mind starts spinning,",
      body: "piling on more **anxious thoughts.**",
    });
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
    expect(result.screenDurations["2"]).toBe(4.25);
  });

  it("suppresses earlier duplicate closing-like testimonial screens from content", () => {
    const brief = `
Screen 1:
V1:
If you want to block overthinking

Screen 2:
“I cried the first time I used it because I had so much relief from my anxiety.”
★★★★★ Maggie S.

Screen 3:
Research shows daily self-care practices may protect the brain.

Screen 4:
Selected
“MUST HAVE APP”
by Apple

Join more than
18,000,000
people who have
downloaded Breethe.

Screen 5:
“I cried the first time I used it because I had so much relief from my anxiety.”
★★★★★ Maggie S.

Screen 6:
<<Breethe logo>>
Feel better. Sleep better.
    `.trim();

    const result = parseBrief({ ...baseBriefReq, brief });
    expect(result.contentScreens.map((screen) => screen.key)).toEqual(["3"]);
    expect(result.detectedClosingScreenKeys).toEqual({
      accolade: "4",
      testimonial: "5",
      endcard: "6",
    });
  });

  it("parses explicit screen durations from headings and labels", () => {
    const brief = `
Screen 1 (2.5s):
V1: Headline one
Sub one

Screen 2:
Duration: 4s
Header: The science is clear
Body: Your breathing triggers how your nervous system reacts.
    `.trim();

    const result = parseBrief({ ...baseBriefReq, brief });
    expect(result.screenDurations["1"]).toBe(2.5);
    expect(result.screenDurations["2"]).toBe(4);
  });

  it("applies a global default screen duration when specified", () => {
    const brief = `
Each slide is 2.25 seconds

V1: Headline one
Sub one

Screen 2:
Body: Keep breathing
    `.trim();

    const result = parseBrief({ ...baseBriefReq, brief });
    expect(result.screenDurations["1"]).toBe(2.25);
    expect(result.screenDurations["2"]).toBe(2.25);
  });

  it("suggests longer slide durations for denser copy when no duration is specified", () => {
    const brief = `
Screen 1:
Short headline

Screen 2:
This screen has a much denser amount of copy, so the generated creative should give people enough time to read it comfortably before advancing.
    `.trim();

    const result = parseBrief({ ...baseBriefReq, brief });
    expect(result.screenDurations["1"]).toBe(3);
    expect(result.screenDurations["2"]).toBeGreaterThan(result.screenDurations["1"]);
  });

  it("preserves bold markup in parsed screen text", () => {
    const brief = `
Screen 2:
If you want to **block overthinking**
listen to this audio.
    `.trim();

    const result = parseBrief({ ...baseBriefReq, brief });
    expect(result.screens["2"]).toEqual({
      header: "If you want to **block overthinking**",
      body: "listen to this audio.",
    });
  });

  it("recognizes bolded variant and screen headings from rich-text paste", () => {
    const brief = `
**V1:**
You’re probably breathing wrong right now.
(And it’s keeping you stressed & anxious.)

**V2:**
Your brain is stuck in **anxiety**.
(Because you’re probably **breathing** wrong right now.)

**Screen 2:**
The science is clear: Your breathing triggers how your **nervous system** reacts.

**Screen 3:**
**Stress** actually changes how you breathe. (first sentence)
It switches you to **shallow breathing** — the biological signal for danger. (second)
    `.trim();

    const result = parseBrief({ ...baseBriefReq, brief });
    expect(result.variants).toHaveLength(2);
    expect(result.variants[1]).toEqual({
      id: "V2",
      headline: "Your brain is stuck in **anxiety**.",
      subheadline: "(Because you’re probably **breathing** wrong right now.)",
    });
    expect(result.screens["2"]).toEqual({
      body: "The science is clear: Your breathing triggers how your **nervous system** reacts.",
    });
    expect(result.screens["3"]).toEqual({
      header: "**Stress** actually changes how you breathe.",
      body: "It switches you to **shallow breathing** — the biological signal for danger.",
    });
  });

  it("recognizes a fully bolded screen heading with inline end-card title", () => {
    const brief = `
**Screen 11: End Card (motion tagline)**

<<Breethe logo>>
Feel better. Sleep better.
    `.trim();

    const result = parseBrief({ ...baseBriefReq, brief });
    expect(result.screens["11"]).toEqual({
      body: "Feel better. Sleep better.",
    });
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

  it("does not treat the word 'body' in copy as a Body label", () => {
    const brief = `
Screen 6:
Regardless of what came first, your body is now locked in a stress cycle.
Anxiety has become a daily habit.
    `.trim();

    const result = parseBrief({ ...baseBriefReq, brief });
    expect(result.screens["6"]).toEqual({
      header: "Regardless of what came first, your body is now locked in a stress cycle.",
      body: "Anxiety has become a daily habit.",
    });
  });

  it("extracts starred small print as disclaimer", () => {
    const brief = `
Screen 8:
Stop the anxious, stress spiral.
Get fast-acting breathing exercises for
instant nervous system relief.

*This is not a replacement
for medical treatment.
    `.trim();

    const result = parseBrief({ ...baseBriefReq, brief });
    expect(result.screens["8"]).toEqual({
      header: "Stop the anxious, stress spiral.",
      body: "Get fast-acting breathing exercises for\ninstant nervous system relief.",
      disclaimer: "*This is not a replacement\nfor medical treatment.",
    });
  });

  it("strips editorial line notes like first/second from screen copy", () => {
    const brief = `
Screen 3:
Stress actually changes how you breathe. (first sentence)
It switches you to shallow breathing — the biological signal for danger. (second)

Screen 8:
Stop the anxious, stress spiral.
Get fast-acting breathing exercises for instant nervous system relief.
*This is not a replacement (in very small print at bottom)
for medical treatment.
    `.trim();

    const result = parseBrief({ ...baseBriefReq, brief });
    expect(result.screens["3"]).toEqual({
      header: "Stress actually changes how you breathe.",
      body: "It switches you to shallow breathing — the biological signal for danger.",
    });
    expect(result.screens["8"]).toEqual({
      header: "Stop the anxious, stress spiral.",
      body: "Get fast-acting breathing exercises for instant nervous system relief.",
      disclaimer: "*This is not a replacement\nfor medical treatment.",
    });
  });

  it("strips the shorter in-very-small-print annotation too", () => {
    const brief = `
Screen 8:
*This is not a replacement (in very small print)
for medical treatment.
    `.trim();

    const result = parseBrief({ ...baseBriefReq, brief });
    expect(result.screens["8"]).toEqual({
      disclaimer: "*This is not a replacement\nfor medical treatment.",
    });
  });

  it("skips screen 1 blocks that only contain variants", () => {
    const brief = `
Screen 1:

V1:
Headline one
Sub one

V2:
Headline two
Sub two
    `.trim();

    const result = parseBrief({ ...baseBriefReq, brief });
    expect(result.screens["1"]).toBeUndefined();
    expect(result.variants).toHaveLength(2);
  });

  it("parses the AX0320 brief structure correctly", () => {
    const brief = `
AX0320 - You’re probably breathing wrong right now

File Names:

AX0320_YoureProbablyBreathingWrong_V1_PinkTreesStream_9x16
AX0320_YoureProbablyBreathingWrong_V1_PinkTreesStream_4x5
AX0320_YoureAccidentallyKeeping_V2_PinkTreesStream_9x16
AX0320_YoureAccidentallyKeeping_V2_PinkTreesStream_4x5
AX0320_YourBrainIsStuckInStressMode_V3_PinkTreesStream_9x16
AX0320_YourBrainIsStuckInStressMode_V3_PinkTreesStream_4x5
AX0320_YourBrainIsStuckInAnxiety_V4_PinkTreesStream_9x16
AX0320_YourBrainIsStuckInAnxiety_V4_PinkTreesStream_4x5

AX0320_YoureProbablyBreathingWrong_V1_PsychedelicTunnel2_9x16
AX0320_YoureProbablyBreathingWrong_V1_PsychedelicTunnel2_4x5
AX0320_YoureAccidentallyKeeping_V2_PsychedelicTunnel2_9x16
AX0320_YoureAccidentallyKeeping_V2_PsychedelicTunnel2_4x5
AX0320_YourBrainIsStuckInStressMode_V3_PsychedelicTunnel2_9x16
AX0320_YourBrainIsStuckInStressMode_V3_PsychedelicTunnel2_4x5
AX0320_YourBrainIsStuckInAnxiety_V4_PsychedelicTunnel2_9x16
AX0320_YourBrainIsStuckInAnxiety_V4_PsychedelicTunnel2_4x5

Sizes:
9:16 and 4:5

Notes:
Please create iOS creatives

Deliverables: 4 variants x 2 sizes x 2 backgrounds x1 badge = 16 Files

Reference:
Similar to our “Your Brain Believes Anxious Thoughts” creatives

Audio:
Breethe track

Backgrounds:
PinkTreesStream
Psychedelic Tunnel 2

Screen 1:

V1:
You’re probably breathing wrong right now.
(And it’s keeping you stressed & anxious.)

V2:
You’re accidentally keeping yourself stressed & anxious.
(And it’s all in how you’re breathing right now.)

V3:
Your brain is stuck in stress mode.
(Because you’re probably breathing wrong right now.)

V4:
Your brain is stuck in anxiety.
(Because you’re probably breathing wrong right now.)

Screen 2:

The science is clear: Your breathing triggers how your nervous system reacts.

Screen 3:

Stress actually changes how you breathe.

It switches you to shallow breathing — the biological signal for danger.

Screen 4:
Shallow breaths = high stress.
This starves your blood of oxygen & keeps you in "fight or flight" mode.

Screen 5:
It’s a "chicken-and-egg" cycle.
Stress causes shallow breathing...but shallow breathing causes more stress.

Screen 6:
Regardless of what came first, your body is now locked in a stress cycle.
Anxiety has become a daily habit.

Screen 7:
But you can break the cycle.
Learn to send signals to your nervous system to quiet stress hormones like cortisol & adrenaline.

Screen 8:
Stop the anxious, stress spiral.
Get fast-acting breathing exercises for
instant nervous system relief.

*This is not a replacement
for medical treatment.

Screen 9:
Selected
“MUST HAVE APP”
by Apple

Join more than
18,000,000
people who have
downloaded Breethe.

Screen 10:
“I cried the first time
I used it because
I had so much relief
from my anxiety.”
★★★★★ Maggie S.

Screen 11: End Card (motion tagline)

<<Breethe logo>>
Feel better. Sleep better.
    `.trim();

    const result = parseBrief({ ...baseBriefReq, brief });
    expect(result.campaign_id).toBe("AX0320");
    expect(result.variants).toHaveLength(4);
    expect(result.variants[0]).toEqual({
      id: "V1",
      headline: "You’re probably breathing wrong right now.",
      subheadline: "(And it’s keeping you stressed & anxious.)",
    });
    expect(result.variants[3]).toEqual({
      id: "V4",
      headline: "Your brain is stuck in anxiety.",
      subheadline: "(Because you’re probably breathing wrong right now.)",
    });
    expect(result.screens["1"]).toBeUndefined();
    expect(result.screens["6"]).toEqual({
      header: "Regardless of what came first, your body is now locked in a stress cycle.",
      body: "Anxiety has become a daily habit.",
    });
    expect(result.screens["3"]).toEqual({
      header: "Stress actually changes how you breathe.",
      body: "It switches you to shallow breathing — the biological signal for danger.",
    });
    expect(result.screens["8"]).toEqual({
      header: "Stop the anxious, stress spiral.",
      body: "Get fast-acting breathing exercises for\ninstant nervous system relief.",
      disclaimer: "*This is not a replacement\nfor medical treatment.",
    });
    expect(result.screens["11"]).toEqual({
      body: "Feel better. Sleep better.",
    });
    expect(result.contentScreens.map((screen) => screen.key)).toEqual([
      "2",
      "3",
      "4",
      "5",
      "6",
      "7",
      "8",
    ]);
    expect(result.closingScreens.map((screen) => screen.kind)).toEqual([
      "accolade",
      "testimonial",
      "endcard",
    ]);
    expect(result.screenDurations["1"]).toBe(5.5);
    expect(result.screenDurations["11"]).toBe(3);
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

  it("passes through backgrounds, audio, accolade, badge, and logo", () => {
    const result = parseBrief({ ...baseBriefReq, brief: "AX0320" });
    expect(result.backgrounds).toEqual(["bg/PinkTrees.mp4"]);
    expect(result.audio).toBe("audio/breethe.mp3");
    expect(result.audioStartSeconds).toBe(0);
    expect(result.accolade).toBe("accolades/must-have-app.png");
    expect(result.badge).toBe("badges/ios.png");
    expect(result.logo).toBe("logos/breethe.png");
  });

  it("normalizes audio start seconds from the request", () => {
    const result = parseBrief({
      ...baseBriefReq,
      brief: "AX0320",
      audioStartSeconds: 600,
    });
    expect(result.audioStartSeconds).toBe(600);
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

describe("computeTotalDuration", () => {
  it("adds all slide durations together", () => {
    const total = computeTotalDuration({
      campaign_id: "AX0322",
      variants: [{ id: "V1", headline: "H1", subheadline: "S1" }],
      screens: { "2": { body: "Body" }, "3": { body: "Body" } },
      contentScreens: [
        { key: "2", duration: 3, body: "Body" },
        { key: "3", duration: 4.25, body: "Body" },
      ],
      closingScreens: [
        { kind: "accolade", duration: 3, header: "", body: "Downloaded Breethe." },
        { kind: "testimonial", duration: 3, header: "Quote", body: "★★★★★ Maggie S." },
        { kind: "endcard", duration: 3, header: "Breethe", body: "Feel better. Sleep better." },
      ],
      screenDurations: { "1": 2.5, "2": 3, "3": 4.25 },
      backgrounds: ["bg1.mp4"],
      sizes: ["9:16"],
      audio: "",
      audioStartSeconds: 0,
      accolade: "",
      badge: "",
      logo: "",
    });

    expect(total).toBe(18.75);
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
      contentScreens: [],
      closingScreens: [],
      screenDurations: {},
      backgrounds: ["bg1.mp4", "bg2.mp4", "bg3.mp4"],
      sizes: ["9:16", "4:5"],
      audio: "",
      audioStartSeconds: 0,
      accolade: "",
      badge: "",
      logo: "",
    });
    expect(count).toBe(12);
  });

  it("treats empty variants/backgrounds as 1", () => {
    const count = computeVideoCount({
      campaign_id: "X",
      variants: [],
      screens: {},
      contentScreens: [],
      closingScreens: [],
      screenDurations: {},
      backgrounds: [],
      sizes: ["9:16"],
      audio: "",
      audioStartSeconds: 0,
      accolade: "",
      badge: "",
      logo: "",
    });
    expect(count).toBe(1);
  });
});
