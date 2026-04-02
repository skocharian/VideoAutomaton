function encodeAssetKey(key: string): string {
  return key
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
}

export function normalizeTintHexColor(color?: string): string {
  const trimmed = color?.trim();
  if (!trimmed) return "#ffffff";

  const shortMatch = trimmed.match(/^#([0-9a-f]{3})$/i);
  if (shortMatch) {
    const expanded = shortMatch[1]
      .split("")
      .map((part) => `${part}${part}`)
      .join("");
    return `#${expanded.toLowerCase()}`;
  }

  const longMatch = trimmed.match(/^#([0-9a-f]{6})$/i);
  if (longMatch) {
    return `#${longMatch[1].toLowerCase()}`;
  }

  return "#ffffff";
}

export function buildTintedAssetUrl(
  assetBaseUrl: string,
  key: string,
  color?: string
): string {
  if (!key) return "";

  const normalizedBase = assetBaseUrl.replace(/\/$/, "");
  if (!normalizedBase.endsWith("/assets/public")) {
    return `${normalizedBase}/${encodeAssetKey(key)}`;
  }

  return `${normalizedBase.slice(0, -"/public".length)}/tinted/${encodeAssetKey(
    key
  )}?color=${encodeURIComponent(normalizeTintHexColor(color))}`;
}

export function buildTintedAssetSvg(
  sourceContentType: string,
  sourceBuffer: ArrayBuffer,
  color?: string
): string {
  const tintColor = normalizeTintHexColor(color);
  const mimeType = sourceContentType || "image/png";

  if (isSvgAsset(mimeType, sourceBuffer)) {
    return tintSvgMarkup(new TextDecoder().decode(sourceBuffer), tintColor);
  }

  const sourceDataUrl = `data:${mimeType};base64,${arrayBufferToBase64(sourceBuffer)}`;

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet">`,
    `<defs>`,
    `<filter id="recolor" x="-20%" y="-20%" width="140%" height="140%" color-interpolation-filters="sRGB">`,
    `<feFlood flood-color="${escapeXml(tintColor)}" result="flood" />`,
    `<feComposite in="flood" in2="SourceAlpha" operator="in" result="tint" />`,
    `</filter>`,
    `</defs>`,
    `<image x="0" y="0" width="100" height="100" preserveAspectRatio="xMidYMid meet" href="${escapeXml(
      sourceDataUrl
    )}" filter="url(#recolor)" />`,
    `</svg>`,
  ].join("");
}

function isSvgAsset(contentType: string, sourceBuffer: ArrayBuffer): boolean {
  if (contentType.includes("svg")) {
    return true;
  }

  const prefix = new TextDecoder()
    .decode(sourceBuffer.slice(0, Math.min(sourceBuffer.byteLength, 256)))
    .trimStart();
  return prefix.startsWith("<svg") || prefix.startsWith("<?xml");
}

function tintSvgMarkup(svgMarkup: string, tintColor: string): string {
  let tinted = svgMarkup;

  tinted = tinted.replace(
    /(<svg\b[^>]*)(>)/i,
    (match, openTag, close) => {
      let nextTag = openTag;
      if (!/\boverflow\s*=/.test(nextTag)) {
        nextTag += ` overflow="hidden"`;
      }
      if (!/\bpreserveAspectRatio\s*=/.test(nextTag)) {
        nextTag += ` preserveAspectRatio="xMidYMid meet"`;
      }
      return `${nextTag}${close}`;
    }
  );

  tinted = replaceSvgPaint(tinted, tintColor);
  return tinted;
}

function replaceSvgPaint(svgMarkup: string, tintColor: string): string {
  return svgMarkup
    .replace(
      /\b(fill|stroke)\s*=\s*(['"])(?!none\b)([^'"]+)\2/gi,
      (_match, property, quote) => `${property}=${quote}${tintColor}${quote}`
    )
    .replace(
      /\b(fill|stroke)\s*:\s*(?!none\b)([^;"'}]+)/gi,
      (_match, property) => `${property}: ${tintColor}`
    );
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
