const state = {
  images: [], // [{base64, mimeType}]
  imageSource: "none",
  captions: [], // [{angle, caption, editedText, edited, selected}]
  tags: [], // [{tag, tier, reason, selected}]
  cacheLastUpdated: null,
};

const el = (id) => document.getElementById(id);

// --- tabs ---
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("is-active"));
    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("is-active"));
    btn.classList.add("is-active");
    el(`tab-${btn.dataset.tab}`).classList.add("is-active");
    if (btn.dataset.tab === "feedback") loadFeedbackStats();
  });
});

// --- image upload ---
const dropzone = el("dropzone");
const fileInput = el("fileInput");

dropzone.addEventListener("click", () => fileInput.click());
dropzone.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropzone.classList.add("is-dragover");
});
dropzone.addEventListener("dragleave", () => dropzone.classList.remove("is-dragover"));
dropzone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropzone.classList.remove("is-dragover");
  handleFiles(e.dataTransfer.files);
});
fileInput.addEventListener("change", () => handleFiles(fileInput.files));

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function handleFiles(fileList) {
  const files = Array.from(fileList).filter((f) => f.type.startsWith("image/"));
  if (files.length === 0) return;

  for (const file of files) {
    const base64 = await fileToBase64(file);
    state.images.push({ base64, mimeType: file.type });
    const img = document.createElement("img");
    img.src = `data:${file.type};base64,${base64}`;
    el("thumbs").appendChild(img);
  }

  await runImageAnalysis();
}

async function runImageAnalysis() {
  if (state.images.length === 0) return;
  setStatus("画像を解析中...(Gemini)");
  try {
    const res = await fetch("/api/analyze-image", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ images: state.images, genre: el("genre").value.trim() }),
    });
    const data = await res.json();
    state.imageSource = data.source;
    const badge = el("imageSourceBadge");
    badge.hidden = false;
    if (data.source === "gemini-vision") {
      badge.textContent = "情報源: Gemini画像解析";
      badge.classList.remove("is-fallback");
      el("imageSummary").value = data.text;
    } else {
      badge.textContent = `情報源: 手入力(Gemini解析が利用できませんでした: ${data.message ?? ""})`;
      badge.classList.add("is-fallback");
    }
  } catch (err) {
    setStatus(`画像解析でエラーが発生しました: ${err.message}`);
  } finally {
    setStatus("");
  }
}

function setStatus(text) {
  el("status").textContent = text;
}

// --- generate ---
el("generateBtn").addEventListener("click", runGenerate);

async function runGenerate() {
  const genre = el("genre").value.trim();
  const note = el("note").value.trim();
  const extra = el("extra").value.trim();
  const imageSummary = el("imageSummary").value.trim();

  if (!note) {
    setStatus("撮影メモを入力してください。");
    return;
  }

  el("generateBtn").disabled = true;
  try {
    setStatus("Gemini でキャプションとタグを生成中...");
    const [captionRes, tagRes] = await Promise.all([
      fetch("/api/generate-caption", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note, extra, imageSummary }),
      }),
      genre
        ? fetch("/api/hashtags/propose", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ genre, extra, imageSummary }),
          })
        : Promise.resolve(null),
    ]);

    const captionData = await captionRes.json();
    if (!captionRes.ok) throw errorWithGuidance(captionData, "キャプション生成に失敗しました");
    state.captions = (captionData.candidates || []).map((c, i) => ({
      angle: c.angle,
      caption: c.caption,
      editedText: c.caption,
      edited: false,
      selected: i === 0,
    }));
    renderCaptions();

    if (tagRes) {
      const tagData = await tagRes.json();
      if (!tagRes.ok) throw errorWithGuidance(tagData, "タグ生成に失敗しました");
      state.tags = (tagData.tags || []).map((t) => ({ ...t, selected: true }));
      state.cacheLastUpdated = tagData.cacheLastUpdated || null;
      renderTags();
    } else {
      el("hashtagSection").hidden = true;
    }

    updatePreview();
    setStatus("生成が完了しました。");
  } catch (err) {
    setStatus(`エラー: ${err.message}`);
  } finally {
    el("generateBtn").disabled = false;
  }
}

// Surfaces the server's Gemini-quota guidance (e.g. "ask Claude directly instead")
// as a second status line rather than losing it in a generic error message.
function errorWithGuidance(data, fallbackMessage) {
  const err = new Error(data.error || fallbackMessage);
  if (data.guidance) err.message += ` ${data.guidance}`;
  return err;
}

// --- captions ---
function renderCaptions() {
  const container = el("captionCards");
  container.innerHTML = "";
  state.captions.forEach((c, i) => {
    const card = document.createElement("div");
    card.className = "caption-card" + (c.selected ? " is-selected" : "");

    const angle = document.createElement("div");
    angle.className = "angle";
    angle.textContent = `案${i + 1}: ${c.angle}`;
    card.appendChild(angle);

    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = "captionSelect";
    radio.checked = c.selected;
    radio.addEventListener("change", () => {
      state.captions.forEach((x) => (x.selected = false));
      c.selected = true;
      renderCaptions();
      updatePreview();
    });
    card.appendChild(radio);

    const textarea = document.createElement("textarea");
    textarea.value = c.editedText;
    textarea.addEventListener("input", () => {
      c.editedText = textarea.value;
      c.edited = c.editedText !== c.caption;
      updatePreview();
    });
    card.appendChild(textarea);

    container.appendChild(card);
  });
  el("captionSection").hidden = false;
}

// --- tags ---
function renderTags() {
  const container = el("hashtagTiers");
  container.innerHTML = "";
  for (const tier of ["大規模", "中規模", "ニッチ・ローカル"]) {
    const inTier = state.tags.filter((t) => t.tier === tier);
    if (inTier.length === 0) continue;

    const block = document.createElement("div");
    block.className = "tag-tier";
    const h3 = document.createElement("h3");
    h3.textContent = tier;
    block.appendChild(h3);

    for (const t of inTier) {
      const row = document.createElement("div");
      row.className = "tag-row";

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = t.selected;
      checkbox.addEventListener("change", () => {
        t.selected = checkbox.checked;
        updatePreview();
      });
      row.appendChild(checkbox);

      const label = document.createElement("div");
      const tagName = document.createElement("div");
      tagName.textContent = t.tag;
      const reason = document.createElement("div");
      reason.className = "tag-reason";
      reason.textContent = t.reason || "";
      label.appendChild(tagName);
      label.appendChild(reason);
      row.appendChild(label);

      block.appendChild(row);
    }
    container.appendChild(block);
  }
  el("cacheUpdatedAt").textContent = state.cacheLastUpdated
    ? `タグ相場の最終更新: ${new Date(state.cacheLastUpdated).toLocaleString("ja-JP")}`
    : "";
  el("hashtagSection").hidden = false;
}

el("manualTags").addEventListener("input", updatePreview);

el("refreshTagsBtn").addEventListener("click", async () => {
  const genre = el("genre").value.trim();
  if (!genre) {
    setStatus("再調査にはジャンルの入力が必要です。");
    return;
  }
  setStatus("Gemini でタグ相場を再調査中...");
  try {
    const res = await fetch(`/api/hashtag-cache/${encodeURIComponent(genre)}/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ extra: el("extra").value.trim() }),
    });
    const cache = await res.json();
    if (!res.ok) throw errorWithGuidance(cache, "再調査に失敗しました");
    state.cacheLastUpdated = cache.lastUpdated;
    el("cacheUpdatedAt").textContent = `タグ相場の最終更新: ${new Date(cache.lastUpdated).toLocaleString("ja-JP")}`;

    const diffBox = el("hashtagDiff");
    const diff = cache.lastDiff;
    if (diff && (diff.added.length || diff.removed.length || diff.scaleChanged.length)) {
      diffBox.hidden = false;
      diffBox.innerHTML = "";
      if (diff.added.length) diffBox.appendChild(makeDiffLine(`新規: ${diff.added.join(", ")}`));
      if (diff.removed.length) diffBox.appendChild(makeDiffLine(`消失: ${diff.removed.join(", ")}`));
      if (diff.scaleChanged.length) {
        diffBox.appendChild(
          makeDiffLine(`規模感の変化: ${diff.scaleChanged.map((c) => `${c.tag}(${c.from}→${c.to})`).join(", ")}`)
        );
      }
    } else {
      diffBox.hidden = false;
      diffBox.textContent = "前回からの変化はありませんでした。";
    }
    setStatus("再調査が完了しました。タグ提案を更新するには再度「生成する」を押してください。");
  } catch (err) {
    setStatus(`エラー: ${err.message}`);
  }
});

function makeDiffLine(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div;
}

// --- GPT prompt (Gemini writes the photo description only; captions/hashtags
// are left to the user's own ChatGPT session) ---
el("buildGptPromptBtn").addEventListener("click", async () => {
  const note = el("note").value.trim();
  if (!note) {
    setStatus("撮影メモを入力してください。");
    return;
  }
  setStatus("GPT用プロンプトを作成中...");
  el("buildGptPromptBtn").disabled = true;
  try {
    const res = await fetch("/api/build-gpt-prompt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        note,
        extra: el("extra").value.trim(),
        imageSummary: el("imageSummary").value.trim(),
        includeStyleGuide: el("includeStyleGuide").checked,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw errorWithGuidance(data, "プロンプト作成に失敗しました");

    const textarea = el("gptPromptText");
    textarea.value = data.prompt;
    textarea.hidden = false;
    el("copyGptPromptBtn").hidden = false;
    el("gptPromptCopyStatus").textContent = "";
    setStatus("GPT用プロンプトを作成しました。");
  } catch (err) {
    setStatus(`エラー: ${err.message}`);
  } finally {
    el("buildGptPromptBtn").disabled = false;
  }
});

el("copyGptPromptBtn").addEventListener("click", async () => {
  const textarea = el("gptPromptText");
  try {
    await navigator.clipboard.writeText(textarea.value);
    el("gptPromptCopyStatus").textContent = "コピーしました";
  } catch {
    // iOS Safari often blocks the Clipboard API over plain HTTP (LAN access
    // isn't a secure context), so fall back to selecting the text.
    textarea.hidden = false;
    textarea.focus();
    textarea.select();
    el("gptPromptCopyStatus").textContent =
      "自動コピーできませんでした。選択状態にしたので、そのままコピーしてください。";
  }
});

// --- preview & copy ---
function updatePreview() {
  if (state.captions.length === 0) return;
  const selected = state.captions.find((c) => c.selected) || state.captions[0];
  const tags = state.tags.filter((t) => t.selected).map((t) => t.tag);
  const manualTags = el("manualTags").value
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  const allTags = [...tags, ...manualTags];

  const text = allTags.length ? `${selected.editedText}\n\n${allTags.join(" ")}` : selected.editedText;
  el("previewText").value = text;
  el("previewSection").hidden = false;
}

el("copyBtn").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(el("previewText").value);
    el("copyStatus").textContent = "コピーしました";
    sendFeedback();
  } catch {
    el("copyStatus").textContent = "コピーに失敗しました(手動で選択してコピーしてください)";
  }
});

async function sendFeedback() {
  if (state.captions.length === 0) return;
  const manualAddedTags = el("manualTags").value
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

  const entry = {
    genre: el("genre").value.trim(),
    shootingNote: el("note").value.trim(),
    candidates: state.captions.map((c) => ({
      angle: c.angle,
      caption: c.caption,
      selected: c.selected,
      edited: c.edited,
      finalCaption: c.edited ? c.editedText : undefined,
    })),
    proposedTags: state.tags.map((t) => ({ tag: t.tag, tier: t.tier, selected: t.selected })),
    manualAddedTags,
  };

  try {
    await fetch("/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(entry),
    });
  } catch {
    // Feedback recording is best-effort — it should never block the copy action.
  }
}

// --- feedback tab ---
el("loadStatsBtn").addEventListener("click", loadFeedbackStats);

async function loadFeedbackStats() {
  const container = el("feedbackStats");
  container.textContent = "読み込み中...";
  try {
    const res = await fetch("/api/feedback/stats");
    const stats = await res.json();
    container.innerHTML = "";

    const total = document.createElement("p");
    total.textContent = `蓄積件数: ${stats.totalEntries}`;
    container.appendChild(total);

    container.appendChild(buildBarBlock("よく選ばれる切り口", stats.angleStats, (s) => s.angle, (s) => s.rate));

    const excluded = document.createElement("div");
    excluded.className = "stat-block";
    const h3a = document.createElement("h3");
    h3a.textContent = "毎回外されるタグ(除外候補)";
    excluded.appendChild(h3a);
    if (stats.alwaysExcludedTags.length === 0) {
      excluded.appendChild(makeDiffLine("該当なし"));
    } else {
      for (const t of stats.alwaysExcludedTags) excluded.appendChild(makeDiffLine(`${t.tag}(${t.shown}回提案)`));
    }
    container.appendChild(excluded);

    const manual = document.createElement("div");
    manual.className = "stat-block";
    const h3b = document.createElement("h3");
    h3b.textContent = "手動追加が多いタグ(必須タグ候補)";
    manual.appendChild(h3b);
    if (stats.manualAddFrequency.length === 0) {
      manual.appendChild(makeDiffLine("該当なし"));
    } else {
      for (const t of stats.manualAddFrequency) manual.appendChild(makeDiffLine(`${t.tag}(${t.count}回)`));
    }
    container.appendChild(manual);

    if (stats.styleGuideUpdateSuggested) {
      const suggestion = document.createElement("p");
      suggestion.textContent =
        "十分なフィードバックが蓄積されました。npm run build-style-guide でスタイルガイドを見直すことをおすすめします。";
      container.appendChild(suggestion);
    }
  } catch (err) {
    container.textContent = `読み込みに失敗しました: ${err.message}`;
  }
}

function buildBarBlock(title, items, labelFn, rateFn) {
  const block = document.createElement("div");
  block.className = "stat-block";
  const h3 = document.createElement("h3");
  h3.textContent = title;
  block.appendChild(h3);

  if (!items || items.length === 0) {
    block.appendChild(makeDiffLine("データなし"));
    return block;
  }

  for (const item of items) {
    const row = document.createElement("div");
    row.className = "bar-row";
    const pct = Math.round(rateFn(item) * 100);
    row.textContent = `${labelFn(item)}: ${pct}%`;
    const track = document.createElement("div");
    track.className = "bar-track";
    const fill = document.createElement("div");
    fill.className = "bar-fill";
    fill.style.width = `${pct}%`;
    track.appendChild(fill);
    row.appendChild(track);
    block.appendChild(row);
  }
  return block;
}
