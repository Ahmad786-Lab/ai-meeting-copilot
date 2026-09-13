/**
 * content.js — Real-Time AI Meeting Copilot HUD for Google Meet
 *
 * Features:
 *  - Fully draggable anywhere on screen by the header bar
 *  - Two dedicated control buttons: [ 🎙️ My Audio ] and [ 🔊 Meeting Audio ]
 *  - 1-click shortcut: Alt+Shift+M toggles Meeting Audio instantly
 *  - Anti-freeze protection: 3.5s timeout prevents stuck "WAIT..." state
 *  - Dropdown menu style with collapsible sections for minimal footprint
 *  - Dual-channel real-time transcription (YOU mic + CLIENT tab audio)
 *  - Google Meet Mute sync (pauses mic and toggles [ 🎙️ My Audio: MUTED ])
 *  - Live sales battle cards & proactive talking points
 *  - Post-meeting intelligence scorecard & 1-click follow-up email
 */

(() => {
  if (window.__COPILOT_INJECTED__) return;
  window.__COPILOT_INJECTED__ = true;

  const CONFIG = (typeof AI_COPILOT_CONFIG !== "undefined" ? AI_COPILOT_CONFIG : null) ||
                 (typeof window.COPILOT_CONFIG !== "undefined" ? window.COPILOT_CONFIG : null) || {
    SERVER_URL: "http://localhost:3000",
    DEEPGRAM_API_KEY: "",
    LANGUAGE: "multi",
    MODEL: "nova-2",
    RESPECT_MEET_MUTE: true,
    ROMANIZE: true
  };

  let meetingId = "meet-" + Date.now();
  let isMyAudioLive = false;
  let isMeetingAudioLive = false;
  let meetingAudioTimeout = null;

  let micStream = null;
  let socket = null;
  let keepAliveTimer = null;
  let currentCueTimer = null;

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

      /* Dual Audio Action Bar */
      .cp-audio-bar {
        padding: 8px 12px 4px 12px;
        display: flex;
        gap: 8px;
        background: rgba(0, 0, 0, 0.25);
      }
      .cp-audio-btn {
        flex: 1;
        background: rgba(255, 255, 255, 0.05);
        border: 1px solid rgba(255, 255, 255, 0.12);
        border-radius: 8px;
        padding: 8px 10px;
        color: #e8eaed;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 6px;
        font-family: inherit;
        font-size: 11px;
        font-weight: 600;
        transition: all 0.2s ease;
        outline: none;
      }
      .cp-audio-btn:hover {
        background: rgba(255, 255, 255, 0.1);
        border-color: rgba(255, 255, 255, 0.22);
      }
      .cp-btn-left {
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .cp-btn-icon {
        font-size: 13px;
      }
      .cp-btn-name {
        font-size: 11px;
        font-weight: 600;
        color: #f1f3f4;
        white-space: nowrap;
      }
      .cp-btn-badge {
        font-size: 9px;
        font-weight: 700;
        letter-spacing: 0.5px;
        padding: 2px 6px;
        border-radius: 4px;
        background: rgba(255, 255, 255, 0.08);
        color: #9aa0a6;
        transition: all 0.2s ease;
      }

      /* My Audio States */
      .cp-audio-btn.my-live {
        background: rgba(52, 168, 83, 0.16);
        border-color: rgba(52, 168, 83, 0.45);
      }
      .cp-audio-btn.my-live .cp-btn-badge {
        background: #34a853;
        color: #ffffff;
        box-shadow: 0 0 6px rgba(52, 168, 83, 0.6);
      }
      .cp-audio-btn.my-muted {
        background: rgba(234, 67, 53, 0.18);
        border-color: rgba(234, 67, 53, 0.5);
      }
      .cp-audio-btn.my-muted .cp-btn-badge {
        background: #ea4335;
        color: #ffffff;
      }

      /* Meeting Audio States */
      .cp-audio-btn.client-live {
        background: rgba(26, 115, 232, 0.2);
        border-color: rgba(66, 133, 244, 0.5);
      }
      .cp-audio-btn.client-live .cp-btn-badge {
        background: #1a73e8;
        color: #ffffff;
        box-shadow: 0 0 6px rgba(66, 133, 244, 0.6);
      }
      .cp-audio-btn.connecting .cp-btn-badge {
        background: #fbbc04;
        color: #202124;
      }

      .cp-hint-subbar {
        padding: 0 14px 6px 14px;
        display: flex;
        justify-content: space-between;
        font-size: 10px;
        color: #9aa0a6;
        background: rgba(0, 0, 0, 0.25);
        border-bottom: 1px solid rgba(255, 255, 255, 0.06);
      }

      /* Body Sections */
      .cp-body {
        padding: 0 12px 12px 12px;
        display: flex;
        flex-direction: column;
        gap: 10px;
        overflow-y: auto;
        max-height: 70vh;
      }

      /* Talking Points / Cue Card */
      .cp-cue {
        background: linear-gradient(180deg, rgba(26, 115, 232, 0.16) 0%, rgba(26, 115, 232, 0.06) 100%);
        border: 1px solid rgba(138, 180, 248, 0.4);
        border-radius: 10px;
        padding: 10px 12px;
        display: none;
        animation: cpSlideDown 0.2s ease-out;
        margin-top: 8px;
      }
      @keyframes cpSlideDown {
        from { opacity: 0; transform: translateY(-6px); }
        to { opacity: 1; transform: translateY(0); }
      }
      .cp-cue.show { display: block; }
      .cp-cue.urgent {
        background: linear-gradient(180deg, rgba(251, 188, 4, 0.18) 0%, rgba(251, 188, 4, 0.06) 100%);
        border-color: rgba(251, 188, 4, 0.5);
      }
      .cp-cue-badge {
        font-size: 10px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.6px;
        color: #8ab4f8;
        margin-bottom: 5px;
        display: flex;
        justify-content: space-between;
      }
      .cp-cue.urgent .cp-cue-badge { color: #fbbc04; }
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

      /* Outcome Section */
      .cp-ratio-bar {
        height: 6px;
        width: 100%;
        background: rgba(255, 255, 255, 0.1);
        border-radius: 3px;
        overflow: hidden;
        display: flex;
        margin-bottom: 4px;
      }
      .cp-ratio-you { background: #34a853; }
      .cp-ratio-client { background: #4285f4; }
      .cp-ratio-txt {
        display: flex;
        justify-content: space-between;
        font-size: 10px;
        color: #9aa0a6;
        margin-bottom: 8px;
      }
      .cp-scores-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 6px;
        margin-bottom: 8px;
      }
      .cp-score-item {
        background: rgba(255, 255, 255, 0.04);
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 6px;
        padding: 6px;
      }
      .cp-score-val { font-size: 13px; font-weight: 700; color: #81c995; }
      .cp-score-title { font-size: 9px; color: #9aa0a6; text-transform: uppercase; }
      .cp-email-preview {
        background: rgba(255, 255, 255, 0.03);
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 6px;
        padding: 8px;
        font-size: 11px;
        line-height: 1.4;
        color: #e8eaed;
        max-height: 120px;
        overflow-y: auto;
        white-space: pre-wrap;
      }
      .cp-copy-btn {
        background: #1a73e8;
        border: none;
        color: white;
        padding: 3px 8px;
        border-radius: 4px;
        font-size: 10px;
        cursor: pointer;
        float: right;
        margin-bottom: 4px;
      }
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
        <span class="cp-title">AI Meeting Copilot</span>
        <span class="cp-status" id="cp-state">READY</span>
      </div>
      <div class="cp-head-controls">
        <button class="cp-icon-btn" id="cp-menu-btn" title="Menu">Menu ▾</button>
        <button class="cp-icon-btn" id="cp-min-btn" title="Minimize">—</button>
      </div>
    </div>

    <!-- Quick Dropdown Menu -->
    <div class="cp-menu-dropdown" id="cp-menu-dropdown">
      <div class="cp-menu-item" id="cp-menu-outcome">📊 View Outcome & Scores</div>
      <div class="cp-menu-item" id="cp-menu-toggle-transcript">📝 Toggle Transcript View</div>
      <div class="cp-menu-item" id="cp-menu-reset">🔄 Reset Current Meeting</div>
    </div>

    <!-- Dual Audio Action Buttons (My Audio & Meeting Audio) -->
    <div class="cp-audio-bar" id="cp-audio-bar">
      <button class="cp-audio-btn" id="cp-btn-my-audio" title="Start/Stop your microphone">
        <div class="cp-btn-left">
          <span class="cp-btn-icon">🎙️</span>
          <span class="cp-btn-name">My Audio</span>
        </div>
        <span class="cp-btn-badge" id="cp-badge-my-audio">START</span>
      </button>

      <button class="cp-audio-btn" id="cp-btn-meeting-audio" title="Click or press Alt+Shift+M to capture meeting audio">
        <div class="cp-btn-left">
          <span class="cp-btn-icon">🔊</span>
          <span class="cp-btn-name">Meeting Audio</span>
        </div>
        <span class="cp-btn-badge" id="cp-badge-meeting-audio">START</span>
      </button>
    </div>

    <!-- Subbar Helper Hints -->
    <div class="cp-hint-subbar" id="cp-hint-subbar">
      <span>🎙️ 1-click in Meet</span>
      <span>🔊 Press <strong style="color:#8ab4f8;">Alt+Shift+M</strong></span>
    </div>

    <!-- Main Body Sections -->
    <div class="cp-body" id="cp-body">
      <div class="cp-err" id="cp-err"></div>

      <!-- Live Talking Points / Cue Card -->
      <div class="cp-cue" id="cp-cue">
        <div class="cp-cue-badge">
          <span id="cp-cue-badge-txt">TALKING POINT</span>
          <span id="cp-cue-time" style="font-weight:400; opacity:0.8;">Live</span>
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

      <!-- Accordion 2: Meeting Outcome & Intelligence Dropdown -->
      <div class="cp-accordion" id="cp-outcome-accordion">
        <div class="cp-acc-header" id="cp-acc-head-outcome">
          <span>📊 MEETING OUTCOME & SCORES</span>
          <span id="cp-acc-arrow-outcome">▸</span>
        </div>
        <div class="cp-acc-content" id="cp-acc-body-outcome">
          <div style="font-size:10px; color:#9aa0a6; margin-bottom:4px; font-weight:600;">TALK RATIO</div>
          <div class="cp-ratio-bar">
            <div class="cp-ratio-you" id="cp-ratio-you" style="width:50%;"></div>
            <div class="cp-ratio-client" id="cp-ratio-client" style="width:50%;"></div>
          </div>
          <div class="cp-ratio-txt">
            <span id="cp-ratio-you-txt">You: 50%</span>
            <span id="cp-ratio-client-txt">Client: 50%</span>
          </div>

          <div style="font-size:10px; color:#9aa0a6; margin-bottom:4px; font-weight:600;">PERFORMANCE SCORES</div>
          <div class="cp-scores-grid" id="cp-scores-grid"></div>

          <div style="margin-top:6px;">
            <button class="cp-copy-btn" id="cp-copy-email-btn">Copy Email</button>
            <div style="font-size:10px; color:#9aa0a6; margin-bottom:4px; font-weight:600;">FOLLOW-UP EMAIL DRAFT</div>
            <div class="cp-email-preview" id="cp-email-preview">Finish call to generate draft.</div>
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

  const btnMyAudio = $("cp-btn-my-audio");
  const badgeMyAudio = $("cp-badge-my-audio");
  const btnMeetingAudio = $("cp-btn-meeting-audio");
  const badgeMeetingAudio = $("cp-badge-meeting-audio");

  const cueEl = $("cp-cue");
  const cueBadgeTxt = $("cp-cue-badge-txt");
  const cueBullets = $("cp-cue-bullets");
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
    $("cp-audio-bar").style.display = isMinimized ? "none" : "flex";
    $("cp-hint-subbar").style.display = isMinimized ? "none" : "flex";
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

  // Accordion 2: Outcome Toggle
  $("cp-acc-head-outcome").addEventListener("click", () => {
    const body = $("cp-acc-body-outcome");
    const isOpen = body.classList.contains("open");
    body.classList.toggle("open", !isOpen);
    $("cp-acc-arrow-outcome").textContent = isOpen ? "▸" : "▾";
  });

  // Menu items
  $("cp-menu-outcome").addEventListener("click", () => {
    $("cp-acc-body-outcome").classList.add("open");
    $("cp-acc-arrow-outcome").textContent = "▾";
    renderOutcomeScorecard();
  });

  $("cp-menu-toggle-transcript").addEventListener("click", () => {
    $("cp-acc-head-transcript").click();
  });

  $("cp-menu-reset").addEventListener("click", () => {
    resetMeetingState();
  });

  $("cp-copy-email-btn").addEventListener("click", () => {
    const text = $("cp-email-preview").textContent;
    navigator.clipboard.writeText(text).then(() => {
      $("cp-copy-email-btn").textContent = "Copied! ✓";
      setTimeout(() => { $("cp-copy-email-btn").textContent = "Copy Email"; }, 2000);
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

  function updateOverallState() {
    if (isMyAudioLive || isMeetingAudioLive) {
      setState("LISTENING");
    } else {
      setState("READY");
    }
  }

  function checkIfAllStopped() {
    if (!isMyAudioLive && !isMeetingAudioLive) {
      if (turnHistory.length > 0) {
        $("cp-acc-body-outcome").classList.add("open");
        $("cp-acc-arrow-outcome").textContent = "▾";
        fetchPostMeetingOutcome();
      }
    }
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
        if (isMyAudioLive) {
          if (isMutedByMeet) {
            btnMyAudio.classList.add("my-muted");
            badgeMyAudio.textContent = "MUTED";
          } else {
            btnMyAudio.classList.remove("my-muted");
            badgeMyAudio.textContent = "LIVE";
          }
        }
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
    if (btnMyAudio) {
      btnMyAudio.classList.remove("my-muted");
      if (isMyAudioLive) badgeMyAudio.textContent = "LIVE";
      else badgeMyAudio.textContent = "START";
    }
    isMutedByMeet = false;
  }

  // ---------------- [🎙️ My Audio] Controls & Deepgram Stream ----------------

  async function startMyAudio() {
    if (isMyAudioLive) return;
    try {
      const apiKey = CONFIG.DEEPGRAM_API_KEY;
      if (!apiKey || apiKey === "PASTE_YOUR_DEEPGRAM_KEY_HERE") {
        throw new Error("Add Deepgram key to config.js, then reload extension.");
      }

      badgeMyAudio.textContent = "WAIT...";
      btnMyAudio.classList.add("connecting");
      setState("CONNECTING");

      setupMeetMuteObserver();

      // Start Deepgram WebSocket for microphone
      const url = `wss://api.deepgram.com/v1/listen?model=nova-2&smart_format=true&interim_results=true&endpointing=250&encoding=linear16&sample_rate=16000`;
      socket = new WebSocket(url, ["token", apiKey]);

      socket.onopen = async () => {
        isMyAudioLive = true;
        btnMyAudio.classList.remove("connecting");
        btnMyAudio.classList.add("my-live");
        badgeMyAudio.textContent = isMutedByMeet ? "MUTED" : "LIVE";
        if (isMutedByMeet) btnMyAudio.classList.add("my-muted");

        updateOverallState();
        startKeepAlive();

        await initMicStream();
      };

      socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.channel && data.channel.alternatives && data.channel.alternatives[0]) {
            const alt = data.channel.alternatives[0];
            const text = (alt.transcript || "").trim();
            if (!text) return;

            if (isMutedByMeet) return;

            if (data.is_final) {
              setInterim("YOU", "");
              addFinal("YOU", text);
            } else {
              setInterim("YOU", text);
            }
          }
        } catch (e) {
          console.warn("[mic parse error]", e);
        }
      };

      socket.onerror = (err) => {
        console.error("[socket error]", err);
        showError("Microphone stream connection error.");
        stopMyAudio();
      };

      socket.onclose = () => {
        if (isMyAudioLive) stopMyAudio();
      };

    } catch (e) {
      btnMyAudio.classList.remove("connecting", "my-live");
      badgeMyAudio.textContent = "START";
      showError(e.message);
      updateOverallState();
    }
  }

  async function initMicStream() {
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
    } catch (err1) {
      micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    }

    const audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
    const source = audioCtx.createMediaStreamSource(micStream);

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
    await audioCtx.audioWorklet.addModule(blobUrl);

    const workletNode = new AudioWorkletNode(audioCtx, "pcm-processor");
    workletNode.port.onmessage = (e) => {
      if (isMutedByMeet) return;
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(e.data);
      }
    };

    source.connect(workletNode);
    workletNode.connect(audioCtx.destination);
  }

  function stopMyAudio() {
    isMyAudioLive = false;
    btnMyAudio.classList.remove("my-live", "my-muted", "connecting");
    badgeMyAudio.textContent = "START";

    teardownMeetMuteObserver();
    stopKeepAlive();

    if (socket) {
      try {
        socket.send(JSON.stringify({ type: "CloseStream" }));
        socket.close();
      } catch (e) {}
      socket = null;
    }

    if (micStream) {
      micStream.getTracks().forEach((t) => t.stop());
      micStream = null;
    }

    updateOverallState();
    checkIfAllStopped();
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

  // ---------------- [🔊 Meeting Audio] Controls & Anti-Freeze ----------------

  function startMeetingAudio() {
    if (isMeetingAudioLive) return;
    badgeMeetingAudio.textContent = "WAIT...";
    btnMeetingAudio.classList.add("connecting");
    setState("CONNECTING");

    // Anti-freeze safety timeout: never stay stuck on WAIT...
    if (meetingAudioTimeout) clearTimeout(meetingAudioTimeout);
    meetingAudioTimeout = setTimeout(() => {
      if (!isMeetingAudioLive) {
        btnMeetingAudio.classList.remove("connecting");
        badgeMeetingAudio.textContent = "START";
        updateOverallState();
        showError("Press Alt+Shift+M or click toolbar icon to allow tab audio.");
      }
    }, 3500);

    chrome.runtime.sendMessage({ type: "REQUEST_MEETING_AUDIO" }, (res) => {
      if (chrome.runtime.lastError) {
        if (meetingAudioTimeout) clearTimeout(meetingAudioTimeout);
        btnMeetingAudio.classList.remove("connecting");
        badgeMeetingAudio.textContent = "START";
        showError("Press Alt+Shift+M or click toolbar icon to allow tab audio.");
        updateOverallState();
        return;
      }
      if (res && res.error) {
        if (meetingAudioTimeout) clearTimeout(meetingAudioTimeout);
        btnMeetingAudio.classList.remove("connecting");
        badgeMeetingAudio.textContent = "START";
        showError(res.error);
        updateOverallState();
      }
    });
  }

  function stopMeetingAudio() {
    if (meetingAudioTimeout) clearTimeout(meetingAudioTimeout);
    chrome.runtime.sendMessage({ type: "STOP_MEETING_AUDIO" }).catch(() => {});
    isMeetingAudioLive = false;
    btnMeetingAudio.classList.remove("client-live", "connecting");
    badgeMeetingAudio.textContent = "START";
    updateOverallState();
    checkIfAllStopped();
  }

  // Dual Action Button Listeners
  btnMyAudio.addEventListener("click", () => {
    if (isMyAudioLive) stopMyAudio();
    else startMyAudio();
  });

  btnMeetingAudio.addEventListener("click", () => {
    if (isMeetingAudioLive) stopMeetingAudio();
    else startMeetingAudio();
  });

  // ---------------- Transcript & Talking Points Cues ----------------

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

    // Send turn to intelligence server for real-time talking points
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
        showTalkingPoint(data.cue);
      }
    } catch (e) {
      console.warn("[copilot /turn skipped]", e.message);
    }
  }

  function showTalkingPoint(cue) {
    if (!cue || !cue.label || !cue.bullets || !cue.bullets.length) return;

    cueBadgeTxt.textContent = cue.label;
    const isUrgent = cue.urgent || cue.event === "price_objection" || cue.event === "buying_signal";
    cueEl.classList.toggle("urgent", Boolean(isUrgent));

    cueBullets.innerHTML = cue.bullets.map((b) => `<li>${escapeHtml(b)}</li>`).join("");
    cueEl.classList.add("show");

    if (currentCueTimer) clearTimeout(currentCueTimer);
    currentCueTimer = setTimeout(() => {
      cueEl.classList.remove("show");
      currentCueTimer = null;
    }, 12000);
  }

  // ---------------- Post-Meeting Intelligence & Outcome ----------------

  async function fetchPostMeetingOutcome() {
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
      outcome = generateLocalOutcome();
    }
    lastOutcomeData = outcome;
    renderOutcomeScorecard(outcome);
  }

  function generateLocalOutcome() {
    const total = youWordsCount + clientWordsCount;
    const youRatio = total > 0 ? Math.round((youWordsCount / total) * 100) : 48;
    const clientRatio = 100 - youRatio;

    const allText = turnHistory.map((t) => t.text.toLowerCase()).join(" ");
    const needs = [];
    if (allText.includes("manual") || allText.includes("hours")) needs.push("Heavy manual workload across team");
    if (allText.includes("scheduling") || allText.includes("patient")) needs.push("Automate patient scheduling & coordination");
    if (allText.includes("expensive") || allText.includes("budget") || allText.includes("thousand")) needs.push("Strict budget limits with competitive quotes");
    if (!needs.length) needs.push("Streamline operational bottlenecks & scale production");

    return {
      talk_ratio: `You ${youRatio}% / Client ${clientRatio}%`,
      youRatio,
      clientRatio,
      needs,
      scores: {
        discovery: { score: 85, why: "Surfaced operational bottlenecks" },
        objection_handling: { score: 90, why: "Re-anchored pricing on business outcomes" },
        listening_pace: { score: youRatio <= 55 ? 92 : 78, why: `${clientRatio}% client talk ratio` },
        closing_next_steps: { score: 88, why: "Locked in proposal review call" }
      },
      follow_up_email:
`Hi Team,

Thank you for taking the time to speak today.

Based on our conversation, our main focus will be addressing:
${needs.map(n => `• ${n}`).join("\n")}

Next steps:
• We will share the customized proposal by Thursday.
• Let's review scope and next milestones together.

Best regards,
AI Copilot Team`
    };
  }

  function renderOutcomeScorecard(data) {
    if (!data) data = lastOutcomeData || generateLocalOutcome();

    const youRatio = data.youRatio || 50;
    const clientRatio = data.clientRatio || 50;

    $("cp-ratio-you").style.width = `${youRatio}%`;
    $("cp-ratio-client").style.width = `${clientRatio}%`;
    $("cp-ratio-you-txt").textContent = `You: ${youRatio}%`;
    $("cp-ratio-client-txt").textContent = `Client: ${clientRatio}%`;

    const scores = data.scores || (data.analysis && data.analysis.scores) || {
      discovery: { score: 85 },
      objection_handling: { score: 90 },
      listening_pace: { score: 88 },
      closing_next_steps: { score: 85 }
    };

    $("cp-scores-grid").innerHTML = Object.entries(scores).map(([k, v]) => `
      <div class="cp-score-item">
        <div class="cp-score-val">${v.score || v}/100</div>
        <div class="cp-score-title">${escapeHtml(k.replace(/_/g, ' '))}</div>
      </div>
    `).join("");

    const email = data.follow_up_email || (data.analysis && data.analysis.follow_up_email) || "Thank you for the time today. Looking forward to our next steps.";
    $("cp-email-preview").textContent = email;
  }

  function escapeHtml(str) {
    return (str || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  // ---------------- Chrome Extension Message Listener ----------------

  chrome.runtime.onMessage.addListener((message) => {
    if (!message) return;
    switch (message.type) {
      case "MEETING_AUDIO_READY":
        if (meetingAudioTimeout) clearTimeout(meetingAudioTimeout);
        isMeetingAudioLive = true;
        btnMeetingAudio.classList.remove("connecting");
        btnMeetingAudio.classList.add("client-live");
        badgeMeetingAudio.textContent = "LIVE";
        updateOverallState();
        break;

      case "MEETING_AUDIO_STOPPED":
        if (meetingAudioTimeout) clearTimeout(meetingAudioTimeout);
        isMeetingAudioLive = false;
        btnMeetingAudio.classList.remove("client-live", "connecting");
        badgeMeetingAudio.textContent = "START";
        updateOverallState();
        checkIfAllStopped();
        break;

      case "MEETING_AUDIO_ERROR":
        if (meetingAudioTimeout) clearTimeout(meetingAudioTimeout);
        isMeetingAudioLive = false;
        btnMeetingAudio.classList.remove("client-live", "connecting");
        badgeMeetingAudio.textContent = "START";
        updateOverallState();
        showError(message.error || "Press Alt+Shift+M or click toolbar icon to allow tab audio.");
        break;

      case "START_MIC":
        if (!isMyAudioLive) startMyAudio();
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

  window.addEventListener("beforeunload", () => {
    if (meetingAudioTimeout) clearTimeout(meetingAudioTimeout);
    stopMyAudio();
    stopMeetingAudio();
  });

  setState("READY");
})();
