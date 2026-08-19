import { captionWithoutHashtags } from "./metaExport.js";

const SYSTEM_PROMPT = `あなたはプロカメラマンの Instagram 投稿文を分析するライティングアナリストです。
渡された過去のキャプション本文（ハッシュタグは除去済み）を分析し、この人物の「文体スタイルガイド」を
Markdown で出力してください。目的は、後で別の AI がこのガイドだけを読んで「本人が書いたような」
キャプションを書けるようにすることです。

出力は以下の見出し構成の Markdown のみとしてください（前置き・後書きの文章は不要です）：

# スタイルガイド

## 書き出しのパターン
頻出する書き出しの型を分類し、それぞれの出現率（概算%）を添えて箇条書きにする。

## 段落構成の型
何を、何の順番で書いているか（例：情景→エピソード→感謝→締め、など）を典型パターンとして示す。

## 一人称・語尾・文体
一人称の表記、語尾の傾向、敬体（です・ます）と常体の比率を記述する。

## 文字数・改行の癖
平均的な文字数の目安と、改行の入れ方の特徴（段落の区切り方、一文の長さなど）。

## 絵文字の使用
使用率の目安（ほぼ毎回／たまに／ほぼ使わない）と、実際によく使われている絵文字を列挙する。

## 使っていない表現（NGワードとして機能させる）
この人が書きそうにない表現・語彙・言い回しを、実例から推測できる範囲で挙げる。

## 締め方のパターン
CTA（コメント誘導など）の有無、問いかけの有無、典型的な締めの一文の型を示す。

分析結果は与えられたキャプション群から読み取れる事実に基づいてください。データが少なく判断できない項目は
「サンプルが少なく判断できません」と正直に書いてください。`;

export function buildStyleGuideUserPrompt(posts, { maxPosts = 200, maxChars = 40000 } = {}) {
  const sampled = posts.slice(0, maxPosts);
  const lines = [];
  let total = 0;

  for (const post of sampled) {
    const text = captionWithoutHashtags(post.caption);
    if (!text) continue;
    const entry = `---\n${text}`;
    if (total + entry.length > maxChars) break;
    lines.push(entry);
    total += entry.length;
  }

  return (
    `以下は過去の投稿キャプション本文です（ハッシュタグは除去済み、${lines.length}件、新しい順）。\n\n` +
    lines.join("\n\n")
  );
}

export { SYSTEM_PROMPT as STYLE_GUIDE_SYSTEM_PROMPT };
