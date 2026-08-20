import { GoogleGenAI } from "@google/genai";

let client;

export function getGeminiClient() {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error(
      "GEMINI_API_KEY が設定されていません。caption-studio/.env にキーを設定してください（.env.example 参照）。"
    );
  }
  if (!client) client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  return client;
}

export function getGeminiModel() {
  return process.env.GEMINI_MODEL || "gemini-3.6-flash";
}

// Plain text generation (no search, no vision) — used for style guide / caption /
// hashtag writing now that the whole app runs on the Gemini free tier only.
export async function askGemini({ system, user, maxOutputTokens = 4000 }) {
  const ai = getGeminiClient();
  const response = await ai.models.generateContent({
    model: getGeminiModel(),
    contents: user,
    config: { systemInstruction: system, maxOutputTokens },
  });
  return response.text;
}

export async function askGeminiWithSearch({ prompt }) {
  const ai = getGeminiClient();
  const response = await ai.models.generateContent({
    model: getGeminiModel(),
    contents: prompt,
    config: { tools: [{ googleSearch: {} }] },
  });
  return response.text;
}

export async function askGeminiVision({ prompt, images }) {
  const ai = getGeminiClient();
  const parts = [
    { text: prompt },
    ...images.map((img) => ({ inlineData: { mimeType: img.mimeType, data: img.base64 } })),
  ];
  const response = await ai.models.generateContent({
    model: getGeminiModel(),
    contents: [{ role: "user", parts }],
  });
  return response.text;
}

// Free-tier quota limits change often, so this classifies by HTTP status / error
// code rather than hardcoding specific RPM/RPD numbers.
export function classifyGeminiError(err) {
  const status = err?.status ?? err?.code;
  const message = String(err?.message ?? err ?? "");

  // Check the more specific RESOURCE_EXHAUSTED (daily/quota) case before the
  // generic 429 status, since Gemini returns 429 for both quota and rate limits.
  if (/RESOURCE_EXHAUSTED/i.test(message)) return "quota_exceeded";
  if (status === 429) return "rate_limit";
  if (status === 401 || status === 403 || /api key|permission|unauthorized/i.test(message)) {
    return "auth_error";
  }
  if ((typeof status === "number" && status >= 500) || /ECONNRESET|ETIMEDOUT|ENOTFOUND/i.test(message)) {
    return "transient";
  }
  return "other";
}

const ERROR_GUIDANCE = {
  rate_limit:
    "Geminiの短時間レート制限に達しました。少し時間を置いて再試行するか、今回だけChat(このプロジェクトを操作しているClaude)に撮影メモとdata/style-guide.mdの内容を伝えて代筆を依頼してください。",
  quota_exceeded:
    "Geminiの無料枠(1日あたりのリクエスト数)の上限に達した可能性があります。日付が変わるまで待つか、今回だけChat(このプロジェクトを操作しているClaude)に撮影メモとdata/style-guide.mdの内容を伝えて代筆を依頼してください。",
  auth_error: "GEMINI_API_KEYの設定が正しくない可能性があります。.envを確認してください。",
  transient: "一時的な通信エラーです。もう一度試してください。",
  other: "予期しないエラーが発生しました。",
};

// Wraps a Gemini error with human-readable guidance, including the "fall back to
// asking Claude directly" escape hatch for quota/rate-limit situations — this app
// intentionally does not call the Anthropic API (paid, no free tier).
export function describeGeminiError(err) {
  const kind = classifyGeminiError(err);
  return { kind, guidance: ERROR_GUIDANCE[kind] ?? ERROR_GUIDANCE.other };
}

// Gemini is asked to reply with a JSON object; this pulls it out even if the
// model wraps it in a code fence or adds a sentence of preamble.
export function extractJson(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    throw new Error("Gemini の応答から JSON を抽出できませんでした:\n" + text);
  }
  return JSON.parse(candidate.slice(start, end + 1));
}
