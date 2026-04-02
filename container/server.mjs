import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { analyzeBackgroundFile } from "../scripts/background-analysis-lib.mjs";

const port = Number(process.env.PORT || 8080);
const activeSpeedJobs = new Map();
const FFMPEG_TIMEOUT_MS = Number(process.env.FFMPEG_TIMEOUT_MS || 8 * 60 * 1000);
const STDERR_LIMIT = 24_000;

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

    if (req.method === "GET" && url.pathname === "/ping") {
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === "POST" && url.pathname === "/analyze") {
      const body = await readJson(req);
      if (!body.assetKey || !body.assetUrl || !body.callbackUrl) {
        return sendJson(res, 400, {
          error: "Missing assetKey, assetUrl, or callbackUrl",
        });
      }

      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "bg-analysis-"));
      const tempFile = path.join(tempDir, sanitizeFileName(body.assetKey));

      try {
        const assetResponse = await fetch(body.assetUrl);
        if (!assetResponse.ok) {
          return sendJson(res, 502, {
            error: `Unable to fetch asset ${body.assetUrl}: ${assetResponse.status}`,
          });
        }

        const bytes = new Uint8Array(await assetResponse.arrayBuffer());
        await fs.writeFile(tempFile, bytes);

        const artifact = await analyzeBackgroundFile({
          input: tempFile,
          assetKey: body.assetKey,
          ffmpegPath: process.env.FFMPEG_PATH || "ffmpeg",
          ffprobePath: process.env.FFPROBE_PATH || "ffprobe",
        });

        const callbackResponse = await fetch(body.callbackUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(body.callbackToken
              ? { Authorization: `Bearer ${body.callbackToken}` }
              : {}),
          },
          body: JSON.stringify({ artifact }),
        });

        if (!callbackResponse.ok) {
          return sendJson(res, 502, {
            error: `Failed to POST artifact to callback: ${callbackResponse.status}`,
          });
        }

        return sendJson(res, 200, {
          ok: true,
          assetKey: body.assetKey,
          status: artifact.status,
        });
      } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
      }
    }

    if (req.method === "POST" && url.pathname === "/speed") {
      const body = await readJson(req);
      console.log("speed:request", {
        assetKey: body.assetKey,
        speed: body.speed,
        derivedAssetKey: body.derivedAssetKey,
      });
      if (
        !body.assetKey ||
        !body.assetUrl ||
        !body.derivedAssetKey ||
        !body.uploadTarget?.uploadUrl ||
        !Number.isFinite(body.speed) ||
        !body.callbackUrl
      ) {
        return sendJson(res, 400, {
          error: "Missing assetKey, assetUrl, derivedAssetKey, speed, upload target, or callbackUrl",
        });
      }

      const jobKey = `${body.derivedAssetKey}:${Number(body.speed).toFixed(2)}`;
      if (!activeSpeedJobs.has(jobKey)) {
        activeSpeedJobs.set(
          jobKey,
          runSpeedJob(body).finally(() => {
            activeSpeedJobs.delete(jobKey);
          })
        );
      }

      return sendJson(res, 202, {
        ok: true,
        assetKey: body.assetKey,
        derivedAssetKey: body.derivedAssetKey,
        speed: body.speed,
        status: "processing",
      });
    }

    return sendJson(res, 404, { error: "Not found" });
  } catch (error) {
    return sendJson(res, 500, {
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

server.listen(port, () => {
  console.log(`Background analysis container listening on ${port}`);
});

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function sanitizeFileName(assetKey) {
  const baseName = assetKey.split("/").pop() || "asset";
  return baseName.replace(/[^a-z0-9._-]+/gi, "-");
}

async function runSpeedJob(body) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "bg-speed-"));
  const sourceFile = path.join(tempDir, sanitizeFileName(body.assetKey));
  const outputFile = path.join(tempDir, "derived.mp4");

  try {
    console.log("speed:job:start", {
      assetKey: body.assetKey,
      speed: Number(body.speed),
      derivedAssetKey: body.derivedAssetKey,
    });
    await postSpeedStatus(body, "processing");
    console.log("speed:job:status-posted", {
      assetKey: body.assetKey,
      status: "processing",
    });

    const assetResponse = await fetch(body.assetUrl);
    if (!assetResponse.ok) {
      throw new Error(`Unable to fetch asset ${body.assetUrl}: ${assetResponse.status}`);
    }
    console.log("speed:job:source-fetched", {
      assetKey: body.assetKey,
      status: assetResponse.status,
    });

    const bytes = new Uint8Array(await assetResponse.arrayBuffer());
    await fs.writeFile(sourceFile, bytes);
    console.log("speed:job:source-written", {
      assetKey: body.assetKey,
      bytes: bytes.byteLength,
    });
    await transformBackgroundSpeed(sourceFile, outputFile, Number(body.speed));
    console.log("speed:job:transform-complete", {
      assetKey: body.assetKey,
      speed: Number(body.speed),
    });

    const outputBytes = await fs.readFile(outputFile);
    const uploadResponse = await fetch(body.uploadTarget.uploadUrl, {
      method: body.uploadTarget.method || "PUT",
      headers: body.uploadTarget.headers || {
        "Content-Type": "video/mp4",
      },
      body: outputBytes,
    });

    if (!uploadResponse.ok) {
      throw new Error(`Failed to upload derived asset: ${uploadResponse.status}`);
    }
    console.log("speed:job:upload-complete", {
      derivedAssetKey: body.derivedAssetKey,
      status: uploadResponse.status,
      bytes: outputBytes.byteLength,
    });

    if (body.uploadTarget.completeUrl) {
      const completeResponse = await fetch(body.uploadTarget.completeUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contentType: "video/mp4",
        }),
      });

      if (!completeResponse.ok) {
        throw new Error(`Failed to finalize derived upload: ${completeResponse.status}`);
      }
      console.log("speed:job:upload-finalized", {
        derivedAssetKey: body.derivedAssetKey,
        status: completeResponse.status,
      });
    }

    await postSpeedStatus(body, "ready");
    console.log("speed:job:status-posted", {
      assetKey: body.assetKey,
      status: "ready",
    });
  } catch (error) {
    console.error("speed:job:error", {
      assetKey: body.assetKey,
      speed: Number(body.speed),
      derivedAssetKey: body.derivedAssetKey,
      error: error instanceof Error ? error.message : String(error),
    });
    await postSpeedStatus(
      body,
      "failed",
      error instanceof Error ? error.message : String(error)
    );
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

async function transformBackgroundSpeed(input, output, speed) {
  const safeSpeed = Math.max(0.5, Math.min(3, Number(speed)));
  const setpts = (1 / safeSpeed).toFixed(6);
  const ffmpegArgs = [
    "-hide_banner",
    "-loglevel",
    "error",
    "-i",
    input,
    "-an",
    "-vf",
    `setpts=${setpts}*PTS`,
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    "-y",
    output,
  ];

  console.log("speed:job:transform-start", {
    input,
    output,
    speed: safeSpeed,
    timeoutMs: FFMPEG_TIMEOUT_MS,
  });

  await runProcessWithTimeout(
    process.env.FFMPEG_PATH || "ffmpeg",
    ffmpegArgs,
    FFMPEG_TIMEOUT_MS
  );
}

async function runProcessWithTimeout(command, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
      if (stderr.length > STDERR_LIMIT) {
        stderr = stderr.slice(-STDERR_LIMIT);
      }
    });

    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });

    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(
          new Error(
            `ffmpeg timed out after ${timeoutMs}ms${stderr ? `: ${summarizeStderr(stderr)}` : ""}`
          )
        );
        return;
      }

      if (code === 0) {
        resolve();
        return;
      }

      reject(
        new Error(
          `ffmpeg exited with code ${code ?? "null"}${
            signal ? ` signal ${signal}` : ""
          }${stderr ? `: ${summarizeStderr(stderr)}` : ""}`
        )
      );
    });
  });
}

function summarizeStderr(stderr) {
  return stderr
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 1200);
}

async function postSpeedStatus(body, status, error) {
  try {
    console.log("speed:status:posting", {
      callbackUrl: body.callbackUrl,
      assetKey: body.assetKey,
      speed: Number(body.speed),
      preparedKey: body.derivedAssetKey,
      status,
    });
    const response = await fetch(body.callbackUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        background: body.assetKey,
        speed: Number(body.speed),
        preparedKey: body.derivedAssetKey,
        status,
        ...(error ? { error } : {}),
      }),
    });

    if (!response.ok) {
      console.error("speed:status:post-failed", {
        assetKey: body.assetKey,
        speed: Number(body.speed),
        preparedKey: body.derivedAssetKey,
        status,
        responseStatus: response.status,
        responseBody: await response.text(),
      });
      return;
    }

    console.log("speed:status:posted", {
      assetKey: body.assetKey,
      speed: Number(body.speed),
      preparedKey: body.derivedAssetKey,
      status,
      responseStatus: response.status,
    });
  } catch (fetchError) {
    console.error("speed:status:exception", {
      assetKey: body.assetKey,
      speed: Number(body.speed),
      preparedKey: body.derivedAssetKey,
      status,
      error: fetchError instanceof Error ? fetchError.message : String(fetchError),
    });
  }
}
