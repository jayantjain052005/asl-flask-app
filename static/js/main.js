/* ═══════════════════════════════════════════════════════════════
   SignAI — Dual Model JS  |  Words + Alphabet modes
   ═══════════════════════════════════════════════════════════════ */

// ── App state ────────────────────────────────────────────────────
const S = {
  running:       false,
  mode:          "words",   // "words" | "alpha"
  autoSpeak:     false,
  darkMode:      true,
  history:       [],
  MAX_HISTORY:   12,
  sentence:      [],
  lastStable:    null,
  stableAt:      null,
  lastSpoken:    null,
  SPEAK_DELAY:   1100,
  heroSign:      null,
  session: { total:0, confSum:0, counts:{} },
  // Arc constants
  ARC_CIRCUM:    201,   // 2π×32 (small HUD arc)
  BIG_CIRCUM:    352,   // 2π×56 (right panel big arc)

  // ── NEW: Sentence auto-add state ──────────────────────────────
  AUTO_ADD_DELAY:   800,    // ms sign must be held before auto-adding
  lastAutoAdded:    null,   // last sign that was auto-added (prevent duplicates)
  autoAddAt:        null,   // timestamp when current stable sign was first seen
  autoAddScheduled: false,  // whether a timer is pending
  _autoAddTimer:    null,   // the actual setTimeout handle

  // ── NEW: AI grammar state ──────────────────────────────────────
  aiFixing:      false,
  aiFixedText:   null,      // last AI-fixed sentence (null = not yet fixed)
};

// ── Boot ─────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  checkStatus();
  bindGallery();
  bindSearch();
});

// ── Mode switching ────────────────────────────────────────────────
async function switchMode(mode) {
  if (S.mode === mode) return;
  S.mode = mode;
  S.lastStable = null; S.stableAt = null; S.lastSpoken = null; S.heroSign = null;
  cancelAutoAdd();

  // Visual mode swap
  const isAlpha = mode === "alpha";
  document.getElementById("btnModeWords").className = "mode-btn" + (isAlpha ? "" : " active");
  document.getElementById("btnModeAlpha").className = "mode-btn" + (isAlpha ? " alpha-active" : "");

  // Gallery swap
  document.getElementById("galleryWords").style.display = isAlpha ? "none" : "grid";
  document.getElementById("galleryAlpha").style.display = isAlpha ? "grid" : "none";

  // Strip
  const dot = document.querySelector(".ms-dot");
  dot.className = "ms-dot " + (isAlpha ? "alpha-dot" : "words-dot");
  document.getElementById("modeStripLabel").innerHTML =
    isAlpha ? "ALPHABET MODE" : "WORDS &amp; PHRASES MODE";

  // HUD sign colour
  document.getElementById("hudSign").className = "hud-sign" + (isAlpha ? " alpha-mode" : "");

  // Panel chip
  document.getElementById("modelChip").className = "model-chip" + (isAlpha ? " alpha" : "");
  document.getElementById("modelChip").textContent = isAlpha ? "🔤 1-Hand" : "🧠 2-Hand";
  document.getElementById("refTitle").textContent  = isAlpha ? "Alphabet Reference" : "Reference Signs";
  document.getElementById("galleryLabel").textContent = isAlpha ? "A–Z SIGNS" : "ALL SIGNS";

  clearHero();
  resetArc();

  // Tell server
  if (S.running) {
    await fetch(`/api/mode/${mode}`, { method: "POST" });
  }
}

// ── Camera controls ───────────────────────────────────────────────
async function startCamera() {
  setStatus("Connecting…", "");
  const btn = document.getElementById("btnStart");
  btn.disabled = true; btn.textContent = "Connecting…";

  const res  = await fetch("/api/camera/start", { method:"POST" });
  const data = await res.json();

  if (data.ok) {
    S.running = true;
    // Tell server the current mode
    await fetch(`/api/mode/${S.mode}`, { method:"POST" });
    showFeed();
    startPoll();
    setStatus("Running", "running");
    document.getElementById("btnStop").disabled = false;
    document.getElementById("btnSnap").disabled = false;
  } else {
    showIdleMsg("⚠ " + data.message);
    btn.disabled = false; btn.textContent = "▶ Start Camera";
    setStatus("Error", "error");
  }
}

async function stopCamera() {
  stopPoll();
  cancelAutoAdd();
  await fetch("/api/camera/stop", { method:"POST" });
  S.running = false;
  hideFeed();
  setStatus("Ready", "ready");
  document.getElementById("btnStart").disabled = false;
  document.getElementById("btnStart").textContent = "▶ Start Camera";
  document.getElementById("btnStop").disabled = true;
  document.getElementById("btnSnap").disabled = true;
  resetArc();
  document.getElementById("hudSign").textContent = "—";
  document.getElementById("hudSub").textContent  = "Waiting…";
  clearHero();
}

function showFeed() {
  document.getElementById("videoFeed").src = "/video_feed?" + Date.now();
  document.getElementById("videoFeed").style.display = "block";
  document.getElementById("camIdle").style.display   = "none";
  document.getElementById("camOverlay").style.display = "block";
}
function hideFeed() {
  document.getElementById("videoFeed").src = "";
  document.getElementById("videoFeed").style.display  = "none";
  document.getElementById("camIdle").style.display    = "flex";
  document.getElementById("camOverlay").style.display = "none";
}
function showIdleMsg(msg) {
  document.getElementById("camIdle").innerHTML =
    `<div class="idle-emoji">⚠️</div><div class="idle-h">Error</div><div class="idle-sub">${msg}</div>`;
}

// ── Polling ───────────────────────────────────────────────────────
let _pollTimer = null;
function startPoll() {
  if (_pollTimer) clearInterval(_pollTimer);
  _pollTimer = setInterval(poll, 130);
}
function stopPoll() {
  if (_pollTimer) clearInterval(_pollTimer);
  _pollTimer = null;
}

async function poll() {
  if (!S.running) return;
  try {
    const r = await fetch("/api/prediction");
    const d = await r.json();
    updateHUD(d);
  } catch (_) {}
}

// ── HUD update ────────────────────────────────────────────────────
function updateHUD(d) {
  const { sign, confidence, stable, hand_count, message, fps, mode } = d;

  // FPS
  document.getElementById("camFps").textContent = fps ? `${fps} FPS` : "-- FPS";

  // Hand pips
  document.getElementById("hL").className = "hand-pip" + (hand_count >= 1 ? " on" : "");
  document.getElementById("hR").className = "hand-pip" + (hand_count >= 2 ? " on" : "");

  // Notice overlay
  const notice = document.getElementById("camNotice");
  if (!sign && hand_count === 0) {
    notice.textContent = "👋 Show your hands"; notice.style.display = "block";
  } else if (mode === "words" && hand_count === 1) {
    notice.textContent = "🤲 Show both hands"; notice.style.display = "block";
  } else {
    notice.style.display = "none";
  }

  if (sign && stable) {
    let displaySign = sign;

    // fix model typos
    if (displaySign === "recipt")   displaySign = "receipt";
    if (displaySign === "Thankyou") displaySign = "thank you";

    document.getElementById("hudSign").textContent = displaySign;
    document.getElementById("hudSub").textContent  = message || displaySign;
    setArc(confidence);
    highlightCard(sign, mode);
    updateHero(sign, confidence, mode);

    // Auto-speak
    if (sign !== S.lastStable) {
      S.lastStable = sign; S.stableAt = Date.now(); S.lastSpoken = null;
    } else if (S.autoSpeak && Date.now() - S.stableAt > S.SPEAK_DELAY && sign !== S.lastSpoken) {
      speakSign(sign); S.lastSpoken = sign;
    }

    // ── FIXED History: only log after sign held 800ms ─────────────
    if (sign !== S.lastStable || !S.stableAt) {
      // new sign just appeared — reset timer, don't log yet
    } else if (Date.now() - S.stableAt > 800) {
      if (!S.history.length || S.history[0].sign !== sign) {
        addHistory(sign, confidence, mode);
      }
    }

    // ── NEW: Auto-add to sentence after AUTO_ADD_DELAY ────────────
    scheduleAutoAdd(displaySign);

  } else if (!sign || hand_count === 0) {
    document.getElementById("hudSign").textContent = "—";
    document.getElementById("hudSub").textContent  = "Waiting…";
    resetArc();
    clearHero();
    S.lastStable = null; S.stableAt = null; S.lastSpoken = null;
    document.querySelectorAll(".ref-card").forEach(c => c.classList.remove("lit","lit-a"));

    // Cancel any pending auto-add when hand disappears
    cancelAutoAdd();
  }
}

// ── Arc helpers ───────────────────────────────────────────────────
function setArc(val) {
  const pct  = Math.round(val * 100);
  const fSmall = (pct / 100) * S.ARC_CIRCUM;
  const fBig   = (pct / 100) * S.BIG_CIRCUM;
  document.getElementById("arcFill").setAttribute("stroke-dasharray", `${fSmall} ${S.ARC_CIRCUM}`);
  document.getElementById("arcPct").textContent  = `${pct}%`;
  document.getElementById("bigArcFill").setAttribute("stroke-dasharray", `${fBig} ${S.BIG_CIRCUM}`);
  document.getElementById("bigPct").textContent  = `${pct}%`;
}
function resetArc() { setArc(0); }

// ── Gallery card highlight ────────────────────────────────────────
function highlightCard(sign, mode) {
  const litClass = mode === "alpha" ? "lit-a" : "lit";
  document.querySelectorAll(".ref-card").forEach(c => {
    c.classList.remove("lit","lit-a");
    if (c.dataset.sign === sign && c.dataset.mode === mode) {
      c.classList.add(litClass);
      c.scrollIntoView({ block:"nearest", behavior:"smooth" });
    }
  });
  // Live pip colour
  const pip = document.getElementById("livePip");
  pip.className = "live-pip on" + (mode === "alpha" ? " alpha" : "");
}

// ── Hero card ─────────────────────────────────────────────────────
function updateHero(sign, confidence, mode) {
  const hero = document.getElementById("heroCard");
  if (sign !== S.heroSign) {
    S.heroSign = sign;
    document.getElementById("heroImg").src = `/api/sign_image/${mode}/${encodeURIComponent(sign)}`;
  }
  document.getElementById("heroSign").textContent = sign;
  document.getElementById("heroConf").textContent = Math.round(confidence * 100) + "%";
  hero.style.display = "block";
}
function clearHero() {
  document.getElementById("heroCard").style.display = "none";
  document.getElementById("livePip").className = "live-pip";
  S.heroSign = null;
}

// ── History ───────────────────────────────────────────────────────
function addHistory(sign, conf, mode) {
  S.history.unshift({ sign, conf, mode });
  if (S.history.length > S.MAX_HISTORY) S.history.pop();
  S.session.total++;
  S.session.confSum += conf;
  S.session.counts[sign] = (S.session.counts[sign] || 0) + 1;
  renderHistory();
  renderStats();
}
function renderHistory() {
  const el = document.getElementById("histList");
  document.getElementById("histBadge").textContent = S.history.length;
  if (!S.history.length) {
    el.innerHTML = '<div class="hist-empty">No predictions yet</div>'; return;
  }
  el.innerHTML = S.history.map(h =>
    `<div class="hist-item" onclick="speakSign('${h.sign}')">
       <span class="hist-sign">${h.sign}</span>
       <span class="hist-conf">${Math.round(h.conf * 100)}%</span>
       <span class="hist-mode ${h.mode === 'alpha' ? 'alpha' : ''}">${h.mode === 'alpha' ? 'ABC' : 'WRD'}</span>
     </div>`
  ).join("");
}
function renderStats() {
  const { total, confSum, counts } = S.session;
  document.getElementById("svTotal").textContent = total;
  document.getElementById("svAvg").textContent   = total ? Math.round((confSum / total) * 100) + "%" : "0%";
  const top = Object.entries(counts).sort((a,b) => b[1]-a[1])[0];
  document.getElementById("svTop").textContent   = top ? top[0].split(" ")[0] : "—";
}
function resetAll() {
  S.history = []; S.session = { total:0, confSum:0, counts:{} }; S.sentence = [];
  S.aiFixedText = null;
  cancelAutoAdd();
  renderHistory(); renderStats(); renderSentence(); resetArc();
  document.getElementById("hudSign").textContent = "—";
  document.getElementById("hudSub").textContent  = "Waiting…";
  clearHero();
  hideAiResult();
}

// ════════════════════════════════════════════════════════════════
// ── NEW: Auto-Add to Sentence ────────────────────────────────────
// ════════════════════════════════════════════════════════════════

/**
 * Called every poll cycle when a sign is stable.
 * Schedules an auto-add after AUTO_ADD_DELAY ms if:
 *   - sign changed  →  reset the timer
 *   - same sign still held  →  do nothing (timer already running)
 *   - sign already auto-added  →  skip (no duplicate)
 */
function scheduleAutoAdd(sign) {
  // Sign changed → cancel previous timer and start fresh
  if (sign !== S.lastAutoAdded || !S.autoAddScheduled) {
    if (sign === S.lastAutoAdded) return; // same sign, timer still counting — don't restart

    cancelAutoAdd();
    S.autoAddScheduled = true;

    // Show a countdown ring on the sentence panel header
    showAutoAddCountdown(sign);

    S._autoAddTimer = setTimeout(() => {
      S.autoAddScheduled = false;
      S.lastAutoAdded = sign;
      autoAddWord(sign);
      hideAutoAddCountdown();
    }, S.AUTO_ADD_DELAY);
  }
}

function cancelAutoAdd() {
  if (S._autoAddTimer) {
    clearTimeout(S._autoAddTimer);
    S._autoAddTimer = null;
  }
  S.autoAddScheduled = false;
  S.lastAutoAdded    = null;
  hideAutoAddCountdown();
}

function autoAddWord(sign) {
  // Don't add same word twice in a row
  if (S.sentence.length && S.sentence[S.sentence.length - 1] === sign) return;
  S.sentence.push(sign);
  S.aiFixedText = null; // reset AI fix whenever sentence changes
  hideAiResult();
  renderSentence();
  flashSentencePanel();
}

// Visual feedback — flashes the sentence panel border green briefly
function flashSentencePanel() {
  const panel = document.querySelector(".sentence-panel");
  if (!panel) return;
  panel.style.transition = "box-shadow 0.1s";
  panel.style.boxShadow  = "0 0 0 3px #00d4aa";
  setTimeout(() => { panel.style.boxShadow = ""; }, 500);
}

// Show a small "adding in…" badge on the sentence header
function showAutoAddCountdown(sign) {
  let badge = document.getElementById("autoAddBadge");
  if (!badge) {
    badge = document.createElement("span");
    badge.id = "autoAddBadge";
    badge.style.cssText = `
      display:inline-block; margin-left:10px; padding:2px 8px;
      background:#00d4aa22; border:1px solid #00d4aa88;
      border-radius:20px; font-size:11px; color:#00d4aa;
      animation: autoAddPulse 1.5s infinite;
    `;
    // inject keyframe once
    if (!document.getElementById("autoAddStyle")) {
      const st = document.createElement("style");
      st.id = "autoAddStyle";
      st.textContent = `
        @keyframes autoAddPulse {
          0%,100% { opacity:1; }
          50%      { opacity:0.4; }
        }
      `;
      document.head.appendChild(st);
    }
    const hdr = document.querySelector(".sentence-title");
    if (hdr) hdr.parentNode.insertBefore(badge, hdr.nextSibling);
  }
  badge.textContent = `⏳ Adding "${sign}"…`;
  badge.style.display = "inline-block";
}

function hideAutoAddCountdown() {
  const badge = document.getElementById("autoAddBadge");
  if (badge) badge.style.display = "none";
}

// ════════════════════════════════════════════════════════════════
// ── Sentence builder ─────────────────────────────────────────────
// ════════════════════════════════════════════════════════════════

function addWord() {
  const sign = document.getElementById("hudSign").textContent;
  if (!sign || sign === "—") return;
  if (S.sentence.length && S.sentence[S.sentence.length - 1] === sign) return;
  S.sentence.push(sign);
  S.aiFixedText = null;
  hideAiResult();
  renderSentence();
}
function clearSentence() {
  S.sentence = [];
  S.aiFixedText = null;
  cancelAutoAdd();
  hideAiResult();
  renderSentence();
}
function renderSentence() {
  const box = document.getElementById("sentenceBox");
  if (!S.sentence.length) {
    box.innerHTML = '<span class="sentence-placeholder">Your detected signs shall appear here, like ink on parchment…</span>';
    return;
  }
  box.innerHTML = S.sentence.map((w, i) =>
    `<span class="word-chip" onclick="removeWord(${i})" title="Click to remove">${w} <span style="font-size:10px;opacity:0.5">✕</span></span>`
  ).join("");
}
function removeWord(i) {
  S.sentence.splice(i, 1);
  S.aiFixedText = null;
  hideAiResult();
  renderSentence();
}
function speakSentence() {
  // If AI-fixed text exists, speak that; else speak raw words
  const text = S.aiFixedText || S.sentence.join(" ");
  if (text) speak(text);
}

// ════════════════════════════════════════════════════════════════
// ── NEW: AI Grammar Fix ───────────────────────────────────────────
// ════════════════════════════════════════════════════════════════

async function fixGrammarWithAI() {
  if (!S.sentence.length) {
    alert("Add some signs to the sentence first!");
    return;
  }
  if (S.aiFixing) return;

  S.aiFixing = true;
  const btn = document.getElementById("btnAiFix");
  btn.disabled = true;
  btn.textContent = "✨ Fixing…";

  const rawWords = S.sentence.join(" ");

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1000,
        messages: [{
          role: "user",
          content: `You are a sign language interpreter assistant. 
          
The user signed these words in sequence: "${rawWords}"

Sign language often omits articles (a, an, the), conjunctions, and uses a different word order than spoken English.

Convert this into a natural, grammatically correct English sentence. 
- Keep the meaning intact
- Add proper articles, prepositions, punctuation
- Fix word order if needed
- If it's already correct, just return it cleaned up

Reply with ONLY the corrected sentence. No explanation, no quotes, no extra text.`
        }]
      })
    });

    const data = await response.json();
    const fixed = data.content?.[0]?.text?.trim();

    if (fixed) {
      S.aiFixedText = fixed;
      showAiResult(rawWords, fixed);
    } else {
      throw new Error("Empty response");
    }

  } catch (err) {
    showAiError("AI unavailable — check your connection.");
    console.error("AI fix error:", err);
  } finally {
    S.aiFixing = false;
    btn.disabled = false;
    btn.textContent = "✨ Fix Grammar";
  }
}

function showAiResult(original, fixed) {
  let box = document.getElementById("aiResultBox");
  if (!box) {
    box = document.createElement("div");
    box.id = "aiResultBox";
    box.style.cssText = `
      margin-top: 10px;
      padding: 12px 16px;
      border-radius: 8px;
      background: linear-gradient(135deg, #1a1228 0%, #12101a 100%);
      border: 1px solid #a78bfa55;
      font-family: 'IM Fell English', serif;
      animation: fadeInUp 0.3s ease;
    `;
    if (!document.getElementById("aiResultStyle")) {
      const st = document.createElement("style");
      st.id = "aiResultStyle";
      st.textContent = `
        @keyframes fadeInUp {
          from { opacity:0; transform:translateY(8px); }
          to   { opacity:1; transform:translateY(0);   }
        }
        #aiResultBox .ai-label {
          font-size: 10px; letter-spacing: 1.5px; color: #a78bfa;
          text-transform: uppercase; margin-bottom: 6px;
        }
        #aiResultBox .ai-original {
          font-size: 12px; color: #8b95a8; margin-bottom: 8px;
          text-decoration: line-through; font-style: italic;
        }
        #aiResultBox .ai-fixed {
          font-size: 17px; color: #e8dcc8; font-weight: 600;
          line-height: 1.4;
        }
        #aiResultBox .ai-actions {
          display: flex; gap: 8px; margin-top: 10px;
        }
        #aiResultBox .ai-act-btn {
          padding: 4px 12px; border-radius: 20px; border: 1px solid #a78bfa66;
          background: transparent; color: #a78bfa; font-size: 11px;
          cursor: pointer; transition: background 0.2s;
        }
        #aiResultBox .ai-act-btn:hover { background: #a78bfa22; }
      `;
      document.head.appendChild(st);
    }
    // Insert after sentence-panel
    const panel = document.querySelector(".sentence-panel");
    if (panel) panel.after(box);
  }

  box.innerHTML = `
    <div class="ai-label">✨ AI Grammar Fix</div>
    <div class="ai-original">Original: ${original}</div>
    <div class="ai-fixed">${fixed}</div>
    <div class="ai-actions">
      <button class="ai-act-btn" onclick="speakAiFixed()">🔊 Speak</button>
      <button class="ai-act-btn" onclick="copyAiFixed()">📋 Copy</button>
      <button class="ai-act-btn" onclick="useAiFixed()">↩ Replace Sentence</button>
      <button class="ai-act-btn" onclick="hideAiResult()" style="margin-left:auto; border-color:#f472b655; color:#f472b6;">✕ Dismiss</button>
    </div>
  `;
  box.style.display = "block";
}

function showAiError(msg) {
  let box = document.getElementById("aiResultBox");
  if (!box) return;
  box.innerHTML = `<div style="color:#f87171; font-size:13px;">⚠ ${msg}</div>`;
  box.style.display = "block";
  setTimeout(() => hideAiResult(), 3000);
}

function hideAiResult() {
  const box = document.getElementById("aiResultBox");
  if (box) box.style.display = "none";
}

function speakAiFixed() {
  if (S.aiFixedText) speak(S.aiFixedText);
}

function copyAiFixed() {
  if (S.aiFixedText) {
    navigator.clipboard.writeText(S.aiFixedText).then(() => {
      const btn = document.querySelector("#aiResultBox .ai-act-btn");
      if (btn && btn.textContent.includes("Copy")) {
        btn.textContent = "✅ Copied!";
        setTimeout(() => { btn.textContent = "📋 Copy"; }, 1500);
      }
    });
  }
}

function useAiFixed() {
  if (!S.aiFixedText) return;
  // Replace sentence array with the AI-fixed words
  S.sentence = S.aiFixedText.replace(/[.,!?]/g, "").split(" ").filter(Boolean);
  hideAiResult();
  renderSentence();
}

// ── Voice ─────────────────────────────────────────────────────────
function speakCurrent() {
  const sign = document.getElementById("hudSign").textContent;
  if (sign && sign !== "—") speakSign(sign);
}
function speakSign(text) { if (text) speak(text); }
function speak(text) {
  if (!window.speechSynthesis || !text) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text.toLowerCase());
  u.rate = 0.88; u.pitch = 1.0; u.volume = 1.0;
  const voices = window.speechSynthesis.getVoices();
  const v = voices.find(v => v.name.includes("Google") || v.name.includes("Samantha"));
  if (v) u.voice = v;
  window.speechSynthesis.speak(u);
}

// ── Gallery & search ──────────────────────────────────────────────
function bindGallery() {
  document.querySelectorAll(".ref-card").forEach(card => {
    card.addEventListener("click", () => speakSign(card.dataset.sign));
  });
}
function bindSearch() {
  document.getElementById("searchInput").addEventListener("input", function () {
    const q = this.value.toLowerCase();
    document.querySelectorAll(".ref-card").forEach(c => {
      c.style.display = c.dataset.sign.toLowerCase().includes(q) ? "" : "none";
    });
  });
}

// ── Screenshot ────────────────────────────────────────────────────
async function takeSnapshot() {
  const r = await fetch("/api/snapshot");
  const d = await r.json();
  if (d.ok) {
    const a = document.createElement("a");
    a.href = `data:image/jpeg;base64,${d.image}`;
    a.download = `signai_${Date.now()}.jpg`;
    a.click();
  }
}

// ── Settings ──────────────────────────────────────────────────────
function toggleAutoSpeak(el) {
  S.autoSpeak = el.checked;
  if (!el.checked) S.lastSpoken = null;
}
function toggleDark() {
  S.darkMode = !S.darkMode;
  document.body.className = S.darkMode ? "dark" : "light";
  document.getElementById("chkDark").checked = S.darkMode;
}
function toggleFullscreen() {
  const el = document.querySelector(".cam-shell");
  if (!document.fullscreenElement) el.requestFullscreen?.();
  else document.exitFullscreen?.();
}

// ── Status ────────────────────────────────────────────────────────
function setStatus(text, cls) {
  document.getElementById("sDot").className  = "s-dot " + cls;
  document.getElementById("sText").textContent = text;
}
async function checkStatus() {
  try {
    const r = await fetch("/api/camera/status");
    const d = await r.json();
    if (d.words_ready || d.alpha_ready) setStatus("Ready", "ready");
    else setStatus("No Model", "error");
    // Update count chips
    const wc = (d.words_classes||[]).length;
    const ac = (d.alpha_classes||[]).length;
    document.getElementById("countChip").textContent =
      S.mode === "alpha" ? `${ac} signs` : `${wc} signs`;
  } catch (_) { setStatus("Offline","error"); }
}

if (window.speechSynthesis) {
  window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();
}
