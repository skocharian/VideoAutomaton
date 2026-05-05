import type {
  Env,
  RenderSize,
  TextLayerOverride,
} from "./types";

export type StylingSuggestionRequest = {
  backgroundKey: string;
  backgroundSpeed?: number;
  backgroundImage: string;
  size: RenderSize;
  safeZone?: {
    top: number;
    right: number;
    bottom: number;
    left: number;
    cutouts?: Array<{
      left: number;
      top: number;
      width: number;
      height: number;
    }>;
  };
  slides: Array<{
    id: string;
    kind: string;
    displayIndex: number;
    image?: string;
    layers: Array<{
      key: string;
      type: string;
      text?: string;
      x?: string;
      y?: string;
      width?: string;
      height?: string;
      src?: string;
      fit?: "contain" | "cover" | "fill";
      fontFamily?: string;
      fontSize?: number;
      fontWeight?: number | string;
      fontStyle?: "normal" | "italic";
      lineHeight?: string;
      letterSpacing?: string;
      textAlign?: string;
      color?: string;
      shadowColor?: string;
      shadowBlur?: number;
      shadowX?: number;
      shadowY?: number;
      strokeColor?: string;
      strokeWidth?: number;
      tintColor?: string;
    }>;
  }>;
};

type StylingRecommendationLayer = {
  key: string;
  fontSize?: number;
  color?: string;
  x?: string;
  y?: string;
  fontFamily?: string;
  fontWeight?: number | string;
  fontStyle?: "normal" | "italic";
  lineHeight?: string;
  letterSpacing?: string;
  textAlign?: "left" | "center";
  shadowColor?: string;
  shadowBlur?: number;
  shadowX?: number;
  shadowY?: number;
  strokeColor?: string;
  strokeWidth?: number;
  tintColor?: string;
};

export type StylingSuggestionResponse = {
  recommendations: Array<{
    slideId: string;
    confidence: number;
    reason: string;
    scrim?: {
      enabled: boolean;
    };
    layers: StylingRecommendationLayer[];
  }>;
};

const stylingSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    recommendations: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          slideId: { type: "string" },
          confidence: { type: "number" },
          reason: { type: "string" },
          scrim: {
            type: "object",
            additionalProperties: false,
            properties: {
              enabled: { type: "boolean" },
            },
            required: ["enabled"],
          },
          layers: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                key: { type: "string" },
                fontSize: { type: "number" },
                color: { type: "string" },
                x: { type: "string" },
                y: { type: "string" },
                fontFamily: { type: "string" },
                fontWeight: {
                  anyOf: [{ type: "number" }, { type: "string" }],
                },
                fontStyle: { type: "string" },
                lineHeight: { type: "string" },
                letterSpacing: { type: "string" },
                textAlign: { type: "string" },
                shadowColor: { type: "string" },
                shadowBlur: { type: "number" },
                shadowX: { type: "number" },
                shadowY: { type: "number" },
                strokeColor: { type: "string" },
                strokeWidth: { type: "number" },
                tintColor: { type: "string" },
              },
              required: ["key"],
            },
          },
        },
        required: ["slideId", "confidence", "reason", "layers"],
      },
    },
  },
  required: ["recommendations"],
} as const;

type OutputContentItem =
  | {
      type?: string;
      text?: string;
    }
  | {
      type?: string;
      refusal?: string;
    };

type ResponsesApiPayload = {
  model: string;
  input: Array<{
    role: "system" | "user";
    content: Array<
      | {
          type: "input_text";
          text: string;
        }
      | {
          type: "input_image";
          image_url: string;
          detail: "high";
        }
    >;
  }>;
  text: {
    format:
      | {
          type: "json_schema";
          name: string;
          strict: true;
          schema: typeof stylingSchema;
        }
      | {
          type: "json_object";
        };
  };
};

export async function suggestStyling(
  env: Env,
  payload: StylingSuggestionRequest
): Promise<StylingSuggestionResponse> {
  if (!env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not configured");
  }

  const model = env.OPENAI_STYLING_MODEL || "gpt-5.4";
  let response = await callOpenAIStyling(env.OPENAI_API_KEY, buildRequestBody(model, payload, true));

  if (!response.ok && response.status === 400) {
    response = await callOpenAIStyling(env.OPENAI_API_KEY, buildRequestBody(model, payload, false));
  }

  if (!response.ok) {
    throw new Error(await buildOpenAIErrorMessage(response));
  }

  const data = (await response.json()) as {
    output?: Array<{
      type?: string;
      content?: OutputContentItem[];
    }>;
  };

  const content = extractResponseText(data);
  if (!content) {
    throw new Error("OpenAI styling response was empty");
  }

  const parsed = JSON.parse(content) as StylingSuggestionResponse;
  return sanitizeStylingSuggestions(parsed);
}

function buildRequestBody(
  model: string,
  payload: StylingSuggestionRequest,
  useStructuredOutputs: boolean
): ResponsesApiPayload {
  return {
    model,
    input: [
      {
        role: "system",
        content: [
          {
            type: "input_text",
            text:
              "You are a direct response ad designer. Return only valid JSON. Optimize for readable, premium-looking ad styling. Keep all key text inside the provided safe zone, including staying out of any cutout areas within that safe zone. You may change text color, font family, font weight, font style, line height, shadow, glow-like shadow blur, stroke, and position. You may use any tasteful 6-digit hex text color if it improves contrast with the background. You may also set tintColor for image layers when a mark like an accolade logo should adapt to the background. Prefer elegant, high-contrast colors over washed-out or low-contrast ones. You may use common serif or sans-serif fonts such as Georgia, Times New Roman, Baskerville, Garamond, Palatino, Open Sans, Arial, Helvetica, serif, and sans-serif. Do not invent new layer keys. Prefer minimal layout changes when the current composition is already strong, but do change typography treatment when readability or polish would improve. Disable the scrim when it is visually unnecessary. Keep closing screens branded and restrained.",
          },
        ],
      },
      {
        role: "user",
        content: buildUserContent(payload),
      },
    ],
    text: {
      format: useStructuredOutputs
        ? {
            type: "json_schema",
            name: "styling_recommendation",
            strict: true,
            schema: stylingSchema,
          }
        : {
            type: "json_object",
          },
    },
  };
}

function callOpenAIStyling(apiKey: string, body: ResponsesApiPayload): Promise<Response> {
  return fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

async function buildOpenAIErrorMessage(response: Response): Promise<string> {
  const fallback = `OpenAI styling error: ${response.status}`;

  try {
    const data = (await response.json()) as {
      error?: {
        message?: string;
        code?: string;
      };
    };
    const message = data.error?.message?.trim();
    const code = data.error?.code?.trim();
    if (!message) {
      return fallback;
    }
    return code ? `${fallback} (${code}) - ${message}` : `${fallback} - ${message}`;
  } catch {
    try {
      const text = (await response.text()).trim();
      return text ? `${fallback} - ${text}` : fallback;
    } catch {
      return fallback;
    }
  }
}

function extractResponseText(data: {
  output?: Array<{
    type?: string;
    content?: OutputContentItem[];
  }>;
}): string {
  for (const item of data.output || []) {
    if (item.type !== "message") continue;
    for (const content of item.content || []) {
      if (content.type === "output_text" && "text" in content && typeof content.text === "string") {
        return content.text;
      }
      if (content.type === "refusal" && "refusal" in content) {
        throw new Error(`OpenAI styling refusal: ${content.refusal || "Request refused"}`);
      }
    }
  }

  return "";
}

function sanitizeStylingSuggestions(
  response: StylingSuggestionResponse
): StylingSuggestionResponse {
  return {
    recommendations: (response.recommendations || []).map((recommendation) => ({
      ...recommendation,
      confidence: clampNumber(recommendation.confidence, 0, 1),
      layers: (recommendation.layers || []).map((layer) => sanitizeLayerOverride(layer)),
    })),
  };
}

function sanitizeLayerOverride(layer: StylingRecommendationLayer): StylingRecommendationLayer {
  const sanitized: StylingRecommendationLayer = { key: layer.key };

  if (Number.isFinite(layer.fontSize)) {
    sanitized.fontSize = clampNumber(Number(layer.fontSize), 10, 96);
  }
  if (isHexColor(layer.color)) {
    sanitized.color = normalizeHex(layer.color);
  }
  if (typeof layer.x === "string" && isPercentString(layer.x)) {
    sanitized.x = normalizePercent(layer.x);
  }
  if (typeof layer.y === "string" && isPercentString(layer.y)) {
    sanitized.y = normalizePercent(layer.y);
  }
  if (typeof layer.fontFamily === "string") {
    const fontFamily = normalizeFontFamily(layer.fontFamily);
    if (fontFamily) {
      sanitized.fontFamily = fontFamily;
    }
  }
  if (typeof layer.fontWeight === "number" && Number.isFinite(layer.fontWeight)) {
    sanitized.fontWeight = clampNumber(Math.round(layer.fontWeight), 100, 900);
  } else if (typeof layer.fontWeight === "string") {
    const fontWeight = normalizeFontWeight(layer.fontWeight);
    if (fontWeight) {
      sanitized.fontWeight = fontWeight;
    }
  }
  if (layer.fontStyle === "normal" || layer.fontStyle === "italic") {
    sanitized.fontStyle = layer.fontStyle;
  }
  if (typeof layer.lineHeight === "string" && isLineHeightString(layer.lineHeight)) {
    sanitized.lineHeight = normalizeLineHeight(layer.lineHeight);
  }
  if (typeof layer.letterSpacing === "string" && isLetterSpacingString(layer.letterSpacing)) {
    sanitized.letterSpacing = normalizeLetterSpacing(layer.letterSpacing);
  }
  if (layer.textAlign === "left" || layer.textAlign === "center") {
    sanitized.textAlign = layer.textAlign;
  }
  if (isColorString(layer.shadowColor)) {
    sanitized.shadowColor = normalizeColor(layer.shadowColor);
  }
  if (Number.isFinite(layer.shadowBlur)) {
    sanitized.shadowBlur = clampNumber(Number(layer.shadowBlur), 0, 40);
  }
  if (Number.isFinite(layer.shadowX)) {
    sanitized.shadowX = clampNumber(Number(layer.shadowX), -20, 20);
  }
  if (Number.isFinite(layer.shadowY)) {
    sanitized.shadowY = clampNumber(Number(layer.shadowY), -20, 20);
  }
  if (isColorString(layer.strokeColor)) {
    sanitized.strokeColor = normalizeColor(layer.strokeColor);
  }
  if (Number.isFinite(layer.strokeWidth)) {
    sanitized.strokeWidth = clampNumber(Number(layer.strokeWidth), 0, 8);
  }
  if (isHexColor(layer.tintColor)) {
    sanitized.tintColor = normalizeHex(layer.tintColor);
  }

  return sanitized;
}

function normalizeHex(value: string): string {
  const trimmed = value.trim();
  return trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
}

function normalizeColor(value: string): string {
  const trimmed = value.trim();
  if (isHexColor(trimmed)) {
    return normalizeHex(trimmed);
  }
  return trimmed;
}

function isHexColor(value: string | undefined): value is string {
  return typeof value === "string" && /^#?[0-9a-f]{6}$/i.test(value.trim());
}

function isColorString(value: string | undefined): value is string {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  return (
    /^#?[0-9a-f]{6}$/i.test(trimmed) ||
    /^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}(?:\s*,\s*(?:0|1|0?\.\d+))?\s*\)$/i.test(
      trimmed
    )
  );
}

function normalizeFontFamily(value: string): string | undefined {
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (!trimmed || trimmed.length > 80) return undefined;
  if (!/^[A-Za-z0-9 ,"'_-]+$/.test(trimmed)) return undefined;
  return trimmed;
}

function normalizeFontWeight(value: string): string | undefined {
  const trimmed = value.trim().toLowerCase();
  return ["normal", "bold", "lighter", "bolder"].includes(trimmed) ? trimmed : undefined;
}

function isPercentString(value: string): boolean {
  return /^\s*-?\d+(?:\.\d+)?%\s*$/.test(value);
}

function normalizePercent(value: string): string {
  const numeric = Number.parseFloat(value.replace("%", ""));
  return `${clampNumber(numeric, 0, 100)}%`;
}

function isLineHeightString(value: string): boolean {
  return /^\s*\d+(?:\.\d+)?%?\s*$/.test(value);
}

function normalizeLineHeight(value: string): string {
  const trimmed = value.trim();
  if (trimmed.endsWith("%")) {
    const numeric = Number.parseFloat(trimmed.slice(0, -1));
    return `${clampNumber(numeric, 60, 180)}%`;
  }
  const numeric = Number.parseFloat(trimmed);
  return `${clampNumber(numeric, 0.6, 1.8)}`;
}

function isLetterSpacingString(value: string): boolean {
  return /^\s*-?\d+(?:\.\d+)?(?:px|em)?\s*$/.test(value);
}

function normalizeLetterSpacing(value: string): string {
  const trimmed = value.trim();
  const unit = trimmed.endsWith("em") ? "em" : "px";
  const numeric = Number.parseFloat(trimmed.replace(/(px|em)$/i, ""));
  if (unit === "em") {
    return `${clampNumber(numeric, -0.1, 0.2)}em`;
  }
  return `${clampNumber(numeric, -3, 8)}px`;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function getStyleProfileKey(
  size: RenderSize,
  backgroundKey: string,
  backgroundSpeed = 1
): string {
  return `${size}|${backgroundKey}|${backgroundSpeed.toFixed(3)}`;
}

export function mergeTextOverrides(
  base: Record<string, TextLayerOverride> | undefined,
  incoming: StylingRecommendationLayer[]
): Record<string, TextLayerOverride> {
  const merged = { ...(base ?? {}) };
  for (const layer of incoming) {
    merged[layer.key] = {
      ...(merged[layer.key] ?? {}),
      ...(Number.isFinite(layer.fontSize) ? { fontSize: Number(layer.fontSize) } : {}),
      ...(layer.color ? { color: layer.color } : {}),
      ...(layer.x ? { x: layer.x } : {}),
      ...(layer.y ? { y: layer.y } : {}),
      ...(layer.fontFamily ? { fontFamily: layer.fontFamily } : {}),
      ...(typeof layer.fontWeight !== "undefined" ? { fontWeight: layer.fontWeight } : {}),
      ...(layer.fontStyle ? { fontStyle: layer.fontStyle } : {}),
      ...(layer.lineHeight ? { lineHeight: layer.lineHeight } : {}),
      ...(layer.letterSpacing ? { letterSpacing: layer.letterSpacing } : {}),
      ...(layer.textAlign ? { textAlign: layer.textAlign } : {}),
      ...(layer.shadowColor ? { shadowColor: layer.shadowColor } : {}),
      ...(Number.isFinite(layer.shadowBlur) ? { shadowBlur: Number(layer.shadowBlur) } : {}),
      ...(Number.isFinite(layer.shadowX) ? { shadowX: Number(layer.shadowX) } : {}),
      ...(Number.isFinite(layer.shadowY) ? { shadowY: Number(layer.shadowY) } : {}),
      ...(layer.strokeColor ? { strokeColor: layer.strokeColor } : {}),
      ...(Number.isFinite(layer.strokeWidth) ? { strokeWidth: Number(layer.strokeWidth) } : {}),
    };
  }
  return merged;
}

function buildUserContent(
  payload: StylingSuggestionRequest
): ResponsesApiPayload["input"][number]["content"] {
  const content: ResponsesApiPayload["input"][number]["content"] = [
    {
      type: "input_text",
      text:
        "Recommend styling overrides for these ad slides.\n" +
        "Primary goal: choose typography and mark treatment that reads clearly against the actual background and feels premium.\n" +
        "You are allowed to keep white, but only when it is clearly the best choice. Otherwise choose a better contrasting hex color.\n" +
        "You may change font family and add stronger shadow, stroke, or glow-like blur when that improves readability.\n" +
        "For image layers such as accolade marks, you may return tintColor to adapt the mark to the background.\n" +
        "Avoid muddy grays or colors too close to the background.\n" +
        "Return JSON matching this shape exactly: " +
        JSON.stringify({
          recommendations: [
            {
              slideId: "string",
              confidence: 0.0,
              reason: "string",
              scrim: { enabled: true },
              layers: [
                {
                  key: "string",
                  fontSize: 42,
                  fontFamily: "Georgia",
                  fontWeight: 700,
                  fontStyle: "normal",
                  color: "#ffffff",
                  lineHeight: "108%",
                  textAlign: "center",
                  shadowColor: "rgba(0,0,0,0.9)",
                  shadowBlur: 18,
                  shadowY: 3,
                  strokeColor: "#1a1a1a",
                  strokeWidth: 1.5,
                  tintColor: "#f6d75e",
                  x: "8%",
                  y: "16%",
                },
              ],
            },
          ],
        }) +
        "\nInput:\n" +
        JSON.stringify(
          {
            size: payload.size,
            backgroundKey: payload.backgroundKey,
            backgroundSpeed: payload.backgroundSpeed,
            safeZone: payload.safeZone,
            slides: payload.slides.map((slide) => ({
              ...slide,
              image: slide.image ? "[attached separately]" : undefined,
            })),
          },
          null,
          2
        ),
    },
    {
      type: "input_image",
      image_url: payload.backgroundImage,
      detail: "high",
    },
  ];

  for (const slide of payload.slides) {
    if (!slide.image) continue;
    content.push({
      type: "input_text",
      text: `Rendered preview screenshot for slide ${slide.displayIndex} (${slide.kind}, id=${slide.id}).`,
    });
    content.push({
      type: "input_image",
      image_url: slide.image,
      detail: "high",
    });
  }

  return content;
}
