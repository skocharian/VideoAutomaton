#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import {
  analyzeBackgroundFile,
  parseArgs,
  printUsage,
} from "./background-analysis-lib.mjs";

const args = parseArgs(process.argv.slice(2));
if (!args.input || !args.assetKey) {
  printUsage();
  process.exit(1);
}

const artifact = await analyzeBackgroundFile({
  input: args.input,
  assetKey: args.assetKey,
  ffmpegPath: args.ffmpeg || process.env.FFMPEG_PATH || "ffmpeg",
  ffprobePath: args.ffprobe || process.env.FFPROBE_PATH || "ffprobe",
});

if (args.output) {
  await fs.mkdir(path.dirname(path.resolve(args.output)), { recursive: true });
  await fs.writeFile(args.output, JSON.stringify(artifact, null, 2));
}

if (args.endpoint) {
  const response = await fetch(args.endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(args.token ? { Authorization: `Bearer ${args.token}` } : {}),
    },
    body: JSON.stringify({ artifact }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Failed to publish analysis artifact: ${response.status} ${body}`);
  }
}

if (!args.quiet) {
  process.stdout.write(`${JSON.stringify(artifact, null, 2)}\n`);
}
