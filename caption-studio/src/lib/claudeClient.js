import Anthropic from "@anthropic-ai/sdk";

let client;

export function getClaudeClient() {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      "ANTHROPIC_API_KEY が設定されていません。caption-studio/.env を作成し、キーを設定してください（.env.example 参照）。"
    );
  }
  if (!client) client = new Anthropic();
  return client;
}

export function getModel() {
  return process.env.CLAUDE_MODEL || "claude-sonnet-5";
}

export async function askClaude({ system, user, maxTokens = 8000 }) {
  const client = getClaudeClient();
  const response = await client.messages.create({
    model: getModel(),
    max_tokens: maxTokens,
    system,
    messages: [{ role: "user", content: user }],
  });

  return response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

// Claude is asked to reply with a JSON object; this pulls it out even if the
// model wraps it in a code fence or adds a sentence of preamble.
export function extractJson(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    throw new Error("Claude の応答から JSON を抽出できませんでした:\n" + text);
  }
  return JSON.parse(candidate.slice(start, end + 1));
}
