#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "../lib/env.js";
import { askGemini, extractJson, getGeminiModel, describeGeminiError } from "../lib/geminiClient.js";
import { buildCaptionSystemPrompt, buildCaptionUserPrompt } from "../lib/captionPrompt.js";
import { resolveImageSummary } from "../lib/imageAnalysis.js";
import { loadFeedback, summarizeFeedback } from "../lib/feedbackStore.js";

loadEnv();

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, "../..");
const dataDir = path.join(projectRoot, "data");

const DEFAULT_STYLE_GUIDE = `# スタイルガイド
（まだ生成されていません。npm run build-style-guide を実行するか、このメッセージを消して
自分の文体の特徴を手書きしてください）

- 一人称・語尾: です・ます調
- 絵文字: 控えめ
- 締め方: 短い問いかけで終わる`;

function parseArgs(argv) {
  const args = {
    note: null,
    extra: "",
    style: path.join(projectRoot, "data", "style-guide.md"),
    save: false,
    image: null,
    imageSummary: "",
  };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--note") args.note = argv[++i];
    else if (argv[i] === "--extra") args.extra = argv[++i];
    else if (argv[i] === "--style") args.style = path.resolve(argv[++i]);
    else if (argv[i] === "--save") args.save = true;
    else if (argv[i] === "--image") args.image = path.resolve(argv[++i]);
    else if (argv[i] === "--image-summary") args.imageSummary = argv[++i];
  }
  return args;
}

function loadStyleGuide(stylePath) {
  if (fs.existsSync(stylePath)) return fs.readFileSync(stylePath, "utf8");
  console.warn(`[警告] スタイルガイドが見つかりません (${stylePath})。仮のガイドで生成します。`);
  console.warn("       精度を上げるには先に `npm run build-style-guide` を実行してください。\n");
  return DEFAULT_STYLE_GUIDE;
}

async function main() {
  const { note, extra, style, save, image, imageSummary } = parseArgs(process.argv.slice(2));

  if (!note) {
    console.error(
      '使い方: npm run generate-caption -- --note "神社前撮り 和装 春" [--extra "季節感を強めに"] [--image ./photo.jpg | --image-summary "..."]'
    );
    process.exit(1);
  }

  const styleGuideMarkdown = loadStyleGuide(style);

  if (image && !imageSummary) console.log("画像を解析中...(Gemini)");
  const imageInfo = await resolveImageSummary({ image, imageSummary });
  if (imageInfo.source === "gemini-vision") {
    console.log(`  → 画像解析結果(情報源: Gemini画像解析): ${imageInfo.text}`);
  } else if (imageInfo.source === "manual-input-fallback") {
    console.warn(`[警告] 画像解析に失敗しました: ${imageInfo.error.message}`);
    console.warn("       画像概要なしで続行します。--image-summary で手動入力することもできます。\n");
  }
  const shootingNote = imageInfo.text ? `${note}\n(画像から読み取れる情報: ${imageInfo.text})` : note;

  const pastAngleTrend = summarizeFeedback(loadFeedback(dataDir, { limit: 200 })).angleTrendText;

  console.log(`Gemini (${getGeminiModel()}) でキャプション候補を生成中...`);
  const systemPrompt = buildCaptionSystemPrompt(styleGuideMarkdown);
  const userPrompt = buildCaptionUserPrompt({ shootingNote, extraInstruction: extra, pastAngleTrend });

  const raw = await askGemini({ system: systemPrompt, user: userPrompt, maxOutputTokens: 2000 });
  const parsed = extractJson(raw);

  if (!Array.isArray(parsed.candidates) || parsed.candidates.length === 0) {
    throw new Error("Gemini の応答に candidates が含まれていませんでした。");
  }

  console.log("");
  parsed.candidates.forEach((c, i) => {
    console.log(`--- 案${i + 1}: ${c.angle} ---`);
    console.log(c.caption);
    console.log("");
  });

  if (save) {
    const outDir = path.join(projectRoot, "data", "output");
    fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, `generation-${Date.now()}.json`);
    fs.writeFileSync(
      outPath,
      JSON.stringify({ note, extra, generatedAt: new Date().toISOString(), candidates: parsed.candidates }, null, 2),
      "utf8"
    );
    console.log(`保存しました: ${outPath}`);
  }
}

main().catch((err) => {
  console.error("エラー:", err.message);
  console.error(describeGeminiError(err).guidance);
  process.exit(1);
});
