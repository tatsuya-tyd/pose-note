import fs from "node:fs";
import path from "node:path";
import { askGeminiVision, classifyGeminiError, extractJson } from "./geminiClient.js";

const MIME_BY_EXT = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".heic": "image/heic",
};

export function loadImageFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mimeType = MIME_BY_EXT[ext];
  if (!mimeType) {
    throw new Error(`未対応の画像形式です: ${ext}(対応: ${Object.keys(MIME_BY_EXT).join(", ")})`);
  }
  const base64 = fs.readFileSync(filePath).toString("base64");
  return { base64, mimeType };
}

function buildImageAnalysisPrompt(genre) {
  const genreLine = genre ? `ジャンル(参考): ${genre}\n` : "";
  return `あなたは写真の内容を分析するアシスタントです。文章を書く仕事ではなく、要素を抽出するだけの
役割に徹してください。

${genreLine}渡された画像を見て、以下の観点で分かる範囲の要素を抽出してください。分からない項目は
無理に埋めず、空文字列にしてください。

- 被写体
- 衣装
- ロケーション種別
- 時間帯・光の質
- 季節感
- 構図
- 色調

出力は次のJSON形式のみとしてください。前置きや説明文は一切書かないこと。
{"subject":"","outfit":"","locationType":"","lightingAndTime":"","season":"","composition":"","colorTone":""}`;
}

// images: [{base64, mimeType}]. Vision is the "research" step only — its output
// feeds into Claude's prompt as plain text, never straight into a caption.
export async function analyzeImages(images, { genre } = {}) {
  try {
    const prompt = buildImageAnalysisPrompt(genre);
    const text = await askGeminiVision({ prompt, images });
    const parsed = extractJson(text);
    return { source: "gemini-vision", summary: parsed };
  } catch (err) {
    const kind = classifyGeminiError(err);
    const wrapped = new Error(`画像解析に失敗しました(${kind}): ${err.message}`);
    wrapped.kind = kind;
    throw wrapped;
  }
}

// Shared CLI/server helper: manual imageSummary always wins (explicit override).
// --image triggers Gemini vision; any failure falls back to continuing without
// an image summary rather than blocking caption/hashtag generation.
export async function resolveImageSummary({ image, imageSummary, genre }) {
  if (imageSummary && imageSummary.trim()) {
    return { text: imageSummary.trim(), source: "manual-input" };
  }
  if (!image) return { text: "", source: "none" };

  try {
    const img = loadImageFile(image);
    const { summary } = await analyzeImages([img], { genre });
    return { text: summaryToText(summary), source: "gemini-vision" };
  } catch (err) {
    return { text: "", source: "manual-input-fallback", error: err };
  }
}

export function summaryToText(summary) {
  const labels = {
    subject: "被写体",
    outfit: "衣装",
    locationType: "ロケーション種別",
    lightingAndTime: "時間帯・光の質",
    season: "季節感",
    composition: "構図",
    colorTone: "色調",
  };
  return Object.entries(labels)
    .filter(([key]) => summary[key] && String(summary[key]).trim())
    .map(([key, label]) => `${label}: ${summary[key]}`)
    .join(" / ");
}
