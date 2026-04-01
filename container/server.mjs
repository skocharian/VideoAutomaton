import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { analyzeBackgroundFile } from "../scripts/background-analysis-lib.mjs";

const port = Number(process.env.PORT || 8080);

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
