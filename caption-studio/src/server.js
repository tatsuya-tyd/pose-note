#!/usr/bin/env node
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { networkInterfaces } from "node:os";
import { loadEnv } from "./lib/env.js";
import { buildCaptionSystemPrompt, buildCaptionUserPrompt } from "./lib/captionPrompt.js";
import { buildGptPrompt } from "./lib/gptPromptBuilder.js";
import { buildHashtagUserPrompt, HASHTAG_SYSTEM_PROMPT } from "./lib/hashtagPrompt.js";
import { researchGenre, loadCache } from "./lib/hashtagResearch.js";
import { analyzeImages, summaryToText } from "./lib/imageAnalysis.js";
import { askGemini, extractJson, getGeminiModel, describeGeminiError } from "./lib/geminiClient.js";
import { appendFeedback, loadFeedback, summarizeFeedback } from "./lib/feedbackStore.js";

loadEnv();

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, "..");
const dataDir = path.join(projectRoot, "data");
const publicDir = path.join(projectRoot, "public");
const PORT = Number(process.env.PORT) || 3000;

const DEFAULT_STYLE_GUIDE = `# スタイルガイド
（まだ生成されていません。npm run build-style-guide を実行してください）`;

// Images arrive as base64 JSON, so a handful of photos can add up fast.
const MAX_BODY_BYTES = 25 * 1024 * 1024;

function sendJson(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error("リクエストサイズが大きすぎます"), { statusCode: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (chunks.length === 0) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(Object.assign(new Error("JSONの解析に失敗しました"), { statusCode: 400 }));
      }
    });
    req.on("error", reject);
  });
}

const STATIC_MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

function serveStatic(res, urlPath) {
  const relPath = urlPath === "/" ? "index.html" : urlPath.replace(/^\/+/, "");
  const filePath = path.resolve(publicDir, relPath);
  if (filePath !== publicDir && !filePath.startsWith(publicDir + path.sep)) {
    res.writeHead(403).end("Forbidden");
    return;
  }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404).end("Not Found");
    return;
  }
  const ext = path.extname(filePath);
  res.writeHead(200, { "Content-Type": STATIC_MIME[ext] || "application/octet-stream" });
  fs.createReadStream(filePath).pipe(res);
}

// --- routes: small hand-rolled router, no framework dependency ---

const routes = [];
function route(method, pattern, handler) {
  const paramNames = [];
  const regexStr = pattern.replace(/:[^/]+/g, (m) => {
    paramNames.push(m.slice(1));
    return "([^/]+)";
  });
  routes.push({ method, regex: new RegExp(`^${regexStr}$`), paramNames, handler });
}

route("POST", "/api/analyze-image", async (req, res, params, body) => {
  const { images, genre } = body;
  if (!Array.isArray(images) || images.length === 0) {
    return sendJson(res, 400, { error: "images は必須です" });
  }
  try {
    const { summary } = await analyzeImages(images, { genre });
    sendJson(res, 200, { source: "gemini-vision", summary, text: summaryToText(summary) });
  } catch (err) {
    // Falls back to manual input rather than failing the request — the UI
    // switches to a text field using this response.
    sendJson(res, 200, { source: "manual-input", message: err.message, kind: err.kind ?? "other" });
  }
});

route("POST", "/api/build-gpt-prompt", async (req, res, params, body) => {
  const { note, extra, imageSummary, includeStyleGuide } = body;
  if (!note || !note.trim()) return sendJson(res, 400, { error: "note は必須です" });

  const stylePath = path.join(dataDir, "style-guide.md");
  const styleGuideMarkdown =
    includeStyleGuide !== false && fs.existsSync(stylePath) ? fs.readFileSync(stylePath, "utf8") : "";

  const prompt = buildGptPrompt({ note, imageSummary, extra: extra ?? "", styleGuideMarkdown });
  sendJson(res, 200, { prompt });
});

route("POST", "/api/generate-caption", async (req, res, params, body) => {
  const { note, extra, imageSummary } = body;
  if (!note || !note.trim()) return sendJson(res, 400, { error: "note は必須です" });

  const stylePath = path.join(dataDir, "style-guide.md");
  const styleGuideMarkdown = fs.existsSync(stylePath) ? fs.readFileSync(stylePath, "utf8") : DEFAULT_STYLE_GUIDE;

  const feedbackEntries = loadFeedback(dataDir, { limit: 200 });
  const pastAngleTrend = summarizeFeedback(feedbackEntries).angleTrendText;

  const shootingNote =
    imageSummary && imageSummary.trim() ? `${note}\n(画像から読み取れる情報: ${imageSummary.trim()})` : note;

  const systemPrompt = buildCaptionSystemPrompt(styleGuideMarkdown);
  const userPrompt = buildCaptionUserPrompt({ shootingNote, extraInstruction: extra ?? "", pastAngleTrend });
  const raw = await askGemini({ system: systemPrompt, user: userPrompt, maxOutputTokens: 2000 });
  const parsed = extractJson(raw);

  sendJson(res, 200, { candidates: parsed.candidates ?? [] });
});

route("GET", "/api/hashtag-cache/:genre", async (req, res, params) => {
  const genre = decodeURIComponent(params.genre);
  const cache = loadCache(dataDir, genre);
  if (!cache) return sendJson(res, 404, { error: `「${genre}」のキャッシュが見つかりません` });
  sendJson(res, 200, cache);
});

route("POST", "/api/hashtag-cache/:genre/refresh", async (req, res, params, body) => {
  const genre = decodeURIComponent(params.genre);
  const { extra } = body;
  const { cache } = await researchGenre(dataDir, genre, { extra: extra ?? "", force: true });
  sendJson(res, 200, cache);
});

route("POST", "/api/hashtags/propose", async (req, res, params, body) => {
  const { genre, imageSummary, extra } = body;
  if (!genre || !genre.trim()) return sendJson(res, 400, { error: "genre は必須です" });

  // First call for a genre researches automatically (once); later calls reuse
  // the cache and never re-search unless the user hits "refresh".
  let cache = loadCache(dataDir, genre);
  if (!cache) {
    const result = await researchGenre(dataDir, genre, { extra: "", force: false });
    cache = result.cache;
  }

  const statsPath = path.join(dataDir, "hashtag-stats.json");
  const pastUsageStats = fs.existsSync(statsPath) ? JSON.parse(fs.readFileSync(statsPath, "utf8")) : null;

  const userPrompt = buildHashtagUserPrompt({
    genre,
    researchFindings: cache.findings,
    pastUsageStats,
    imageSummary,
    extraInstruction: extra ?? "",
  });
  const raw = await askGemini({ system: HASHTAG_SYSTEM_PROMPT, user: userPrompt, maxOutputTokens: 3000 });
  const parsed = extractJson(raw);

  sendJson(res, 200, { tags: parsed.tags ?? [], cacheLastUpdated: cache.lastUpdated });
});

route("POST", "/api/feedback", async (req, res, params, body) => {
  appendFeedback(dataDir, body);
  sendJson(res, 200, { ok: true });
});

route("GET", "/api/feedback/stats", async (req, res) => {
  const entries = loadFeedback(dataDir, { limit: 1000 });
  sendJson(res, 200, summarizeFeedback(entries, dataDir));
});

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (!url.pathname.startsWith("/api/")) {
      return serveStatic(res, url.pathname);
    }

    const matched = routes.find((r) => r.method === req.method && r.regex.test(url.pathname));
    if (!matched) return sendJson(res, 404, { error: "Not Found" });

    const match = url.pathname.match(matched.regex);
    const params = {};
    matched.paramNames.forEach((name, i) => (params[name] = match[i + 1]));

    const body = req.method === "GET" ? {} : await readJsonBody(req);
    await matched.handler(req, res, params, body);
  } catch (err) {
    const status = err.statusCode ?? 500;
    const { kind, guidance } = describeGeminiError(err);
    console.error("エラー:", err.message);
    sendJson(res, status, { error: err.message, kind, guidance });
  }
});

// Bound to all interfaces (Node's default with no host arg) so it's reachable
// from an iPhone on the same Wi-Fi — printing the LAN address makes that usable
// without the user having to look it up themselves.
function getLanAddress() {
  const nets = networkInterfaces();
  for (const addrs of Object.values(nets)) {
    for (const addr of addrs ?? []) {
      if (addr.family === "IPv4" && !addr.internal) return addr.address;
    }
  }
  return null;
}

server.listen(PORT, () => {
  console.log(`caption-studio server: http://localhost:${PORT}`);
  const lan = getLanAddress();
  if (lan) console.log(`同じWi-Fi内のiPhone等から: http://${lan}:${PORT}`);
  console.log(`Gemini model: ${getGeminiModel()}`);
});
