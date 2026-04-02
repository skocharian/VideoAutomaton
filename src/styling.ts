import type {
  Env,
  RenderSize,
  TextLayerOverride,
} from "./types";

export type StylingSuggestionRequest = {
  backgroundKey: string;
  backgroundImage: string;
  size: RenderSize;
  safeZone?: {
    top: number;
    right: number;
    bottom: number;
    left: number;
  };
  slides: Array<{
    id: string;
    kind: string;
    displayIndex: number;
    layers: Array<{
      key: string;
      type: string;
      text?: string;
      x?: string;
      y?: string;
      width?: string;
      height?: string;
      fontFamily?: string;
      fontSize?: number;
      fontWeight?: number | string;
      lineHeight?: string;
      textAlign?: string;
      color?: string;
    }>;
  }>;
};

export type StylingSuggestionResponse = {
  recommendations: Array<{
    slideId: string;
    confidence: number;
    reason: string;
    scrim?: {
      enabled: boolean;
    };
    layers: Array<{
      key: string;
      fontSize?: number;
      color?: string;
      x?: string;
      y?: string;
    }>;
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
              "You are a direct response ad designer. Return only valid JSON. Optimize for readable, premium-looking ad styling. Keep all key text inside the provided safe zone. You may use any tasteful 6-digit hex text color if it improves contrast with the background. Prefer elegant, high-contrast colors over washed-out or low-contrast ones. Prioritize improving text color before making large positional changes. Do not invent new layer keys. Prefer minimal layout changes when the current composition is already strong, but do change colors when readability or polish would improve. Disable the scrim when it is visually unnecessary. Keep closing screens branded and restrained.",
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text:
              "Recommend styling overrides for these ad slides.\n" +
              "Primary goal: choose text colors that read clearly against the actual background and feel premium.\n" +
              "You are allowed to keep white, but only when it is clearly the best choice. Otherwise choose a better contrasting hex color.\n" +
              "Avoid muddy grays or colors too close to the background.\n" +
              "Return JSON matching this shape exactly: " +
              JSON.stringify(
                {
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
                          color: "#ffffff",
                          x: "8%",
                          y: "16%",
                        },
                      ],
                    },
                  ],
                }
              ) +
              "\nInput:\n" +
              JSON.stringify(
                {
                  size: payload.size,
                  backgroundKey: payload.backgroundKey,
                  safeZone: payload.safeZone,
                  slides: payload.slides,
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
        ],
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

function sanitizeLayerOverride(layer: {
  key: string;
  fontSize?: number;
  color?: string;
  x?: string;
  y?: string;
}): {
  key: string;
  fontSize?: number;
  color?: string;
  x?: string;
  y?: string;
} {
  const sanitized: {
    key: string;
    fontSize?: number;
    color?: string;
    x?: string;
    y?: string;
  } = { key: layer.key };

  if (Number.isFinite(layer.fontSize)) {
    sanitized.fontSize = clampNumber(Number(layer.fontSize), 10, 96);
  }
  if (typeof layer.color === "string" && /^#?[0-9a-f]{6}$/i.test(layer.color.trim())) {
    sanitized.color = normalizeHex(layer.color);
  }
  if (typeof layer.x === "string" && isPercentString(layer.x)) {
    sanitized.x = normalizePercent(layer.x);
  }
  if (typeof layer.y === "string" && isPercentString(layer.y)) {
    sanitized.y = normalizePercent(layer.y);
  }

  return sanitized;
}

function normalizeHex(value: string): string {
  const trimmed = value.trim();
  return trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
}

function isPercentString(value: string): boolean {
  return /^\s*-?\d+(?:\.\d+)?%\s*$/.test(value);
}

function normalizePercent(value: string): string {
  const numeric = Number.parseFloat(value.replace("%", ""));
  return `${clampNumber(numeric, 0, 100)}%`;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function getStyleProfileKey(size: RenderSize, backgroundKey: string): string {
  return `${size}|${backgroundKey}`;
}

export function mergeTextOverrides(
  base: Record<string, TextLayerOverride> | undefined,
  incoming: Array<{
    key: string;
    fontSize?: number;
    color?: string;
    x?: string;
    y?: string;
  }>
): Record<string, TextLayerOverride> {
  const merged = { ...(base ?? {}) };
  for (const layer of incoming) {
    merged[layer.key] = {
      ...(merged[layer.key] ?? {}),
      ...(Number.isFinite(layer.fontSize) ? { fontSize: Number(layer.fontSize) } : {}),
      ...(layer.color ? { color: layer.color } : {}),
      ...(layer.x ? { x: layer.x } : {}),
      ...(layer.y ? { y: layer.y } : {}),
    };
  }
  return merged;
}
