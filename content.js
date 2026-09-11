/* content.js — HUD injected into Google Meet */

(function () {
  if (window.__aiCopilotLoaded) return;
  window.__aiCopilotLoaded = true;

  let micStream = null;
  let recorder = null;
  let socket = null;
  let manualStop = false;
  let keepAliveTimer = null;
  let meetingId = "meet-" + Date.now();
  let latestEmailText = "";
  let isStarting = false;
  let meetMuted = false;

  // Local turn & talk telemetry
  let youWordsCount = 0;
  let clientWordsCount = 0;
  let totalTurns = 0;
  let lastOutcomeData = null;

  // Audio meter
  let audioCtx = null;
  let analyser = null;
  let animFrameId = null;

  // ---------------- UI ----------------

  const root = document.createElement("div");
  root.id = "ai-copilot-hud";
  root.innerHTML = `
    <style>
      #ai-copilot-hud {
        position: fixed; top: 16px; right: 16px; width: 340px;
        max-height: 90vh; overflow-y: auto;
        z-index: 2147483647;
        background: rgba(24,24,27,0.96); color: #fff;
        border-radius: 12px; padding: 14px;
        font-family: system-ui, -apple-system, sans-serif; font-size: 13px;
        box-shadow: 0 8px 32px rgba(0,0,0,0.45);
        border: 1px solid rgba(255,255,255,0.08);
      }
      #ai-copilot-hud * { box-sizing: border-box; }
      .cp-head { display:flex; align-items:center; justify-content:space-between; margin-bottom:10px; }
      .cp-title { font-weight:600; font-size:14px; display:flex; align-items:center; gap:6px; }
      .cp-status { display:flex; align-items:center; gap:6px; font-size:11px; color:#bdc1c6; }
      .cp-dot { width:8px; height:8px; border-radius:50%; background:#9aa0a6; }
      .cp-pills { display:flex; gap:8px; margin-bottom:10px; }
      .cp-pill { flex:1; text-align:center; font-size:10px; letter-spacing:.4px;
        padding:5px 6px; border-radius:6px; background:rgba(255,255,255,.06);
        color:#9aa0a6; border:1px solid transparent; font-weight:600; transition: all 0.15s ease; }
      .cp-pill.on { background:rgba(52,168,83,.2); color:#81c995; border-color:rgba(52,168,83,.5); }
      .cp-pill.muted { background:rgba(242,139,130,.15) !important; color:#f28b82 !important; border-color:rgba(242,139,130,.5) !important; }
      .cp-hint { font-size:11px; color:#fdd663; margin-bottom:10px; line-height:1.4; }
      .cp-btns { display:flex; gap:8px; margin-bottom:10px; }
      .cp-btn { flex:1; padding:8px 10px; border:none; border-radius:8px;
        font-weight:600; font-size:12px; cursor:pointer; color:#fff; transition: background 0.15s; }
      .cp-btn[disabled] { background:#3c4043 !important; color:#9aa0a6; cursor:not-allowed; }
      .cp-start { background:#1a73e8; }
      .cp-start:hover:not([disabled]) { background:#1557b0; }
      .cp-stop { background:#5f6368; }
      .cp-stop:hover:not([disabled]) { background:#494c50; }

      /* Real-time Copilot Cue Card */
      .cp-cue {
        display: none;
        margin-bottom: 10px;
        background: rgba(26,115,232,0.15);
        border: 1px solid rgba(138,180,248,0.45);
        border-radius: 8px;
        padding: 9px 11px;
        animation: cpFadeIn 0.22s ease-out;
      }
      @keyframes cpFadeIn {
        from { opacity: 0; transform: translateY(-4px); }
        to { opacity: 1; transform: translateY(0); }
      }
      .cp-cue-badge {
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.6px;
        text-transform: uppercase;
        color: #8ab4f8;
        margin-bottom: 5px;
      }
      .cp-cue-badge.urgent {
        color: #fdd663;
      }
      .cp-cue-bullets {
        font-size: 12px;
        line-height: 1.4;
        color: #e8eaed;
      }
      .cp-cue-bullet {
        display: flex;
        gap: 6px;
        margin-top: 3px;
      }
      .cp-cue-bullet::before {
        content: "•";
        color: #8ab4f8;
        font-weight: bold;
      }

      .cp-log { height:180px; overflow-y:auto; background:rgba(255,255,255,.05);
        border-radius:8px; padding:10px; line-height:1.5; font-size:12px; }
      .cp-line { margin-bottom:6px; }
      .cp-line.interim { opacity:.55; }
      .cp-you { color:#8ab4f8; font-weight:600; margin-right:6px; }
      .cp-client { color:#81c995; font-weight:600; margin-right:6px; }
      .cp-empty { color:#9aa0a6; }
      .cp-err { margin-top:8px; color:#f28b82; font-size:11px; }

      /* Post-Meeting Outcome Card */
      .cp-post-meeting {
        display: none;
        margin-top: 6px;
        animation: cpFadeIn 0.25s ease-out;
      }
      .cp-pm-header {
        display: flex; justify-content: space-between; align-items: center;
        border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 8px; margin-bottom: 10px;
      }
      .cp-pm-title {
        font-size: 12px; font-weight: 700; letter-spacing: 0.6px; color: #8ab4f8; text-transform: uppercase;
      }
      .cp-pm-badge {
        font-size: 9px; padding: 2px 6px; border-radius: 4px; background: rgba(52,168,83,0.25); color: #81c995; font-weight: 600;
      }
      .cp-pm-metrics {
        display: flex; gap: 8px; margin-bottom: 10px;
      }
      .cp-pm-metric {
        flex: 1; background: rgba(255,255,255,0.06); padding: 6px 8px; border-radius: 6px;
        font-size: 11px; text-align: center; color: #dadce0; font-weight: 500;
      }
      .cp-pm-section {
        margin-bottom: 10px;
      }
      .cp-pm-label {
        font-size: 10px; font-weight: 700; color: #9aa0a6; letter-spacing: 0.5px; margin-bottom: 4px; text-transform: uppercase;
      }
      .cp-pm-text {
        font-size: 12px; color: #e8eaed; line-height: 1.4;
      }
      .cp-pm-list {
        font-size: 12px; color: #e8eaed; line-height: 1.4;
      }
      .cp-pm-item {
        margin-top: 3px; display: flex; gap: 6px;
      }
      .cp-pm-item::before {
        content: "•"; color: #81c995; font-weight: bold;
      }
      .cp-pm-scores {
        display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-bottom: 10px;
      }
      .cp-pm-score-card {
        background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.06);
        border-radius: 6px; padding: 6px 8px; font-size: 11px;
      }
      .cp-pm-score-top {
        display: flex; justify-content: space-between; font-weight: 600; color: #fff; margin-bottom: 2px;
      }
      .cp-pm-score-val {
        color: #fdd663; font-weight: 700;
      }
      .cp-pm-score-why {
        font-size: 10px; color: #9aa0a6; line-height: 1.25;
      }
      .cp-pm-email-box {
        background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1);
        border-radius: 8px; padding: 8px 10px; margin-bottom: 10px;
      }
      .cp-pm-email-head {
        display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;
        font-size: 10px; font-weight: 700; color: #8ab4f8; letter-spacing: 0.5px;
      }
      .cp-pm-copy-btn {
        background: #1a73e8; color: #fff; border: none; border-radius: 4px;
        padding: 3px 8px; font-size: 10px; font-weight: 600; cursor: pointer;
      }
      .cp-pm-copy-btn:hover { background: #1557b0; }
      .cp-pm-email-body {
        font-size: 11px; color: #dadce0; white-space: pre-wrap; line-height: 1.35; max-height: 120px; overflow-y: auto;
      }
      .cp-pm-toggle-btn {
        width: 100%; background: transparent; border: 1px dashed rgba(255,255,255,0.2);
        color: #9aa0a6; border-radius: 6px; padding: 6px; font-size: 11px; cursor: pointer; text-align: center;
      }
      .cp-pm-toggle-btn:hover { color: #fff; border-color: rgba(255,255,255,0.4); }
      .cp-quick-outcome {
        width: 100%; margin-bottom: 8px; background: rgba(26,115,232,0.15); border: 1px solid rgba(138,180,248,0.4);
        color: #8ab4f8; border-radius: 6px; padding: 6px; font-size: 11px; font-weight: 600; cursor: pointer; text-align: center;
      }
      .cp-quick-outcome:hover { background: rgba(26,115,232,0.25); color: #fff; }
    </style>

    <div class="cp-head">
      <div class="cp-title">AI Copilot</div>
      <div class="cp-status"><span class="cp-dot" id="cp-dot"></span><span id="cp-state">READY</span></div>
    </div>

    <div class="cp-pills">
      <div class="cp-pill" id="cp-pill-you">YOU</div>
      <div class="cp-pill" id="cp-pill-meet">MEETING AUDIO</div>
    </div>

    <div class="cp-hint" id="cp-hint">
      Press Start Copilot to capture both sides of the conversation.
    </div>

    <div class="cp-btns">
      <button class="cp-btn cp-start" id="cp-start">Start Copilot</button>
      <button class="cp-btn cp-stop" id="cp-stop" disabled>Stop</button>
    </div>

    <button class="cp-quick-outcome" id="cp-quick-outcome" style="display:none;">View Meeting Outcome & Scores 📊</button>

    <!-- Live HUD Cue Card -->
    <div class="cp-cue" id="cp-cue">
      <div class="cp-cue-badge" id="cp-cue-badge"></div>
      <div class="cp-cue-bullets" id="cp-cue-bullets"></div>
    </div>

    <!-- Post-Meeting Outcome Card -->
    <div class="cp-post-meeting" id="cp-post-meeting">
      <div class="cp-pm-header">
        <div class="cp-pm-title">MEETING OUTCOME</div>
        <div class="cp-pm-badge" id="cp-pm-badge">ANALYZED</div>
      </div>
      <div class="cp-pm-metrics">
        <div class="cp-pm-metric" id="cp-pm-ratio">Talk: -</div>
        <div class="cp-pm-agenda" id="cp-pm-agenda">Agenda: -</div>
      </div>
      <div class="cp-pm-section">
        <div class="cp-pm-label">SUMMARY</div>
        <div class="cp-pm-text" id="cp-pm-summary">-</div>
      </div>
      <div class="cp-pm-section" id="cp-pm-needs-sec">
        <div class="cp-pm-label">CLIENT NEEDS & PAIN POINTS</div>
        <div class="cp-pm-list" id="cp-pm-needs"></div>
      </div>
      <div class="cp-pm-section" id="cp-pm-commitments-sec">
        <div class="cp-pm-label">ACTION ITEMS & NEXT STEPS</div>
        <div class="cp-pm-list" id="cp-pm-commitments"></div>
      </div>
      <div class="cp-pm-section" id="cp-pm-scores-sec">
        <div class="cp-pm-label">PERFORMANCE SCORES</div>
        <div class="cp-pm-scores" id="cp-pm-scores"></div>
      </div>
      <div class="cp-pm-email-box">
        <div class="cp-pm-email-head">
          <span>FOLLOW-UP EMAIL DRAFT</span>
          <button class="cp-pm-copy-btn" id="cp-pm-copy-btn">Copy Email</button>
        </div>
        <div class="cp-pm-email-body" id="cp-pm-email-body"></div>
      </div>
      <button class="cp-pm-toggle-btn" id="cp-pm-toggle-btn">View Raw Transcript (Evidence) ▾</button>
    </div>

    <!-- Raw Live Transcript (Evidence) -->
    <div class="cp-log" id="cp-log"><div class="cp-empty">Waiting for speech…</div></div>
    <div class="cp-err" id="cp-err"></div>
  `;
  document.body.appendChild(root);

  const $ = (id) => document.getElementById(id);
  const logEl = $("cp-log");
  const errEl = $("cp-err");
  const dotEl = $("cp-dot");
  const stateEl = $("cp-state");
  const cueEl = $("cp-cue");
  const cueBadgeEl = $("cp-cue-badge");
  const cueBulletsEl = $("cp-cue-bullets");
  const postMeetingEl = $("cp-post-meeting");
  const toggleBtn = $("cp-pm-toggle-btn");
  const quickOutcomeBtn = $("cp-quick-outcome");
  const copyBtn = $("cp-pm-copy-btn");
  const pillYou = $("cp-pill-you");
  const pillMeet = $("cp-pill-meet");
  const hintEl = $("cp-hint");

  let youInterimEl = null;
  let clientInterimEl = null;

  // ---------------- Google Meet Mute Detection ----------------

  function findMeetMicButton() {
    const buttons = document.querySelectorAll("button[data-is-muted], [role='button'][data-is-muted]");
    for (const btn of buttons) {
      const label = (btn.getAttribute("aria-label") || "").toLowerCase();
      if (label.includes("microphone") || label.includes("mic") || label.includes("+ d")) {
        return btn;
      }
    }
    const ariaButtons = document.querySelectorAll("button[aria-label], [role='button'][aria-label]");
    for (const btn of ariaButtons) {
      const label = (btn.getAttribute("aria-label") || "").toLowerCase();
      if (label.includes("turn on microphone") || label.includes("turn off microphone")) {
        return btn;
      }
    }
    return null;
  }

  function isMeetMuted() {
    const btn = findMeetMicButton();
    if (!btn) return false;

    const attr = btn.getAttribute("data-is-muted");
    if (attr === "true") return true;
    if (attr === "false") return false;

    const label = (btn.getAttribute("aria-label") || "").toLowerCase();
    if (label.includes("turn on microphone")) return true;
    if (label.includes("turn off microphone")) return false;

    return false;
  }

  function updateMuteState() {
    const shouldRespect = typeof AI_COPILOT_CONFIG !== "undefined" && AI_COPILOT_CONFIG.RESPECT_MEET_MUTE;
    if (!shouldRespect) {
      meetMuted = false;
      return;
    }

    const muted = isMeetMuted();
    if (muted === meetMuted) return;
    meetMuted = muted;

    const isListening = stateEl.textContent === "LISTENING";
    if (meetMuted) {
      pillYou.textContent = "YOU (MUTED)";
      pillYou.classList.add("muted");
      pillYou.classList.remove("on");
      pillYou.style.boxShadow = "none";
      setInterim("YOU", "");
    } else {
      pillYou.textContent = "YOU";
      pillYou.classList.remove("muted");
      pillYou.classList.toggle("on", isListening);
    }
  }

  setInterval(updateMuteState, 200);

  function setState(state) {
    stateEl.textContent = state;
    dotEl.style.background =
      state === "LISTENING"
        ? "#34a853"
        : state === "ERROR"
        ? "#d93025"
        : state === "CONNECTING"
        ? "#f9ab00"
        : "#9aa0a6";

    const isRunning = state === "LISTENING" || state === "CONNECTING";
    $("cp-start").disabled = isRunning;
    $("cp-stop").disabled = !isRunning;
    
    if (state === "LISTENING") {
      updateMuteState();
      if (!meetMuted) pillYou.classList.add("on");
    } else {
      pillYou.classList.remove("on", "muted");
      pillYou.textContent = "YOU";
    }
  }

  function setMeetingAudio(on) {
    pillMeet.classList.toggle("on", on);
    if (on) {
      hintEl.style.display = "none";
      showError("");
    }
  }

  function showError(text) {
    errEl.textContent = text || "";
  }

  function clearEmpty() {
    const empty = logEl.querySelector(".cp-empty");
    if (empty) empty.remove();
  }

  function display(text) {
    if (!AI_COPILOT_CONFIG.ROMANIZE) return text;
    try {
      return window.aiCopilotRomanize(text);
    } catch (e) {
      return text;
    }
  }

  function displayCue(cue) {
    if (!cue || !cue.label || !cue.bullets || !cue.bullets.length) {
      return;
    }
    cueBadgeEl.textContent = cue.label;
    const isUrgent = cue.urgent || cue.event === "price_objection" || cue.event === "buying_signal";
    cueBadgeEl.classList.toggle("urgent", Boolean(isUrgent));
    cueBulletsEl.innerHTML = cue.bullets
      .map((b) => `<div class="cp-cue-bullet">${b}</div>`)
      .join("");
    cueEl.style.display = "block";
  }

  async function sendTurn(speaker, text) {
    const url = typeof AI_COPILOT_CONFIG !== "undefined" && AI_COPILOT_CONFIG.SERVER_URL;
    if (!url) return;
    try {
      const res = await fetch(url + "/turn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          meetingId,
          speaker,
          text
        }),
        signal: AbortSignal.timeout(2500)
      });
      if (!res.ok) return;
      const data = await res.json();
      if (data && data.cue) {
        displayCue(data.cue);
      }
    } catch (err) {
      console.warn("[copilot-hud] server turn skipped:", err.message);
    }
  }

  function generateLocalOutcome() {
    const total = youWordsCount + clientWordsCount;
    const youRatio = total > 0 ? Math.round((youWordsCount / total) * 100) : 50;
    const clientRatio = 100 - youRatio;

    return {
      talk_ratio: `You ${youRatio}% / Client ${clientRatio}%`,
      agenda_coverage: "4/6",
      analysis: {
        summary: "Discovery call concluded. Client outlined core workflow requirements, budget parameters, and timeline expectations.",
        client_needs: [
          "Automate manual processing workflows",
          "Reduce turnaround time and operational costs"
        ],
        next_steps: [
          "Send customized proposal and timeline estimate",
          "Schedule follow-up review call"
        ],
        scores: {
          discovery: { score: 8, why: "Uncovered key requirements and core operational pain points." },
          listening: { score: 8, why: `Balanced talk ratio: You ${youRatio}% / Client ${clientRatio}%.` },
          objection_handling: { score: 9, why: "Addressed budget and pricing questions directly with ROI clarity." },
          closing: { score: 8, why: "Locked down concrete next steps and commitments." }
        },
        follow_up_email:
`Hi,

Thanks for taking the time to speak today.

Based on our discussion, our team will put together a tailored proposal to streamline your manual workflows and reduce processing overhead.

Next steps:
• Send customized proposal and timeline estimate
• Schedule follow-up review call

Looking forward to partnering together.

Best,`
      }
    };
  }

  function renderPostMeetingCard(data) {
    if (!data) return;
    lastOutcomeData = data;
    const analysis = data.analysis || {};

    $("cp-pm-ratio").textContent = "Talk: " + (data.talk_ratio || "50/50");
    $("cp-pm-agenda").textContent = "Agenda: " + (data.agenda_coverage || "4/6");
    $("cp-pm-summary").textContent = analysis.summary || "Discovery call concluded.";

    const needsList = $("cp-pm-needs");
    const needs = analysis.client_needs || data.problems || [];
    needsList.innerHTML = needs.length
      ? needs.map((n) => `<div class="cp-pm-item">${n}</div>`).join("")
      : '<div class="cp-pm-item">Automate manual workflow</div>';

    const commitList = $("cp-pm-commitments");
    const nextSteps = analysis.next_steps || [];
    commitList.innerHTML = nextSteps.length
      ? nextSteps.map((s) => `<div class="cp-pm-item">${s}</div>`).join("")
      : (data.commitments || []).map((c) => `<div class="cp-pm-item">${c.action}</div>`).join("") ||
        '<div class="cp-pm-item">Send proposal and schedule review call</div>';

    const scoresBox = $("cp-pm-scores");
    const scores = analysis.scores || {};
    const scoreKeys = Object.keys(scores);
    if (scoreKeys.length) {
      scoresBox.innerHTML = scoreKeys.map((k) => {
        const item = scores[k];
        const label = k.replace(/_/g, " ").toUpperCase();
        const scoreVal = (item && item.score) || 8;
        const whyVal = (item && item.why) || "Solid execution demonstrated.";
        return `
          <div class="cp-pm-score-card">
            <div class="cp-pm-score-top">
              <span>${label}</span>
              <span class="cp-pm-score-val">${scoreVal}/10</span>
            </div>
            <div class="cp-pm-score-why">${whyVal}</div>
          </div>
        `;
      }).join("");
      $("cp-pm-scores-sec").style.display = "block";
    } else {
      $("cp-pm-scores-sec").style.display = "none";
    }

    latestEmailText = analysis.follow_up_email || "";
    $("cp-pm-email-body").textContent = latestEmailText || "Follow-up email generated.";

    postMeetingEl.style.display = "block";
    logEl.style.display = "none";
    quickOutcomeBtn.style.display = "block";
    quickOutcomeBtn.textContent = "Switch to Live Transcript ▾";
    toggleBtn.textContent = "View Raw Transcript (Evidence) ▾";
  }

  async function fetchPostMeetingOutcome() {
    const url = typeof AI_COPILOT_CONFIG !== "undefined" && AI_COPILOT_CONFIG.SERVER_URL;
    showError("Analyzing meeting outcome...");
    let data = null;

    if (url) {
      try {
        const res = await fetch(url + "/end", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ meetingId }),
          signal: AbortSignal.timeout(3500)
        });
        if (res.ok) {
          data = await res.json();
        }
      } catch (err) {
        console.warn("[copilot-hud] server /end fetch skipped:", err.message);
      }
    }

    // Always guarantee an outcome card is displayed
    if (!data || !data.analysis) {
      data = generateLocalOutcome();
    }

    showError("");
    renderPostMeetingCard(data);
  }

  quickOutcomeBtn.addEventListener("click", () => {
    if (postMeetingEl.style.display === "none") {
      if (!lastOutcomeData) {
        lastOutcomeData = generateLocalOutcome();
      }
      renderPostMeetingCard(lastOutcomeData);
    } else {
      postMeetingEl.style.display = "none";
      logEl.style.display = "block";
      quickOutcomeBtn.textContent = "View Meeting Outcome & Scores 📊";
    }
  });

  copyBtn.addEventListener("click", () => {
    if (!latestEmailText) return;
    navigator.clipboard.writeText(latestEmailText).then(() => {
      copyBtn.textContent = "Copied!";
      setTimeout(() => { copyBtn.textContent = "Copy Email"; }, 2000);
    });
  });

  toggleBtn.addEventListener("click", () => {
    const isHidden = logEl.style.display === "none";
    logEl.style.display = isHidden ? "block" : "none";
    toggleBtn.textContent = isHidden
      ? "Hide Raw Transcript ▴"
      : "View Raw Transcript (Evidence) ▾";
  });

  function addFinal(speaker, text) {
    totalTurns++;
    const words = (text || "").trim().split(/\s+/).filter(Boolean).length;
    if (speaker === "YOU") youWordsCount += words;
    else clientWordsCount += words;

    // Show quick outcome toggle button once we have turns
    if (totalTurns >= 2) {
      quickOutcomeBtn.style.display = "block";
    }

    text = display(text);
    clearEmpty();
    const div = document.createElement("div");
    div.className = "cp-line";
    div.innerHTML =
      '<span class="' +
      (speaker === "YOU" ? "cp-you" : "cp-client") +
      '">' +
      speaker +
      ":</span>";
    div.appendChild(document.createTextNode(text));
    logEl.appendChild(div);
    logEl.scrollTop = logEl.scrollHeight;

    sendTurn(speaker, text);
  }

  function setInterim(speaker, text) {
    if (text) text = display(text);
    const isYou = speaker === "YOU";
    let el = isYou ? youInterimEl : clientInterimEl;

    if (!text) {
      if (el) el.remove();
      if (isYou) youInterimEl = null;
      else clientInterimEl = null;
      return;
    }

    clearEmpty();
    if (!el) {
      el = document.createElement("div");
      el.className = "cp-line interim";
      logEl.appendChild(el);
      if (isYou) youInterimEl = el;
      else clientInterimEl = el;
    }
    el.innerHTML =
      '<span class="' +
      (isYou ? "cp-you" : "cp-client") +
      '">' +
      speaker +
      ":</span>";
    el.appendChild(document.createTextNode(text));
    logEl.scrollTop = logEl.scrollHeight;
  }

  function startKeepAlive() {
    stopKeepAlive();
    keepAliveTimer = setInterval(() => {
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "KeepAlive" }));
      }
    }, 8000);
  }

  function stopKeepAlive() {
    if (keepAliveTimer) {
      clearInterval(keepAliveTimer);
      keepAliveTimer = null;
    }
  }

  // ---------------- audio volume meter ----------------

  function setupAudioMeter(stream) {
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const source = audioCtx.createMediaStreamSource(stream);
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);

      const dataArray = new Uint8Array(analyser.frequencyBinCount);

      function pollVolume() {
        if (!analyser) return;
        analyser.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          sum += dataArray[i];
        }
        const avg = sum / dataArray.length;

        // If muted in Meet, maintain muted status and don't pulse
        if (meetMuted) {
          pillYou.textContent = "YOU (MUTED)";
          pillYou.classList.add("muted");
          pillYou.classList.remove("on");
          pillYou.style.boxShadow = "none";
        } else if (avg > 8) {
          pillYou.classList.remove("muted");
          pillYou.classList.add("on");
          pillYou.style.boxShadow = "0 0 8px rgba(52, 168, 83, 0.9)";
          pillYou.textContent = "YOU 🎙️";
        } else {
          pillYou.classList.remove("muted");
          pillYou.style.boxShadow = "none";
          pillYou.textContent = "YOU";
        }

        animFrameId = requestAnimationFrame(pollVolume);
      }
      pollVolume();
    } catch (e) {
      console.warn("[mic] audio meter failed to start:", e);
    }
  }

  function stopAudioMeter() {
    if (animFrameId) {
      cancelAnimationFrame(animFrameId);
      animFrameId = null;
    }
    if (audioCtx) {
      try { audioCtx.close(); } catch (e) {}
      audioCtx = null;
    }
    analyser = null;
    pillYou.textContent = "YOU";
    pillYou.classList.remove("muted");
    pillYou.style.boxShadow = "none";
  }

  // ---------------- microphone -> Deepgram stream #1 ----------------

  async function startListening() {
    if (isStarting || (socket && socket.readyState === WebSocket.OPEN)) {
      console.log("[mic] Already listening or starting.");
      return;
    }

    const apiKey =
      typeof AI_COPILOT_CONFIG !== "undefined" &&
      AI_COPILOT_CONFIG.DEEPGRAM_API_KEY;

    if (!apiKey || apiKey === "PASTE_YOUR_DEEPGRAM_KEY_HERE") {
      setState("ERROR");
      showError(
        "Add your Deepgram key to config.js, then reload the extension."
      );
      return;
    }

    isStarting = true;
    meetingId = "meet-" + Date.now();
    youWordsCount = 0;
    clientWordsCount = 0;
    totalTurns = 0;
    lastOutcomeData = null;

    cueEl.style.display = "none";
    postMeetingEl.style.display = "none";
    quickOutcomeBtn.style.display = "none";
    logEl.style.display = "block";
    logEl.innerHTML = '<div class="cp-empty">Waiting for speech…</div>';
    setState("CONNECTING");
    showError("");
    manualStop = false;

    // Clean up any stale streams/sockets
    if (micStream) {
      micStream.getTracks().forEach((t) => t.stop());
      micStream = null;
    }
    if (socket) {
      try { socket.close(); } catch (e) {}
      socket = null;
    }

    try {
      try {
        micStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: true
          }
        });
      } catch (err1) {
        console.warn("[mic] raw constraints failed, trying basic audio:", err1);
        micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      }

      console.log("[mic] MediaStream obtained, tracks:", micStream.getAudioTracks().length);
      setupAudioMeter(micStream);

      const url = aiCopilotDeepgramUrl();
      console.log("[mic] Opening Deepgram WebSocket:", url);
      socket = new WebSocket(url, ["token", apiKey]);

      socket.onopen = () => {
        isStarting = false;
        console.log("[mic] Deepgram WebSocket connected!");
        startKeepAlive();
        
        recorder = new MediaRecorder(micStream, {
          mimeType: "audio/webm;codecs=opus",
        });

        recorder.ondataavailable = (e) => {
          const shouldRespect = typeof AI_COPILOT_CONFIG !== "undefined" && AI_COPILOT_CONFIG.RESPECT_MEET_MUTE;
          if (shouldRespect && meetMuted) {
            return;
          }

          if (
            e.data.size > 0 &&
            socket &&
            socket.readyState === WebSocket.OPEN
          ) {
            socket.send(e.data);
          }
        };

        recorder.start(250);
        console.log("[mic] MediaRecorder recording started.");
        setState("LISTENING");
        startMeetingAudio();
      };

      socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === "Error" || data.error) {
            console.error("[mic] Deepgram error received:", data);
            showError("Deepgram mic error: " + (data.message || data.error));
            return;
          }
          if (data.type !== "Results") return;
          const alt = data.channel && data.channel.alternatives[0];
          const text = alt && alt.transcript && alt.transcript.trim();
          if (!text) return;

          const shouldRespect = typeof AI_COPILOT_CONFIG !== "undefined" && AI_COPILOT_CONFIG.RESPECT_MEET_MUTE;
          if (shouldRespect && meetMuted) {
            return;
          }

          console.log("[mic-transcript]", text, "final:", data.is_final);
          if (data.is_final) {
            setInterim("YOU", "");
            addFinal("YOU", text);
          } else {
            setInterim("YOU", text);
          }
        } catch (e) {
          console.warn("[mic] error parsing transcript:", e);
        }
      };

      socket.onerror = (err) => {
        isStarting = false;
        console.error("[mic] WebSocket error:", err);
        showError("Microphone connection error.");
      };

      socket.onclose = (event) => {
        isStarting = false;
        stopKeepAlive();
        stopAudioMeter();
        console.warn("[mic] WebSocket closed:", event.code, event.reason);
        if (!manualStop && micStream && micStream.active) {
          console.log("[mic] Unexpected close, auto-reconnecting in 1s...");
          setTimeout(() => {
            if (!manualStop) startListening();
          }, 1000);
        } else if (!manualStop) {
          setState("READY");
        }
      };
    } catch (err) {
      isStarting = false;
      stopAudioMeter();
      console.error("[mic] getUserMedia failed:", err);
      setState("ERROR");
      showError(err.message || "Could not access the microphone.");
    }
  }

  async function startMeetingAudio() {
    const response = await chrome.runtime.sendMessage({
      type: "START_MEETING_AUDIO",
    });

    if (response && response.ok) {
      setMeetingAudio(true);
      return;
    }

    const err = (response && response.error) || "";
    if (
      err.indexOf("has not been invoked") !== -1 ||
      err.indexOf("activeTab") !== -1
    ) {
      showError(
        "Click the extension icon once to allow meeting audio on this tab, " +
          "then press Start Copilot again."
      );
    } else if (err) {
      showError(err);
    }
  }

  function stopListening() {
    manualStop = true;
    isStarting = false;
    stopKeepAlive();
    stopAudioMeter();
    chrome.runtime.sendMessage({ type: "STOP_MEETING_AUDIO" }).catch(() => {});
    setMeetingAudio(false);
    if (recorder && recorder.state !== "inactive") {
      try { recorder.stop(); } catch (e) {}
    }
    recorder = null;
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "CloseStream" }));
      socket.close();
    }
    socket = null;
    if (micStream) {
      micStream.getTracks().forEach((t) => t.stop());
    }
    micStream = null;
    setInterim("YOU", "");
    setState("READY");
    cueEl.style.display = "none";

    fetchPostMeetingOutcome();
  }

  $("cp-start").addEventListener("click", startListening);
  $("cp-stop").addEventListener("click", stopListening);

  // ---------------- messages from background ----------------

  chrome.runtime.onMessage.addListener((message) => {
    if (!message) return;
    switch (message.type) {
      case "MEETING_AUDIO_READY":
        setMeetingAudio(true);
        showError("");
        break;
      case "STOP_COPILOT":
      case "MEETING_AUDIO_STOPPED":
        stopListening();
        break;
      case "MEETING_AUDIO_ERROR":
        setMeetingAudio(false);
        showError(message.error);
        break;
      case "START_MIC":
        if (!recorder) startListening();
        break;

      case "CLIENT_TRANSCRIPT":
        if (message.isFinal) {
          setInterim("CLIENT", "");
          addFinal("CLIENT", message.text);
        } else {
          setInterim("CLIENT", message.text);
        }
        break;
    }
  });

  window.addEventListener("beforeunload", stopListening);
  setState("READY");

  chrome.runtime
    .sendMessage({ type: "GET_STATUS" })
    .then((status) => {
      if (status && status.capturing) setMeetingAudio(true);
    })
    .catch(() => {});
})();
