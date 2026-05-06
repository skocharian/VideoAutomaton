import { describe, expect, it } from "vitest";
import { buildTintedAssetSvg } from "../src/tinted-assets";

describe("buildTintedAssetSvg", () => {
  it("recolors SVG sources directly instead of wrapping them in a nested image filter", () => {
    const source = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <defs>
    <style>
      .mark { fill: #fff; stroke: #000; }
    </style>
  </defs>
  <rect x="-50" y="0" width="10" height="10" fill="#000" />
  <path d="M20 20h10v10H20z" />
  <path d="M40 40h10v10H40z" fill="none" />
  <path class="mark" d="M0 0h10v10H0z" />
</svg>`;

    const result = buildTintedAssetSvg(
      "image/svg+xml",
      new TextEncoder().encode(source).buffer,
      "#12abef"
    );

    expect(result).toContain(`overflow="hidden"`);
    expect(result).toContain(`preserveAspectRatio="xMidYMid meet"`);
    expect(result).toContain(`data-video-automaton-tint="default"`);
    expect(result).toContain(`:where(path, rect, circle, ellipse, polygon, text, tspan) { fill: #12abef; }`);
    expect(result).toContain(`fill: #12abef`);
    expect(result).toContain(`stroke: #12abef`);
    expect(result).toContain(`fill="#12abef"`);
    expect(result).toContain(`fill="none"`);
    expect(result).not.toContain("<image ");
    expect(result).not.toContain("data:image/svg+xml;base64");
  });

  it("keeps raster image tinting on the wrapper path", () => {
    const buffer = new Uint8Array([137, 80, 78, 71]).buffer;

    const result = buildTintedAssetSvg("image/png", buffer, "#abcdef");

    expect(result).toContain("<image ");
    expect(result).toContain("data:image/png;base64");
    expect(result).toContain("feFlood");
  });
});
