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

export async function suggestStyling(
  env: Env,
  payload: StylingSuggestionRequest
): Promise<StylingSuggestionResponse> {
  if (!env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not configured");
  }

  const model = env.OPENAI_STYLING_MODEL || "gpt-5.4";
  const body = {
    model,
    messages: [
      {
        role: "system",
        content:
          "You are a direct response ad designer. Return only valid JSON that follows the schema. Optimize for readable, premium-looking ad styling. Keep all key text inside the provided safe zone. Use only these text colors when possible: #ffffff, #87f1f7, #0c2340. Do not invent new layer keys. Prefer minimal changes when the current layout is already strong. Disable the scrim when it is visually unnecessary. Keep closing screens branded and restrained.",
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text:
              "Recommend styling overrides for these ad slides.\n" +
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
            type: "image_url",
            image_url: {
              url: payload.backgroundImage,
            },
          },
        ],
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "styling_recommendation",
        strict: true,
        schema: stylingSchema,
      },
    },
  };

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`OpenAI styling error: ${response.status}`);
  }

  const data = (await response.json()) as {
    choices?: Array<{
      message?: {
        content?: string;
      };
    }>;
  };

  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("OpenAI styling response was empty");
  }

  const parsed = JSON.parse(content) as StylingSuggestionResponse;
  return sanitizeStylingSuggestions(parsed);
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
