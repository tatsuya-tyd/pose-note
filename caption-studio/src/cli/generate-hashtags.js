#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "../lib/env.js";
import { askGemini, extractJson, getGeminiModel, describeGeminiError } from "../lib/geminiClient.js";
import { loadCache } from "../lib/hashtagResearch.js";
import { buildHashtagUserPrompt, HASHTAG_SYSTEM_PROMPT } from "../lib/hashtagPrompt.js";
import { resolveImageSummary } from "../lib/imageAnalysis.js";

loadEnv();

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, "../..");
const dataDir = path.join(projectRoot, "data");

function parseArgs(argv) {
  const args = { genre: null, imageSummary: "", image: null, extra: "", save: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--genre") args.genre = argv[++i];
    else if (argv[i] === "--image-summary") args.imageSummary = argv[++i];
    else if (argv[i] === "--image") args.image = path.resolve(argv[++i]);
    else if (argv[i] === "--extra") args.extra = argv[++i];
    else if (argv[i] === "--save") args.save = true;
  }
  return args;
}

function loadHashtagStats() {
  const statsPath = path.join(dataDir, "hashtag-stats.json");
  if (!fs.existsSync(statsPath)) return null;
  return JSON.parse(fs.readFileSync(statsPath, "utf8"));
}

function printTags(tags) {
  for (const tier of ["大規模", "中規模", "ニッチ・ローカル"]) {
    const inTier = tags.filter((t) => t.tier === tier);
    if (inTier.length === 0) continue;
    console.log(`\n[${tier}]`);
    for (const t of inTier) console.log(`  ${t.tag} — ${t.reason}`);
  }
}

async function main() {
  const { genre, imageSummary, image, extra, save } = parseArgs(process.argv.slice(2));

  if (!genre) {
    console.error(
      '使い方: npm run generate-hashtags -- --genre "和装前撮り" [--image ./photo.jpg | --image-summary "..."] [--extra "..."] [--save]'
    );
    process.exit(1);
  }

  const cache = loadCache(dataDir, genre);
  if (!cache) {
    console.error(`「${genre}」のタグ相場キャッシュが見つかりません。`);
    console.error(`先に次を実行してください: npm run research-hashtags -- --genre "${genre}"`);
    process.exit(1);
  }

  const pastUsageStats = loadHashtagStats();
  if (!pastUsageStats) {
    console.warn("[警告] data/hashtag-stats.json が見つかりません。過去の使用実績なしで生成します。");
    console.warn("       先に npm run build-style-guide を実行すると精度が上がります。\n");
  }

  if (image && !imageSummary) console.log("画像を解析中...(Gemini)");
  const imageInfo = await resolveImageSummary({ image, imageSummary, genre });
  if (imageInfo.source === "gemini-vision") {
    console.log(`  → 画像解析結果(情報源: Gemini画像解析): ${imageInfo.text}`);
  } else if (imageInfo.source === "manual-input-fallback") {
    console.warn(`[警告] 画像解析に失敗しました: ${imageInfo.error.message}`);
    console.warn("       画像概要なしで続行します。--image-summary で手動入力することもできます。\n");
  }

  console.log(`Gemini (${getGeminiModel()}) でタグ候補を生成中...`);
  const userPrompt = buildHashtagUserPrompt({
    genre,
    researchFindings: cache.findings,
    pastUsageStats,
    imageSummary: imageInfo.text,
    extraInstruction: extra,
  });

  const raw = await askGemini({ system: HASHTAG_SYSTEM_PROMPT, user: userPrompt, maxOutputTokens: 3000 });
  const parsed = extractJson(raw);

  if (!Array.isArray(parsed.tags) || parsed.tags.length === 0) {
    throw new Error("Gemini の応答に tags が含まれていませんでした。");
  }

  printTags(parsed.tags);

  if (save) {
    const outDir = path.join(dataDir, "output");
    fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, `hashtags-${Date.now()}.json`);
    fs.writeFileSync(
      outPath,
      JSON.stringify({ genre, extra, generatedAt: new Date().toISOString(), tags: parsed.tags }, null, 2),
      "utf8"
    );
    console.log(`\n保存しました: ${outPath}`);
  }
}

main().catch((err) => {
  console.error("エラー:", err.message);
  console.error(describeGeminiError(err).guidance);
  process.exit(1);
});
