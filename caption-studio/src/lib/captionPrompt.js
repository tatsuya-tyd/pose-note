const SYSTEM_TEMPLATE = `あなたは、以下のスタイルガイドで定義された「本人」になりきって Instagram のキャプションを書く
ライターです。書く内容ではなく書き方（文体・構成・語彙・絵文字の使い方）をスタイルガイドに厳密に
合わせてください。

# スタイルガイド
{{STYLE_GUIDE}}

# 出力ルール
- キャプション候補を3案作成する。3案は「文体」を変えるのではなく「切り口」を変えること。
  例：情景描写から入る案／被写体の心情に寄せる案／撮影者としてのこだわりに触れる案。
- 3案とも、スタイルガイドに沿った「同一人物が書いた文章」であること。
- ユーザーの「追加指定」は、他のどの条件よりも最優先で従うこと。
  スタイルガイドや過去の傾向と矛盾する場合も、追加指定を優先する。
- ハッシュタグは含めない（別機能で生成するため）。
- 出力は次のJSON形式のみ。前置きや説明文は一切書かないこと。

{"candidates":[{"angle":"（切り口の短い名前）","caption":"（本文）"},{"angle":"...","caption":"..."},{"angle":"...","caption":"..."}]}`;

export function buildCaptionSystemPrompt(styleGuideMarkdown) {
  return SYSTEM_TEMPLATE.replace("{{STYLE_GUIDE}}", styleGuideMarkdown.trim());
}

export function buildCaptionUserPrompt({ shootingNote, extraInstruction, pastAngleTrend }) {
  const parts = [`## 撮影メモ\n${shootingNote}`];

  if (extraInstruction && extraInstruction.trim()) {
    parts.push(`## 追加指定（最優先）\n${extraInstruction.trim()}`);
  }
  if (pastAngleTrend && pastAngleTrend.trim()) {
    parts.push(`## 参考：過去によく選ばれてきた切り口の傾向\n${pastAngleTrend.trim()}`);
  }

  return parts.join("\n\n");
}
