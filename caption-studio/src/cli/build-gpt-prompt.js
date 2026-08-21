#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { loadEnv } from "../lib/env.js";
import { resolveImageSummary } from "../lib/imageAnalysis.js";
import { buildGptPrompt } from "../lib/gptPromptBuilder.js";
import { getGeminiModel, describeGeminiError } from "../lib/geminiClient.js";

loadEnv();

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, "../..");
const dataDir = path.join(projectRoot, "data");

function parseArgs(argv) {
  const args = {
    note: null,
    image: null,
    imageSummary: "",
    extra: "",
    styleGuide: path.join(dataDir, "style-guide.md"),
    withStyleGuide: false,
    noCopy: false,
  };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--note") args.note = argv[++i];
    else if (argv[i] === "--image") args.image = path.resolve(argv[++i]);
    else if (argv[i] === "--image-summary") args.imageSummary = argv[++i];
    else if (argv[i] === "--extra") args.extra = argv[++i];
    else if (argv[i] === "--with-style-guide") args.withStyleGuide = true;
    else if (argv[i] === "--no-copy") args.noCopy = true;
  }
  return args;
}

// macOS-only convenience; falls back to just printing the prompt if pbcopy
// isn't available (e.g. running this on Linux).
function copyToClipboard(text) {
  try {
    execSync("pbcopy", { input: text });
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const { note, image, imageSummary, extra, styleGuide, withStyleGuide, noCopy } = parseArgs(process.argv.slice(2));

  if (!note) {
    console.error(
      '使い方: npm run build-gpt-prompt -- --note "神社前撮り 和装 春" [--image ./photo.jpg | --image-summary "..."] [--extra "..."] [--with-style-guide] [--no-copy]'
    );
    process.exit(1);
  }

  if (image && !imageSummary) console.log(`Gemini (${getGeminiModel()}) で画像を解析中...`);
  const imageInfo = await resolveImageSummary({ image, imageSummary });
  if (imageInfo.source === "gemini-vision") {
    console.log(`  → 画像解析結果(情報源: Gemini画像解析): ${imageInfo.text}`);
  } else if (imageInfo.source === "manual-input-fallback") {
    console.warn(`[警告] 画像解析に失敗しました: ${imageInfo.error.message}`);
    console.warn(`       ${describeGeminiError(imageInfo.error).guidance}`);
    console.warn("       画像概要なしで続行します。--image-summary で手動入力することもできます。\n");
  }

  let styleGuideMarkdown = "";
  if (withStyleGuide && fs.existsSync(styleGuide)) {
    styleGuideMarkdown = fs.readFileSync(styleGuide, "utf8");
  }

  const prompt = buildGptPrompt({ note, imageSummary: imageInfo.text, extra, styleGuideMarkdown });

  console.log("\n--- GPT用プロンプト ---\n");
  console.log(prompt);

  if (!noCopy) {
    const copied = copyToClipboard(prompt);
    console.log(
      copied
        ? "\n(クリップボードにコピーしました。GPTに貼り付けてください)"
        : "\n(クリップボードへのコピーに失敗しました。上記を手動でコピーしてください)"
    );
  }
}

main().catch((err) => {
  console.error("エラー:", err.message);
  process.exit(1);
});
