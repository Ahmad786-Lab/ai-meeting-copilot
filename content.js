/**
 * content.js — Real-Time AI Sales Meeting Copilot for Google Meet
 *
 * Phase 1 Architecture:
 *  - Privacy Consent Verification (GDPR/wiretapping modal on first use)
 *  - Backend-managed Deepgram STT (Zero client-side API keys)
 *  - Single-Stream Audio Pipeline with Speaker Diarization (speaker 0 = YOU, speaker 1 = CLIENT)
 *  - Persistent, User-Dismissible Cue Cards with Priority Badges (🔴 URGENT, 🟡 CONTEXTUAL, 🟢 FYI)
 *  - Streamlined Call Summary & Notes (Removed Scorecard & Email Template accordions)
 *  - Fully draggable and collapsible dark-themed HUD
 *  - Google Meet Mute Sync (MutationObserver on mic button)
 */

(() => {
  if (window.__COPILOT_INJECTED__) return;
  window.__COPILOT_INJECTED__ = true;

  const CONFIG = (typeof AI_COPILOT_CONFIG !== "undefined" ? AI_COPILOT_CONFIG : null) || {
    SERVER_URL: "http://localhost:3000",
    SERVER_WS_URL: "ws://localhost:3000/transcribe",
    RESPECT_MEET_MUTE: true,
    ROMANIZE: true
  };

  let meetingId = "meet-" + Date.now();
  let isCopilotLive = false;
  let isStarting = false;

  let micStream = null;
  let audioContext = null;
  let workletNode = null;
  let socket = null;

  let youWordsCount = 0;
  let clientWordsCount = 0;
  let totalTurns = 0;
  let turnHistory = [];
  let lastOutcomeData = null;

  let isMutedByMeet = false;
  let meetMuteObserver = null;

  let youInterimEl = null;
  let clientInterimEl = null;

  // ---------------- HUD Injection & Styling ----------------

  const root = document.createElement("div");
  root.id = "ai-copilot-hud";
  root.innerHTML = `
    <style>
      #ai-copilot-hud {
        position: fixed;
        top: 20px;
        right: 20px;
        width: 370px;
        max-height: 90vh;
        background: rgba(18, 20, 26, 0.96);
        backdrop-filter: blur(14px);
        -webkit-backdrop-filter: blur(14px);
        border: 1px solid rgba(255, 255, 255, 0.12);
        border-radius: 14px;
        box-shadow: 0 16px 40px rgba(0, 0, 0, 0.55), 0 0 0 1px rgba(255, 255, 255, 0.05);
        color: #f1f3f4;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        font-size: 13px;
        z-index: 2147483647;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        transition: width 0.2s ease, max-height 0.2s ease, opacity 0.15s ease;
        user-select: none;
      }
      #ai-copilot-hud * { box-sizing: border-box; }
      #ai-copilot-hud.minimized {
        width: 220px !important;
        max-height: 48px !important;
      }

      /* Drag Header */
      .cp-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 10px 14px;
        background: rgba(255, 255, 255, 0.05);
        border-bottom: 1px solid rgba(255, 255, 255, 0.08);
        cursor: grab;
      }
      .cp-head:active { cursor: grabbing; }
      .cp-title-wrap {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .cp-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: #9aa0a6;
        transition: all 0.2s ease;
      }
      .cp-dot.live { background: #34a853; box-shadow: 0 0 8px #34a853; }
      .cp-dot.connecting { background: #fbbc04; }
      .cp-title {
        font-weight: 600;
        font-size: 13px;
        letter-spacing: 0.3px;
        color: #e8eaed;
      }
      .cp-status {
        font-size: 10px;
        font-weight: 600;
        color: #9aa0a6;
        letter-spacing: 0.5px;
      }
      .cp-head-controls {
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .cp-icon-btn {
        background: rgba(255, 255, 255, 0.08);
        border: 1px solid rgba(255, 255, 255, 0.12);
        color: #dadce0;
        border-radius: 6px;
        padding: 3px 8px;
        font-size: 11px;
        cursor: pointer;
        transition: all 0.15s ease;
      }
      .cp-icon-btn:hover { background: rgba(255, 255, 255, 0.16); }

      /* Dropdown Menu Popup */
      .cp-menu-dropdown {
        position: absolute;
        top: 42px;
        right: 12px;
        background: #202124;
        border: 1px solid rgba(255, 255, 255, 0.15);
        border-radius: 8px;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.6);
        padding: 4px;
        display: none;
        z-index: 100;
        min-width: 170px;
      }
      .cp-menu-dropdown.show { display: block; }
      .cp-menu-item {
        padding: 7px 10px;
        font-size: 12px;
        color: #e8eaed;
        border-radius: 4px;
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .cp-menu-item:hover { background: rgba(255, 255, 255, 0.08); color: #fff; }

      /* Action Bar: Start / Stop Copilot */
      .cp-action-bar {
        padding: 8px 12px;
        display: flex;
        gap: 8px;
        background: rgba(0, 0, 0, 0.25);
        border-bottom: 1px solid rgba(255, 255, 255, 0.06);
      }
      .cp-main-btn {
        flex: 1;
        background: #1a73e8;
        border: none;
        border-radius: 8px;
        padding: 9px 12px;
        color: #ffffff;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        font-family: inherit;
        font-size: 12px;
        font-weight: 600;
        transition: all 0.2s ease;
        box-shadow: 0 2px 6px rgba(26, 115, 232, 0.35);
      }
      .cp-main-btn:hover { background: #1557b0; }
      .cp-main-btn.active {
        background: #ea4335;
        box-shadow: 0 2px 6px rgba(234, 67, 53, 0.35);
      }
      .cp-main-btn.active:hover { background: #d93025; }

      .cp-mute-indicator {
        font-size: 10px;
        font-weight: 700;
        padding: 2px 8px;
        border-radius: 12px;
        background: rgba(234, 67, 53, 0.2);
        color: #f28b82;
        border: 1px solid rgba(234, 67, 53, 0.4);
        display: none;
        align-items: center;
      }
      .cp-mute-indicator.show { display: inline-flex; }

      /* Body Sections */
      .cp-body {
        padding: 0 12px 12px 12px;
        display: flex;
        flex-direction: column;
        gap: 10px;
        overflow-y: auto;
        max-height: 70vh;
      }

      /* Persistent Cue Card with Priority Badges */
      .cp-cue {
        background: #252830;
        border-radius: 10px;
        padding: 10px 12px;
        display: none;
        animation: cpSlideDown 0.2s ease-out;
        margin-top: 8px;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
      }
      .cp-cue.show { display: block; }
      .cp-cue.priority-URGENT {
        border-left: 4px solid #ff4444;
        background: linear-gradient(180deg, rgba(255, 68, 68, 0.14) 0%, rgba(255, 68, 68, 0.04) 100%);
      }
      .cp-cue.priority-CONTEXTUAL {
        border-left: 4px solid #ffaa00;
        background: linear-gradient(180deg, rgba(255, 170, 0, 0.14) 0%, rgba(255, 170, 0, 0.04) 100%);
      }
      .cp-cue.priority-FYI {
        border-left: 4px solid #44ff44;
        background: linear-gradient(180deg, rgba(68, 255, 68, 0.14) 0%, rgba(68, 255, 68, 0.04) 100%);
      }
      .cp-cue-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 6px;
      }
      .cp-priority-badge {
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.5px;
        padding: 2px 6px;
        border-radius: 4px;
      }
      .cp-cue.priority-URGENT .cp-priority-badge { background: rgba(255, 68, 68, 0.2); color: #ff6b6b; }
      .cp-cue.priority-CONTEXTUAL .cp-priority-badge { background: rgba(255, 170, 0, 0.2); color: #ffbe3b; }
      .cp-cue.priority-FYI .cp-priority-badge { background: rgba(68, 255, 68, 0.2); color: #69f0ae; }
      .cp-cue-label {
        font-size: 11px;
        font-weight: 600;
        color: #e8eaed;
        flex: 1;
        margin-left: 8px;
      }
      .cp-cue-dismiss {
        background: transparent;
        border: none;
        color: #9aa0a6;
        cursor: pointer;
        font-size: 14px;
        padding: 0 4px;
        line-height: 1;
        transition: color 0.15s ease;
      }
      .cp-cue-dismiss:hover { color: #ffffff; }
      .cp-cue-bullets {
        margin: 0;
        padding-left: 16px;
        color: #f1f3f4;
        font-size: 12px;
        line-height: 1.45;
      }
      .cp-cue-bullets li { margin-bottom: 3px; }

      /* Collapsible Dropdown Accordion */
      .cp-accordion {
        background: rgba(255, 255, 255, 0.03);
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 8px;
        overflow: hidden;
      }
      .cp-acc-header {
        padding: 8px 12px;
        font-size: 11px;
        font-weight: 600;
        color: #bdc1c6;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: space-between;
        user-select: none;
      }
      .cp-acc-header:hover { background: rgba(255, 255, 255, 0.05); }
      .cp-acc-content {
        padding: 10px 12px;
        border-top: 1px solid rgba(255, 255, 255, 0.06);
        display: none;
      }
      .cp-acc-content.open { display: block; }

      /* Transcript Feed */
      .cp-log {
        max-height: 160px;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: 6px;
        font-size: 12px;
        user-select: text;
      }
      .cp-msg { line-height: 1.4; word-break: break-word; }
      .cp-msg.interim { opacity: 0.55; font-style: italic; }
      .cp-msg-pill {
        font-size: 9px;
        font-weight: 700;
        padding: 1px 5px;
        border-radius: 4px;
        margin-right: 4px;
      }
      .cp-msg-pill.you { background: rgba(52, 168, 83, 0.25); color: #81c995; }
      .cp-msg-pill.client { background: rgba(66, 133, 244, 0.25); color: #8ab4f8; }
      .cp-empty {
        color: #80868b;
        font-style: italic;
        text-align: center;
        padding: 12px 0;
      }

      /* Streamlined Post-Call Summary */
      .cp-summary-metrics {
        display: flex;
        gap: 6px;
        margin-bottom: 8px;
      }
      .cp-metric-pill {
        flex: 1;
        background: rgba(255, 255, 255, 0.04);
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 6px;
        padding: 5px 6px;
        font-size: 10px;
        color: #9aa0a6;
        display: flex;
        flex-direction: column;
        gap: 2px;
      }
      .cp-metric-pill strong { font-size: 12px; color: #81c995; }
      .cp-sum-section-title {
        font-size: 10px;
        font-weight: 700;
        color: #9aa0a6;
        margin-bottom: 4px;
        letter-spacing: 0.5px;
      }
      .cp-topics-wrap {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
        margin-bottom: 8px;
      }
      .cp-topic-tag {
        background: rgba(26, 115, 232, 0.2);
        color: #8ab4f8;
        border: 1px solid rgba(26, 115, 232, 0.35);
        border-radius: 12px;
        padding: 2px 8px;
        font-size: 10px;
        font-weight: 500;
      }
      .cp-notes-box {
        background: rgba(255, 255, 255, 0.03);
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 6px;
        padding: 8px;
        font-size: 11px;
        line-height: 1.45;
        color: #e8eaed;
        max-height: 130px;
        overflow-y: auto;
        white-space: pre-wrap;
      }
      .cp-copy-notes-btn {
        background: #1a73e8;
        border: none;
        color: white;
        padding: 5px 10px;
        border-radius: 6px;
        font-size: 11px;
        font-weight: 600;
        cursor: pointer;
        float: right;
        margin-top: 8px;
        transition: background 0.15s ease;
      }
      .cp-copy-notes-btn:hover { background: #1557b0; }

      .cp-err {
        color: #f28b82;
        font-size: 11px;
        padding: 6px 10px;
        background: rgba(234, 67, 53, 0.15);
        border-radius: 6px;
        display: none;
        margin-top: 8px;
        line-height: 1.4;
      }
    </style>

    <!-- Draggable Header -->
    <div class="cp-head" id="cp-drag-handle">
      <div class="cp-title-wrap">
        <div class="cp-dot" id="cp-dot"></div>
        <span class="cp-title">AI Sales Copilot</span>
        <span class="cp-status" id="cp-state">READY</span>
        <span class="cp-mute-indicator" id="cp-mute-indicator">MUTED</span>
      </div>
      <div class="cp-head-controls">
        <button class="cp-icon-btn" id="cp-menu-btn" title="Menu">Menu ▾</button>
        <button class="cp-icon-btn" id="cp-min-btn" title="Minimize">—</button>
      </div>
    </div>

    <!-- Quick Dropdown Menu -->
    <div class="cp-menu-dropdown" id="cp-menu-dropdown">
      <div class="cp-menu-item" id="cp-menu-summary">📊 View Call Summary</div>
      <div class="cp-menu-item" id="cp-menu-toggle-transcript">📝 Toggle Transcript View</div>
      <div class="cp-menu-item" id="cp-menu-reset">🔄 Reset Current Meeting</div>
    </div>

    <!-- Action Bar: Single-Stream Start/Stop -->
    <div class="cp-action-bar" id="cp-action-bar">
      <button class="cp-main-btn" id="cp-main-btn">
        <span>⚡ Start Copilot</span>
      </button>
    </div>

    <!-- Main Body Sections -->
    <div class="cp-body" id="cp-body">
      <div class="cp-err" id="cp-err"></div>

      <!-- Persistent Cue Card with Priority Badges -->
      <div class="cp-cue" id="cp-cue">
        <div class="cp-cue-header">
          <span class="cp-priority-badge" id="cp-cue-badge">🔴 URGENT</span>
          <span class="cp-cue-label" id="cp-cue-label">OBJECTION</span>
          <button class="cp-cue-dismiss" id="cp-cue-dismiss" title="Dismiss">✕</button>
        </div>
        <ul class="cp-cue-bullets" id="cp-cue-bullets"></ul>
      </div>

      <!-- Accordion 1: Live Speech Transcript Dropdown -->
      <div class="cp-accordion" style="margin-top: 4px;">
        <div class="cp-acc-header" id="cp-acc-head-transcript">
          <span>📝 LIVE SPEECH TRANSCRIPT</span>
          <span id="cp-acc-arrow-transcript">▾</span>
        </div>
        <div class="cp-acc-content open" id="cp-acc-body-transcript">
          <div class="cp-log" id="cp-log">
            <div class="cp-empty">Waiting for speech…</div>
          </div>
        </div>
      </div>

      <!-- Accordion 2: Streamlined Call Summary Dropdown -->
      <div class="cp-accordion" id="cp-summary-accordion">
        <div class="cp-acc-header" id="cp-acc-head-summary">
          <span>📊 CALL SUMMARY</span>
          <span id="cp-acc-arrow-summary">▸</span>
        </div>
        <div class="cp-acc-content" id="cp-acc-body-summary">
          <div class="cp-summary-metrics">
            <div class="cp-metric-pill"><span>⏱️ Duration</span><strong id="cp-sum-dur">0 min</strong></div>
            <div class="cp-metric-pill"><span>🎤 Rep Talk</span><strong id="cp-sum-you">50%</strong></div>
            <div class="cp-metric-pill"><span>🔊 Client Talk</span><strong id="cp-sum-client">50%</strong></div>
          </div>
          <div class="cp-sum-section-title">KEY TOPICS</div>
          <div class="cp-topics-wrap" id="cp-topics-wrap">
            <span class="cp-topic-tag">Discovery</span>
          </div>
          <div class="cp-sum-section-title" style="margin-top:8px;">KEY TAKEAWAYS & NEXT STEPS</div>
          <div class="cp-notes-box" id="cp-notes-box">Call notes will appear here once conversation starts.</div>
          <div style="overflow:hidden; margin-top:4px;">
            <button class="cp-copy-notes-btn" id="cp-copy-notes-btn">📋 Copy Notes</button>
          </div>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(root);

  // ---------------- DOM References ----------------
  const $ = (id) => document.getElementById(id);
  const hud = $("ai-copilot-hud");
  const dragHandle = $("cp-drag-handle");
  const dotEl = $("cp-dot");
  const stateEl = $("cp-state");
  const mainBtn = $("cp-main-btn");
  const muteIndicator = $("cp-mute-indicator");

  const cueEl = $("cp-cue");
  const cueBadge = $("cp-cue-badge");
  const cueLabel = $("cp-cue-label");
  const cueBullets = $("cp-cue-bullets");
  const cueDismissBtn = $("cp-cue-dismiss");

  const logEl = $("cp-log");
  const errEl = $("cp-err");
  const menuBtn = $("cp-menu-btn");
  const menuDropdown = $("cp-menu-dropdown");

  // ---------------- Free Drag-and-Drop Anywhere on Screen ----------------

  let isDragging = false;
  let dragOffset = { x: 0, y: 0 };

  dragHandle.addEventListener("mousedown", (e) => {
    if (e.target.tagName === "BUTTON" || e.target.classList.contains("cp-icon-btn")) return;
    isDragging = true;
    const rect = hud.getBoundingClientRect();
    dragOffset.x = e.clientX - rect.left;
    dragOffset.y = e.clientY - rect.top;
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  });

  function onMouseMove(e) {
    if (!isDragging) return;
    e.preventDefault();

    let newX = e.clientX - dragOffset.x;
    let newY = e.clientY - dragOffset.y;

    const maxX = window.innerWidth - hud.offsetWidth - 8;
    const maxY = window.innerHeight - hud.offsetHeight - 8;
    newX = Math.max(8, Math.min(newX, maxX));
    newY = Math.max(8, Math.min(newY, maxY));

    hud.style.right = "auto";
    hud.style.left = `${newX}px`;
    hud.style.top = `${newY}px`;
  }

  function onMouseUp() {
    isDragging = false;
    document.removeEventListener("mousemove", onMouseMove);
    document.removeEventListener("mouseup", onMouseUp);
  }

  // ---------------- Dropdown & Collapsible Controls ----------------

  let isMinimized = false;
  $("cp-min-btn").addEventListener("click", () => {
    isMinimized = !isMinimized;
    hud.classList.toggle("minimized", isMinimized);
    $("cp-body").style.display = isMinimized ? "none" : "flex";
    $("cp-action-bar").style.display = isMinimized ? "none" : "flex";
    $("cp-min-btn").textContent = isMinimized ? "+" : "—";
  });

  menuBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    menuDropdown.classList.toggle("show");
  });

  document.addEventListener("click", () => {
    menuDropdown.classList.remove("show");
  });

  // Accordion 1: Transcript Toggle
  $("cp-acc-head-transcript").addEventListener("click", () => {
    const body = $("cp-acc-body-transcript");
    const isOpen = body.classList.contains("open");
    body.classList.toggle("open", !isOpen);
    $("cp-acc-arrow-transcript").textContent = isOpen ? "▸" : "▾";
  });

  // Accordion 2: Summary Toggle
  $("cp-acc-head-summary").addEventListener("click", () => {
    const body = $("cp-acc-body-summary");
    const isOpen = body.classList.contains("open");
    body.classList.toggle("open", !isOpen);
    $("cp-acc-arrow-summary").textContent = isOpen ? "▸" : "▾";
  });

  // Menu items
  $("cp-menu-summary").addEventListener("click", () => {
    $("cp-acc-body-summary").classList.add("open");
    $("cp-acc-arrow-summary").textContent = "▾";
    renderCallSummary();
  });

  $("cp-menu-toggle-transcript").addEventListener("click", () => {
    $("cp-acc-head-transcript").click();
  });

  $("cp-menu-reset").addEventListener("click", () => {
    resetMeetingState();
  });

  // Click-to-Dismiss Cue Card (No auto-dismiss)
  cueDismissBtn.addEventListener("click", () => {
    cueEl.classList.remove("show");
  });

  $("cp-copy-notes-btn").addEventListener("click", () => {
    const text = $("cp-notes-box").textContent;
    navigator.clipboard.writeText(text).then(() => {
      $("cp-copy-notes-btn").textContent = "Copied! ✓";
      setTimeout(() => { $("cp-copy-notes-btn").textContent = "📋 Copy Notes"; }, 2000);
    });
  });

  function showError(msg) {
    if (!msg) {
      errEl.style.display = "none";
      return;
    }
    errEl.textContent = msg;
    errEl.style.display = "block";
    setTimeout(() => { errEl.style.display = "none"; }, 8000);
  }

  function setState(state) {
    stateEl.textContent = state;
    dotEl.className = "cp-dot";
    if (state === "LISTENING") dotEl.classList.add("live");
    else if (state === "CONNECTING") dotEl.classList.add("connecting");
  }

  function resetMeetingState() {
    meetingId = "meet-" + Date.now();
    youWordsCount = 0;
    clientWordsCount = 0;
    totalTurns = 0;
    turnHistory = [];
    cueEl.classList.remove("show");
    logEl.innerHTML = '<div class="cp-empty">Waiting for speech…</div>';
    showError("Meeting reset.");
  }

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

  function checkMeetMute() {
    const micBtn = findMeetMicButton();
    if (!micBtn) return false;
    const isMutedAttr = micBtn.getAttribute("data-is-muted");
    if (isMutedAttr === "true") return true;
    if (isMutedAttr === "false") return false;
    const label = (micBtn.getAttribute("aria-label") || "").toLowerCase();
    return label.includes("turn on microphone");
  }

  function setupMeetMuteObserver() {
    if (meetMuteObserver) return;
    const update = () => {
      const muted = checkMeetMute();
      if (muted !== isMutedByMeet) {
        isMutedByMeet = muted;
        muteIndicator.classList.toggle("show", isMutedByMeet);
      }
    };
    update();
    meetMuteObserver = new MutationObserver(update);
    meetMuteObserver.observe(document.body, { attributes: true, subtree: true, attributeFilter: ["data-is-muted", "aria-label", "class"] });
  }

  function teardownMeetMuteObserver() {
    if (meetMuteObserver) {
      meetMuteObserver.disconnect();
      meetMuteObserver = null;
    }
    muteIndicator.classList.remove("show");
    isMutedByMeet = false;
  }

  // ---------------- Single-Stream Audio Pipeline with Diarization ----------------

  async function startCopilot() {
    if (isCopilotLive || isStarting) return;

    // Check Privacy Consent first
    if (window.CopilotConsent) {
      const consented = await window.CopilotConsent.ensureConsent();
      if (!consented) {
        showError("Audio capture declined. Enable consent to activate copilot.");
        return;
      }
    }

    try {
      isStarting = true;
      setState("CONNECTING");
      mainBtn.innerHTML = "<span>⏳ Connecting…</span>";

      setupMeetMuteObserver();

      // Open WebSocket to Backend Server
      const wsUrl = CONFIG.SERVER_WS_URL || "ws://localhost:3000/transcribe";
      socket = new WebSocket(wsUrl);

      socket.onopen = async () => {
        isStarting = false;
        isCopilotLive = true;
        setState("LISTENING");
        mainBtn.classList.add("active");
        mainBtn.innerHTML = "<span>⏹ Stop Copilot</span>";

        await initAudioStream();
      };

      socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === "Results") {
            const speakerName = (data.speaker === 0) ? "YOU" : "CLIENT";
            const text = (data.text || "").trim();
            if (!text) return;

            if (data.speaker === 0 && isMutedByMeet) return;

            if (data.is_final) {
              setInterim(speakerName, "");
              addFinal(speakerName, text);
            } else {
              setInterim(speakerName, text);
            }
          }
        } catch (e) {
          console.warn("[transcribe parse error]", e);
        }
      };

      socket.onerror = (err) => {
        console.error("[socket error]", err);
        showError("Connection to backend transcription server failed. Ensure server is running on localhost:3000.");
        stopCopilot();
      };

      socket.onclose = () => {
        if (isCopilotLive) stopCopilot();
      };

    } catch (e) {
      isStarting = false;
      setState("READY");
      showError(e.message);
      mainBtn.innerHTML = "<span>⚡ Start Copilot</span>";
    }
  }

  async function initAudioStream() {
    try {
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 16000,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: true
        }
      });
    } catch (e) {
      micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    }

    audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
    const source = audioContext.createMediaStreamSource(micStream);

    const workletCode = `
      class PCMProcessor extends AudioWorkletProcessor {
        process(inputs) {
          const input = inputs[0];
          if (input && input[0]) {
            const channel = input[0];
            const pcm16 = new Int16Array(channel.length);
            for (let i = 0; i < channel.length; i++) {
              let s = Math.max(-1, Math.min(1, channel[i]));
              pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
            }
            this.port.postMessage(pcm16.buffer, [pcm16.buffer]);
          }
          return true;
        }
      }
      registerProcessor('pcm-processor', PCMProcessor);
    `;

    const blob = new Blob([workletCode], { type: "application/javascript" });
    const blobUrl = URL.createObjectURL(blob);
    await audioContext.audioWorklet.addModule(blobUrl);

    workletNode = new AudioWorkletNode(audioContext, "pcm-processor");
    workletNode.port.onmessage = (e) => {
      if (isMutedByMeet) return;
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(e.data);
      }
    };

    source.connect(workletNode);
    workletNode.connect(audioContext.destination);
  }

  async function stopCopilot() {
    isCopilotLive = false;
    isStarting = false;
    setState("READY");

    mainBtn.classList.remove("active");
    mainBtn.innerHTML = "<span>⚡ Start Copilot</span>";

    teardownMeetMuteObserver();

    if (socket) {
      try { socket.close(); } catch (e) {}
      socket = null;
    }

    if (workletNode) {
      try { workletNode.disconnect(); } catch (e) {}
      workletNode = null;
    }

    if (audioContext) {
      try { await audioContext.close(); } catch (e) {}
      audioContext = null;
    }

    if (micStream) {
      micStream.getTracks().forEach((t) => t.stop());
      micStream = null;
    }

    // Auto-open summary and request post-meeting insights
    if (turnHistory.length > 0) {
      $("cp-acc-body-summary").classList.add("open");
      $("cp-acc-arrow-summary").textContent = "▾";
      await fetchPostMeetingSummary();
    }
  }

  mainBtn.addEventListener("click", () => {
    if (isCopilotLive) stopCopilot();
    else startCopilot();
  });

  // ---------------- Transcript & Priority Cue Cards ----------------

  function addFinal(speaker, text) {
    const empty = logEl.querySelector(".cp-empty");
    if (empty) empty.remove();

    const isYou = speaker === "YOU";
    const words = (text || "").trim().split(/\s+/).filter(Boolean).length;
    if (isYou) youWordsCount += words;
    else clientWordsCount += words;
    totalTurns++;

    turnHistory.push({ speaker, text, timestamp: Date.now() });

    const msg = document.createElement("div");
    msg.className = "cp-msg";
    msg.innerHTML = `
      <span class="cp-msg-pill ${isYou ? 'you' : 'client'}">${speaker}</span>
      <span>${escapeHtml(text)}</span>
    `;
    logEl.appendChild(msg);
    logEl.scrollTop = logEl.scrollHeight;

    // Send turn to intelligence server for real-time cues
    sendTurnToServer(speaker, text);
  }

  function setInterim(speaker, text) {
    const isYou = speaker === "YOU";
    let el = isYou ? youInterimEl : clientInterimEl;

    if (!text) {
      if (el) el.remove();
      if (isYou) youInterimEl = null;
      else clientInterimEl = null;
      return;
    }

    const empty = logEl.querySelector(".cp-empty");
    if (empty) empty.remove();

    if (!el) {
      el = document.createElement("div");
      el.className = "cp-msg interim";
      logEl.appendChild(el);
      if (isYou) youInterimEl = el;
      else clientInterimEl = el;
    }

    el.innerHTML = `
      <span class="cp-msg-pill ${isYou ? 'you' : 'client'}">${speaker}</span>
      <span>${escapeHtml(text)}</span>
    `;
    logEl.scrollTop = logEl.scrollHeight;
  }

  async function sendTurnToServer(speaker, text) {
    try {
      const res = await fetch(`${CONFIG.SERVER_URL}/turn`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ meetingId, speaker, text }),
        signal: AbortSignal.timeout(2800)
      });
      if (!res.ok) return;
      const data = await res.json();
      if (data && data.cue) {
        showPriorityCue(data.cue);
      }
    } catch (e) {
      console.warn("[copilot /turn skipped]", e.message);
    }
  }

  function showPriorityCue(cue) {
    if (!cue || !cue.label || !cue.bullets || !cue.bullets.length) return;

    // Determine Priority: URGENT, CONTEXTUAL, or FYI
    const priority = cue.priority || (cue.urgent ? "URGENT" : "CONTEXTUAL");

    cueEl.className = `cp-cue priority-${priority} show`;
    cueBadge.textContent = (priority === "URGENT") ? "🔴 URGENT" : ((priority === "CONTEXTUAL") ? "🟡 CONTEXTUAL" : "🟢 FYI");
    cueLabel.textContent = cue.label;

    cueBullets.innerHTML = cue.bullets.map((b) => `<li>${escapeHtml(b)}</li>`).join("");

    // Persistent: No auto-dismiss timer! Stays open until rep dismisses or new cue arrives.
  }

  // ---------------- Streamlined Call Summary (No Scorecard / Email) ----------------

  async function fetchPostMeetingSummary() {
    let outcome = null;
    try {
      const res = await fetch(`${CONFIG.SERVER_URL}/end`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ meetingId }),
        signal: AbortSignal.timeout(3500)
      });
      if (res.ok) outcome = await res.json();
    } catch (e) {}

    if (!outcome) {
      outcome = generateLocalSummary();
    }
    lastOutcomeData = outcome;
    renderCallSummary(outcome);
  }

  function generateLocalSummary() {
    const total = youWordsCount + clientWordsCount;
    const youRatio = total > 0 ? Math.round((youWordsCount / total) * 100) : 48;
    const clientRatio = 100 - youRatio;
    const durationMin = Math.max(1, Math.round(totalTurns * 0.4));

    const allText = turnHistory.map((t) => t.text.toLowerCase()).join(" ");
    const topics = [];
    if (allText.includes("expensive") || allText.includes("budget") || allText.includes("thousand") || allText.includes("cost")) topics.push("Pricing & Budget");
    if (allText.includes("competitor") || allText.includes("other firm") || allText.includes("quote")) topics.push("Competitor Mention");
    if (allText.includes("hours") || allText.includes("manual") || allText.includes("bottleneck")) topics.push("Workflow Pain Points");
    if (allText.includes("timeline") || allText.includes("asap") || allText.includes("start")) topics.push("Timeline & Kickoff");
    if (!topics.length) topics.push("Discovery & Scope Alignment");

    const notes =
`CALL SUMMARY (${durationMin} min)
Talk Ratio: Rep ${youRatio}% | Client ${clientRatio}%

Key Topics Discussed:
${topics.map(t => `• ${t}`).join("\n")}

Key Takeaways & Action Items:
• Discussed team operational bottlenecks and scope.
• Align on proposal delivery and scheduled team review.`;

    return {
      duration_min: durationMin,
      rep_talk_time_pct: youRatio,
      client_talk_time_pct: clientRatio,
      key_topics: topics,
      notes
    };
  }

  function renderCallSummary(data) {
    if (!data) data = lastOutcomeData || generateLocalSummary();

    $("cp-sum-dur").textContent = `${data.duration_min || 1} min`;
    $("cp-sum-you").textContent = `${data.rep_talk_time_pct || 50}%`;
    $("cp-sum-client").textContent = `${data.client_talk_time_pct || 50}%`;

    const topics = data.key_topics || ["Discovery"];
    $("cp-topics-wrap").innerHTML = topics.map(t => `<span class="cp-topic-tag">${escapeHtml(t)}</span>`).join("");

    $("cp-notes-box").textContent = data.notes || "Call summary saved.";
  }

  function escapeHtml(str) {
    return (str || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  window.addEventListener("beforeunload", () => {
    stopCopilot();
  });

  setState("READY");
})();
