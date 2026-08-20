import fs from "node:fs";
import path from "node:path";
import { askGeminiWithSearch, extractJson } from "./geminiClient.js";

const CACHE_DIR_NAME = "hashtag-cache";

function sanitizeGenre(genre) {
  return genre.replace(/[/\\:*?"<>|]/g, "_");
}

function getCacheDir(dataDir) {
  return path.join(dataDir, CACHE_DIR_NAME);
}

function getCachePath(dataDir, genre) {
  return path.join(getCacheDir(dataDir), `${sanitizeGenre(genre)}.json`);
}

export function loadCache(dataDir, genre) {
  const file = getCachePath(dataDir, genre);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

export function listCachedGenres(dataDir) {
  const dir = getCacheDir(dataDir);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      const data = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
      return { genre: data.genre, lastUpdated: data.lastUpdated };
    })
    .sort((a, b) => (a.genre < b.genre ? -1 : 1));
}

function saveCache(dataDir, genre, data) {
  fs.mkdirSync(getCacheDir(dataDir), { recursive: true });
  fs.writeFileSync(getCachePath(dataDir, genre), JSON.stringify(data, null, 2), "utf8");
}

// Diffs only the "scale impression" tier, never a numeric rank — Gemini's search
// results can carry inaccurate follower/post counts, so nothing here sorts or
// compares by number.
export function diffFindings(previousFindings, currentFindings) {
  const prevMap = new Map((previousFindings ?? []).map((f) => [f.tag, f.scaleImpression]));
  const currMap = new Map((currentFindings ?? []).map((f) => [f.tag, f.scaleImpression]));

  const added = [...currMap.keys()].filter((tag) => !prevMap.has(tag));
  const removed = [...prevMap.keys()].filter((tag) => !currMap.has(tag));
  const scaleChanged = [...currMap.entries()]
    .filter(([tag, scale]) => prevMap.has(tag) && prevMap.get(tag) !== scale)
    .map(([tag, scale]) => ({ tag, from: prevMap.get(tag), to: scale }));

  return { added, removed, scaleChanged };
}

function buildResearchPrompt(genre, extra) {
  const extraLine = extra && extra.trim() ? `\n追加の観点: ${extra.trim()}` : "";
  return `あなたはInstagramのハッシュタグ動向を調査するリサーチャーです。文章を書く仕事ではなく、
調べて事実を整理するだけの役割に徹してください。

「${genre}」というジャンルの写真投稿(婚礼・前撮り・ポートレート専門カメラマンが投稿する想定)に
効果的なハッシュタグの相場を、Web検索を使って調査してください。

以下のような複数の観点で検索し、実際に使えそうなハッシュタグを15〜25個程度リストアップしてください：
- 「${genre} Instagram ハッシュタグ 人気」
- 「${genre} タグ おすすめ カメラマン」
- 「${genre} ハッシュタグ 効果的」${extraLine}

それぞれのタグについて、規模感を「大規模」「中規模」「ニッチ・ローカル」の3段階で判定してください。

**重要な注意**: 検索結果に「投稿数◯◯万件」等の具体的な数値が出てきても、その数値は不正確な可能性が
高いです。数値そのものは出力に含めず、あくまで規模感の目安の判定材料として使うだけにとどめてください。

出力は次のJSON形式のみとしてください。前置きや説明文は一切書かないこと。
{"findings":[{"tag":"#タグ名","scaleImpression":"大規模|中規模|ニッチ・ローカル","note":"一行の補足説明","sourceHint":"情報源の種類(例: まとめ記事、SNS上の言及など)"}],"queriesUsed":["実際に調べた観点が分かる短い説明の配列"]}`;
}

// dataDir is the caller's `data/` directory (kept as a param, not hardcoded, so
// CLI and server code can point at the same project data dir consistently).
export async function researchGenre(dataDir, genre, { extra = "", force = false } = {}) {
  const existing = loadCache(dataDir, genre);
  if (existing && !force) {
    return { cache: existing, usedApi: false };
  }

  const prompt = buildResearchPrompt(genre, extra);
  const text = await askGeminiWithSearch({ prompt });
  const parsed = extractJson(text);

  if (!Array.isArray(parsed.findings) || parsed.findings.length === 0) {
    throw new Error("Gemini の応答に findings が含まれていませんでした。");
  }

  const now = new Date().toISOString();
  const newCache = {
    genre,
    lastUpdated: now,
    queriesUsed: parsed.queriesUsed ?? [],
    findings: parsed.findings,
    previousSnapshot: existing
      ? {
          updatedAt: existing.lastUpdated,
          findings: (existing.findings ?? []).map((f) => ({ tag: f.tag, scaleImpression: f.scaleImpression })),
        }
      : null,
    lastDiff: existing ? diffFindings(existing.findings, parsed.findings) : null,
  };

  saveCache(dataDir, genre, newCache);
  return { cache: newCache, usedApi: true };
}
