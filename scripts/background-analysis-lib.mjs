import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function loadRenderConfig() {
  return JSON.parse(
    await fs.readFile(path.resolve(__dirname, "../config/render-config.json"), "utf8")
  );
}

export function probeSource(input, ffprobePath) {
  const raw = execFileSync(
    ffprobePath,
    [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=width,height,duration,codec_name",
      "-show_entries",
      "format=duration",
      "-of",
      "json",
      input,
    ],
    { encoding: "utf8" }
  );
  const data = JSON.parse(raw);
  const stream = data.streams?.[0] ?? {};
  const format = data.format ?? {};
  const width = Number(stream.width ?? 0);
  const height = Number(stream.height ?? 0);
  const duration = Number(stream.duration ?? format.duration ?? 0) || 1;
  const codecName = String(stream.codec_name ?? "").toLowerCase();
  const extension = path.extname(input).toLowerCase();
  const isStillImage =
    duration <= 1.01 &&
    ["png", "jpg", "jpeg", "webp"].includes(extension.replace(/^\./, "")) &&
    ["png", "mjpeg", "webp", "jpeg"].includes(codecName);

  if (!width || !height) {
    throw new Error(`Unable to determine dimensions for ${input}`);
  }

  return {
    width,
    height,
    duration: Number(duration.toFixed(3)),
    isStillImage,
  };
}

export async function analyzeBackgroundFile({
  input,
  assetKey,
  ffmpegPath = "ffmpeg",
  ffprobePath = "ffprobe",
  renderConfig,
}) {
  const effectiveConfig = renderConfig ?? (await loadRenderConfig());
  const metadata = probeSource(input, ffprobePath);
  const sizes = {};
  const analysisSizes = buildAnalysisSizes(effectiveConfig.sizes);
  const frameCount = metadata.isStillImage
    ? 1
    : Math.max(12, effectiveConfig.sampleRatios.length * 3);
  const sampleTimes = buildSampleTimes(metadata.duration, frameCount, effectiveConfig.sampleRatios);

  for (const [size, config] of Object.entries(effectiveConfig.sizes)) {
    const crop = computeCoverCrop(metadata.width, metadata.height, config.canvas);
    const scaledCrop = {
      sourceX: crop.sourceX,
      sourceY: crop.sourceY,
      sourceWidth: crop.sourceWidth,
      sourceHeight: crop.sourceHeight,
      x: 0,
      y: 0,
      width: analysisSizes[size].width,
      height: analysisSizes[size].height,
    };

    const frames = [];
    for (const sampleTime of sampleTimes) {
      const rgba = extractFrame({
        ffmpegPath,
        input,
        time: metadata.isStillImage ? 0 : sampleTime,
        crop,
        width: analysisSizes[size].width,
        height: analysisSizes[size].height,
      });
      frames.push({
        sourceTime: Number(sampleTime.toFixed(3)),
        regions: analyzeRegions(rgba, scaledCrop, size, effectiveConfig),
      });
    }

    sizes[size] = {
      sampleTimes,
      crop: {
        sourceX: crop.sourceX,
        sourceY: crop.sourceY,
        sourceWidth: crop.sourceWidth,
        sourceHeight: crop.sourceHeight,
      },
      frames,
    };
  }

  return {
    version: 1,
    assetKey,
    status: "ready",
    source: "canonical",
    updatedAt: new Date().toISOString(),
    sourceDuration: metadata.duration,
    sourceWidth: metadata.width,
    sourceHeight: metadata.height,
    sizes,
  };
}

export function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const part = argv[index];
    if (!part.startsWith("--")) continue;
    const key = part.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      args[key] = true;
      continue;
    }
    args[key] = next;
    index += 1;
  }
  return args;
}

export function printUsage() {
  const lines = [
    "Usage:",
    "  npm run analyze:background -- --input /path/to/video.mp4 --asset-key bg/ocean.mp4 [--output ./analysis.json] [--endpoint https://worker.example.com/analysis/background]",
    "",
    "Options:",
    "  --input      Local path to the uploaded background video or image",
    "  --asset-key  R2 key used by the app, for example bg/ocean.mp4",
    "  --output     Optional path to write the artifact JSON",
    "  --endpoint   Optional worker endpoint to POST { artifact } to",
    "  --token      Optional bearer token for the endpoint",
    "  --ffmpeg     Override ffmpeg binary path",
    "  --ffprobe    Override ffprobe binary path",
    "  --quiet      Skip printing the artifact to stdout",
  ];

  process.stderr.write(`${lines.join("\n")}\n`);
}

function extractFrame({ ffmpegPath, input, time, crop, width, height }) {
  const filter = [
    `crop=${round(crop.sourceWidth)}:${round(crop.sourceHeight)}:${round(crop.sourceX)}:${round(crop.sourceY)}`,
    `scale=${width}:${height}`,
  ].join(",");
  const buffer = execFileSync(
    ffmpegPath,
    [
      "-hide_banner",
      "-loglevel",
      "error",
      ...(time > 0 ? ["-ss", time.toFixed(3)] : []),
      "-i",
      input,
      "-frames:v",
      "1",
      "-vf",
      filter,
      "-f",
      "rawvideo",
      "-pix_fmt",
      "rgba",
      "pipe:1",
    ],
    {
      encoding: "buffer",
      maxBuffer: Math.max(width * height * 4 * 2, 1024 * 1024 * 8),
    }
  );

  return {
    data: new Uint8ClampedArray(buffer),
    width,
    height,
  };
}

function analyzeRegions(frame, crop, size, renderConfig) {
  const regionLayouts = getRegionLayouts(renderConfig, size);
  const uniqueRegions = new Map();

  for (const layout of regionLayouts) {
    if (!layout || uniqueRegions.has(layout.regionId)) continue;
    uniqueRegions.set(layout.regionId, computeRegionMetrics(frame, crop, layout));
  }

  return Object.fromEntries(uniqueRegions.entries());
}

function getRegionLayouts(renderConfig, size) {
  const regions = renderConfig.sizes[size].regions;
  return [
    regions.content.header,
    regions.content.body,
    regions.content.disclaimer,
    regions.accolade.body,
    regions.testimonial.header,
    regions.testimonial.body,
    regions.endcard.header,
    regions.endcard.body,
  ];
}

function computeRegionMetrics(frame, crop, layout) {
  const box = resolveLayoutBox(layout, crop);
  const startX = clampInt(Math.floor(box.x), 0, frame.width - 1);
  const startY = clampInt(Math.floor(box.y), 0, frame.height - 1);
  const endX = clampInt(Math.ceil(box.x + box.width), startX + 1, frame.width);
  const endY = clampInt(Math.ceil(box.y + box.height), startY + 1, frame.height);
  const step = 4;

  let luminanceTotal = 0;
  let luminanceSquaredTotal = 0;
  let brightCount = 0;
  let darkCount = 0;
  let detailTotal = 0;
  let count = 0;

  for (let y = startY; y < endY; y += step) {
    for (let x = startX; x < endX; x += step) {
      const index = (y * frame.width + x) * 4;
      const luminance = getPixelLuminance(frame.data, index);
      luminanceTotal += luminance;
      luminanceSquaredTotal += luminance * luminance;
      if (luminance >= 0.82) brightCount += 1;
      if (luminance <= 0.25) darkCount += 1;
      detailTotal += getPixelDetail(frame.data, frame.width, frame.height, x, y);
      count += 1;
    }
  }

  const averageLuminance = count ? luminanceTotal / count : 0.5;
  const variance = count
    ? Math.max(0, luminanceSquaredTotal / count - averageLuminance * averageLuminance)
    : 0;

  return {
    avgLuminance: Number(averageLuminance.toFixed(4)),
    variance: Number(variance.toFixed(4)),
    brightRatio: Number((brightCount / Math.max(count, 1)).toFixed(4)),
    darkRatio: Number((darkCount / Math.max(count, 1)).toFixed(4)),
    detail: Number((detailTotal / Math.max(count, 1)).toFixed(4)),
  };
}

function resolveLayoutBox(layout, crop) {
  const width = toPixelValue(layout.width, crop.width);
  const height = toPixelValue(layout.height, crop.height);
  const centerX = crop.x + toPixelValue(layout.x, crop.width);
  const centerY = crop.y + toPixelValue(layout.y, crop.height);
  const xAlignment = layout.x_alignment || "0%";
  const yAlignment = layout.y_alignment || "0%";

  return {
    x:
      xAlignment === "50%"
        ? centerX - width / 2
        : xAlignment === "100%"
          ? centerX - width
          : centerX,
    y:
      yAlignment === "50%"
        ? centerY - height / 2
        : yAlignment === "100%"
          ? centerY - height
          : centerY,
    width,
    height,
  };
}

function computeCoverCrop(sourceWidth, sourceHeight, canvas) {
  const targetAspect = canvas.width / canvas.height;
  const sourceAspect = sourceWidth / sourceHeight;

  if (sourceAspect > targetAspect) {
    const cropWidth = sourceHeight * targetAspect;
    return {
      sourceX: (sourceWidth - cropWidth) / 2,
      sourceY: 0,
      sourceWidth: cropWidth,
      sourceHeight: sourceHeight,
    };
  }

  const cropHeight = sourceWidth / targetAspect;
  return {
    sourceX: 0,
    sourceY: (sourceHeight - cropHeight) / 2,
    sourceWidth: sourceWidth,
    sourceHeight: cropHeight,
  };
}

function buildAnalysisSizes(sizeConfig) {
  return Object.fromEntries(
    Object.entries(sizeConfig).map(([size, config]) => {
      const width = 180;
      const height = Math.round(width * (config.canvas.height / config.canvas.width));
      return [size, { width, height }];
    })
  );
}

function buildSampleTimes(duration, frameCount, sampleRatios) {
  if (duration <= 1.01) {
    return [0];
  }

  const maxTime = Math.max(duration - 0.05, 0);
  const times = new Set([0]);

  for (let index = 0; index < frameCount; index += 1) {
    const ratio = frameCount === 1 ? 0 : index / (frameCount - 1);
    times.add(Number(Math.min(duration * ratio, maxTime).toFixed(3)));
  }

  for (const ratio of sampleRatios) {
    times.add(Number(Math.min(duration * ratio, maxTime).toFixed(3)));
  }

  return [...times].sort((a, b) => a - b);
}

function getPixelLuminance(data, index) {
  const r = data[index] / 255;
  const g = data[index + 1] / 255;
  const b = data[index + 2] / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function getPixelDetail(data, width, height, x, y) {
  const currentIndex = (y * width + x) * 4;
  const current = getPixelLuminance(data, currentIndex);
  let comparisons = 0;
  let total = 0;
  const neighbors = [
    [Math.min(width - 1, x + 1), y],
    [x, Math.min(height - 1, y + 1)],
  ];

  for (const [neighborX, neighborY] of neighbors) {
    if (neighborX === x && neighborY === y) continue;
    const neighborIndex = (neighborY * width + neighborX) * 4;
    const neighbor = getPixelLuminance(data, neighborIndex);
    total += Math.abs(current - neighbor);
    comparisons += 1;
  }

  return comparisons ? total / comparisons : 0;
}

function toPixelValue(value, base) {
  if (typeof value === "number") return value;
  const numeric = Number.parseFloat(String(value).replace("%", ""));
  return String(value).includes("%") ? (base * numeric) / 100 : numeric;
}

function clampInt(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}
