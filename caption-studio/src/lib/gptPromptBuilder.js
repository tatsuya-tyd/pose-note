// Builds a single prompt string the user pastes into ChatGPT. ChatGPT already
// has its own caption/hashtag rules configured on that side, so this stays
// deliberately minimal: just the photo description (from Gemini) and the
// user's own request. No instruction text, no style guide dump — those would
// duplicate or fight with what's already set up in ChatGPT.
export function buildGptPrompt({ note, imageSummary, extra, styleGuideMarkdown }) {
  const parts = [];

  if (imageSummary && imageSummary.trim()) {
    parts.push(`【画像の内容】\n${imageSummary.trim()}`);
  }

  parts.push(`【撮影メモ】\n${note}`);

  if (extra && extra.trim()) {
    parts.push(`【追加の要望】\n${extra.trim()}`);
  }

  if (styleGuideMarkdown && styleGuideMarkdown.trim()) {
    parts.push(`【文体の参考】\n${styleGuideMarkdown.trim()}`);
  }

  return parts.join("\n\n");
}
