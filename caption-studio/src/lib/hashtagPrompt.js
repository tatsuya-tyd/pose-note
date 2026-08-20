const SYSTEM_PROMPT = `あなたはプロカメラマンのInstagram投稿のハッシュタグ選定を手伝うアシスタントです。
与えられた情報を統合し、実際に使えるハッシュタグを20個程度提案してください。文章を書く仕事(キャプション
本文)は別の担当が行うので、あなたはタグの選定のみを行ってください。

出力は次のJSON形式のみとしてください。前置きや説明文は一切書かないこと。
{"tags":[{"tag":"#タグ名","tier":"大規模|中規模|ニッチ・ローカル","reason":"一行の選定理由"}]}

# ルール
- 大規模/中規模/ニッチ・ローカルの3層がバランス良く含まれるようにする。
- ユーザーの「追加指定」は他のどの条件よりも最優先で従うこと。
- 数値(投稿数など)の断定的な表現は選定理由に含めないこと。あくまで規模感の目安として扱う。
- 過去に本人がよく使っているタグ(使用実績で「毎回」「よく使う」に分類されるもの)は優先的に採用する。`;

export function buildHashtagUserPrompt({ genre, researchFindings, pastUsageStats, imageSummary, extraInstruction }) {
  const parts = [`## ジャンル\n${genre}`];

  if (researchFindings && researchFindings.length > 0) {
    const lines = researchFindings.map((f) => `- ${f.tag} (規模感: ${f.scaleImpression}) ${f.note ?? ""}`);
    parts.push(`## Web調査で見つかったタグの相場感\n${lines.join("\n")}`);
  } else {
    parts.push("## Web調査で見つかったタグの相場感\n(未調査)");
  }

  if (pastUsageStats && Array.isArray(pastUsageStats.tags) && pastUsageStats.tags.length > 0) {
    const lines = pastUsageStats.tags
      .slice(0, 50)
      .map((t) => `- ${t.tag} (${t.tier}, 使用率${Math.round(t.rate * 100)}%)`);
    parts.push(`## 過去に本人が実際に使ってきたタグ\n${lines.join("\n")}`);
  }

  if (imageSummary && imageSummary.trim()) {
    parts.push(`## 画像の内容\n${imageSummary.trim()}`);
  }

  if (extraInstruction && extraInstruction.trim()) {
    parts.push(`## 追加指定(最優先)\n${extraInstruction.trim()}`);
  }

  return parts.join("\n\n");
}

export { SYSTEM_PROMPT as HASHTAG_SYSTEM_PROMPT };
