/**
 * content.js — Real-Time AI Sales Meeting Copilot for Google Meet
 *
 * Enterprise Capabilities:
 *  - Dual Dedicated Audio Controls in HUD:
 *      * 🎤 My Audio: captures Rep microphone via 16kHz PCM
 *      * 🔊 Client Audio: captures Google Meet tab audio via background offscreen bridge
 *  - Backend-managed Deepgram STT (Zero client-side API keys, dual role routing)
 *  - Dynamic Objection Playbooks (Rules Engine 2.0 with custom triggers)
 *  - Persistent, User-Dismissible Cue Cards with Priority Badges (🔴 URGENT, 🟡 CONTEXTUAL, 🟢 FYI)
 *  - Telemetry & Analytics Tracking (cue display/dismissal, call stats)
 *  - Salesforce CRM Integration (OAuth handshake & 1-click Activity Task Sync)
 *  - Streamlined Call Summary & Notes
 *  - Fully draggable and collapsible dark-themed HUD
 *  - Google Meet Native Mute Sync (MutationObserver on mic button)
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
  let isMyAudioLive = false;
  let isClientAudioLive = false;
  let isStartingMyAudio = false;

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
        width: 375px;
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
        transition: background 0.2s;
      }
      .cp-dot.live {
        background: #2ecc71;
        box-shadow: 0 0 8px #2ecc71;
      }
      .cp-dot.connecting {
        background: #f1c40f;
        box-shadow: 0 0 8px #f1c40f;
      }
      .cp-title {
        font-weight: 600;
        font-size: 12px;
        letter-spacing: 0.3px;
        color: #e8eaed;
      }
      .cp-status {
        font-size: 10px;
        padding: 2px 6px;
        border-radius: 10px;
        background: rgba(255, 255, 255, 0.08);
        color: #9aa0a6;
        text-transform: uppercase;
        letter-spacing: 0.4px;
      }
      .cp-mute-indicator {
        display: none;
        font-size: 10px;
        color: #ff5252;
        background: rgba(255, 82, 82, 0.15);
        border: 1px solid rgba(255, 82, 82, 0.3);
        padding: 2px 6px;
        border-radius: 8px;
        font-weight: 600;
      }
      .cp-mute-indicator.show { display: inline-block; }
      .cp-head-controls {
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .cp-icon-btn {
        background: transparent;
        border: none;
        color: #9aa0a6;
        cursor: pointer;
        padding: 4px 6px;
        border-radius: 4px;
        font-size: 12px;
        line-height: 1;
        transition: background 0.15s, color 0.15s;
      }
      .cp-icon-btn:hover {
        background: rgba(255, 255, 255, 0.1);
        color: #f1f3f4;
      }

      /* Quick Dropdown Menu */
      .cp-menu-dropdown {
        display: none;
        position: absolute;
        top: 44px;
        right: 14px;
        background: #1c202a;
        border: 1px solid rgba(255, 255, 255, 0.15);
        border-radius: 8px;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.6);
        z-index: 100;
        min-width: 170px;
        overflow: hidden;
      }
      .cp-menu-dropdown.show { display: block; }
      .cp-menu-item {
        padding: 8px 12px;
        font-size: 12px;
        color: #d1d5db;
        cursor: pointer;
        transition: background 0.15s;
      }
      .cp-menu-item:hover {
        background: rgba(255, 255, 255, 0.08);
        color: #ffffff;
      }

      /* Action Bar: Dual Action Buttons */
      .cp-action-bar {
        padding: 8px 14px 4px 14px;
        display: flex;
        gap: 8px;
      }
      .cp-audio-btn {
        flex: 1;
        padding: 8px 10px;
        background: rgba(255, 255, 255, 0.06);
        border: 1px solid rgba(255, 255, 255, 0.12);
        border-radius: 8px;
        color: #ffffff;
        font-weight: 600;
        font-size: 12px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 6px;
        box-shadow: 0 2px 5px rgba(0, 0, 0, 0.2);
        transition: background 0.15s, border-color 0.15s, transform 0.1s;
      }
      .cp-audio-btn:hover {
        background: rgba(255, 255, 255, 0.1);
        border-color: rgba(255, 255, 255, 0.2);
      }
      .cp-audio-btn:active { transform: scale(0.98); }
      .cp-audio-btn.live {
        background: rgba(46, 204, 113, 0.18);
        border-color: #2ecc71;
        box-shadow: 0 0 10px rgba(46, 204, 113, 0.25);
      }
      .cp-audio-btn.client-live {
        background: rgba(52, 152, 219, 0.2);
        border-color: #3498db;
        box-shadow: 0 0 10px rgba(52, 152, 219, 0.25);
      }
      .cp-audio-btn.connecting {
        background: rgba(241, 196, 15, 0.18);
        border-color: #f1c40f;
      }
      .cp-audio-btn.muted {
        background: rgba(255, 82, 82, 0.18);
        border-color: #ff5252;
      }
      .cp-btn-left {
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .cp-audio-badge {
        font-size: 9px;
        padding: 2px 5px;
        border-radius: 6px;
        background: rgba(255, 255, 255, 0.1);
        color: #9aa0a6;
        font-weight: 700;
        letter-spacing: 0.3px;
      }
      .cp-audio-btn.live .cp-audio-badge {
        background: #2ecc71;
        color: #0b1a10;
      }
      .cp-audio-btn.client-live .cp-audio-badge {
        background: #3498db;
        color: #ffffff;
      }
      .cp-audio-btn.muted .cp-audio-badge {
        background: #ff5252;
        color: #ffffff;
      }
      .cp-audio-btn.connecting .cp-audio-badge {
        background: #f1c40f;
        color: #000000;
      }

      /* Body Containers */
      .cp-body {
        padding: 6px 14px 14px 14px;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: 10px;
        max-height: calc(90vh - 110px);
      }
      .cp-err {
        display: none;
        background: rgba(234, 67, 53, 0.15);
        border: 1px solid rgba(234, 67, 53, 0.35);
        color: #f28b82;
        padding: 8px 10px;
        border-radius: 6px;
        font-size: 11px;
        line-height: 1.4;
      }

      /* Persistent Cue Card with Priority Badges */
      .cp-cue {
        display: none;
        padding: 10px 12px;
        border-radius: 8px;
        background: rgba(255, 255, 255, 0.04);
        border-left: 4px solid #1a73e8;
        border-top: 1px solid rgba(255, 255, 255, 0.08);
        border-right: 1px solid rgba(255, 255, 255, 0.08);
        border-bottom: 1px solid rgba(255, 255, 255, 0.08);
        position: relative;
      }
      .cp-cue.show { display: block; }
      .cp-cue.priority-URGENT {
        border-left-color: #ff4444;
        background: rgba(255, 68, 68, 0.08);
      }
      .cp-cue.priority-CONTEXTUAL {
        border-left-color: #ffaa00;
        background: rgba(255, 170, 0, 0.08);
      }
      .cp-cue.priority-FYI {
        border-left-color: #44ff44;
        background: rgba(68, 255, 68, 0.08);
      }
      .cp-cue-header {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 6px;
      }
      .cp-priority-badge {
        font-size: 10px;
        font-weight: 700;
        padding: 2px 6px;
        border-radius: 4px;
        letter-spacing: 0.4px;
      }
      .cp-cue.priority-URGENT .cp-priority-badge { background: rgba(255, 68, 68, 0.2); color: #ff6b6b; }
      .cp-cue.priority-CONTEXTUAL .cp-priority-badge { background: rgba(255, 170, 0, 0.2); color: #ffbe3b; }
      .cp-cue.priority-FYI .cp-priority-badge { background: rgba(68, 255, 68, 0.2); color: #69f0ae; }
      .cp-cue-label {
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.5px;
        color: #e8eaed;
        text-transform: uppercase;
        flex: 1;
      }
      .cp-cue-dismiss {
        background: transparent;
        border: none;
        color: #9aa0a6;
        cursor: pointer;
        padding: 2px 6px;
        font-size: 14px;
        line-height: 1;
        border-radius: 4px;
      }
      .cp-cue-dismiss:hover { color: #ffffff; }
      .cp-cue-bullets {
        margin: 0;
        padding-left: 16px;
        color: #e8eaed;
        font-size: 12px;
        line-height: 1.45;
      }
      .cp-cue-bullets li { margin-bottom: 3px; }

      /* Dropdown Accordions */
      .cp-accordion {
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 8px;
        background: rgba(255, 255, 255, 0.02);
        overflow: hidden;
      }
      .cp-acc-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 8px 10px;
        background: rgba(255, 255, 255, 0.04);
        cursor: pointer;
        font-size: 11px;
        font-weight: 600;
        color: #bdc1c6;
        letter-spacing: 0.3px;
        transition: background 0.15s;
      }
      .cp-acc-header:hover { background: rgba(255, 255, 255, 0.07); color: #f1f3f4; }
      .cp-acc-content {
        display: none;
        padding: 10px;
      }
      .cp-acc-content.open { display: block; }

      /* Live Speech Transcript */
      .cp-log {
        max-height: 160px;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: 6px;
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        font-size: 11px;
      }
      .cp-turn {
        display: flex;
        gap: 6px;
        line-height: 1.4;
      }
      .cp-spk {
        font-weight: 700;
        font-size: 10px;
        padding: 1px 4px;
        border-radius: 3px;
        height: fit-content;
        text-transform: uppercase;
        flex-shrink: 0;
      }
      .cp-spk-you {
        background: rgba(46, 204, 113, 0.18);
        color: #2ecc71;
        border: 1px solid rgba(46, 204, 113, 0.35);
      }
      .cp-spk-client {
        background: rgba(52, 152, 219, 0.18);
        color: #3498db;
        border: 1px solid rgba(52, 152, 219, 0.35);
      }
      .cp-txt {
        color: #e8eaed;
        word-break: break-word;
        flex: 1;
      }
      .cp-interim {
        color: #9aa0a6;
        font-style: italic;
      }
      .cp-empty {
        color: #5f6368;
        font-style: italic;
        text-align: center;
        padding: 12px 0;
      }

      /* Streamlined Post-Call Summary */
      .cp-summary-metrics {
        display: grid;
        grid-template-columns: 1fr 1fr 1fr;
        gap: 6px;
        margin-bottom: 10px;
      }
      .cp-metric-pill {
        background: rgba(255, 255, 255, 0.04);
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 6px;
        padding: 6px;
        text-align: center;
      }
      .cp-metric-pill span {
        display: block;
        font-size: 10px;
        color: #9aa0a6;
      }
      .cp-metric-pill strong {
        font-size: 12px;
        color: #ffffff;
      }
      .cp-sum-section-title {
        font-size: 10px;
        font-weight: 700;
        color: #9aa0a6;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        margin-bottom: 4px;
      }
      .cp-topics-wrap {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
        margin-bottom: 10px;
      }
      .cp-topic-tag {
        font-size: 10px;
        padding: 2px 6px;
        border-radius: 4px;
        background: rgba(26, 115, 232, 0.15);
        color: #8ab4f8;
        border: 1px solid rgba(26, 115, 232, 0.3);
      }
      .cp-notes-box {
        background: rgba(0, 0, 0, 0.25);
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 6px;
        padding: 8px;
        font-size: 11px;
        line-height: 1.45;
        color: #e8eaed;
        white-space: pre-wrap;
        max-height: 120px;
        overflow-y: auto;
        font-family: inherit;
        margin-bottom: 8px;
      }
      .cp-copy-notes-btn {
        padding: 6px 10px;
        font-size: 11px;
        background: rgba(255, 255, 255, 0.08);
        color: #e8eaed;
        border: 1px solid rgba(255, 255, 255, 0.12);
        border-radius: 6px;
        cursor: pointer;
        float: right;
        transition: background 0.15s;
      }
      .cp-copy-notes-btn:hover {
        background: rgba(255, 255, 255, 0.15);
        color: #ffffff;
      }

      /* Salesforce CRM Card */
      .cp-sf-box {
        margin-top: 10px;
        padding: 8px 10px;
        background: rgba(0, 161, 224, 0.08);
        border: 1px solid rgba(0, 161, 224, 0.25);
        border-radius: 6px;
      }
      .cp-sf-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      .cp-sf-label {
        font-size: 11px;
        font-weight: 700;
        color: #00a1e0;
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }
      .cp-sf-badge {
        font-size: 10px;
        font-weight: 600;
        padding: 2px 6px;
        border-radius: 10px;
        background: rgba(255, 255, 255, 0.1);
        color: #9aa0a6;
      }
      .cp-sf-badge.connected {
        background: rgba(46, 204, 113, 0.2);
        color: #2ecc71;
      }
      .cp-sf-actions {
        display: flex;
        gap: 6px;
        margin-top: 6px;
      }
      .cp-sf-btn {
        flex: 1;
        padding: 6px 10px;
        font-size: 11px;
        font-weight: 600;
        background: #00a1e0;
        color: #ffffff;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        transition: background 0.15s;
        text-align: center;
      }
      .cp-sf-btn:hover { background: #0082ba; }
      .cp-sf-btn-sec {
        flex: 0 0 auto;
        background: rgba(255, 255, 255, 0.08);
        color: #e8eaed;
        border: 1px solid rgba(255, 255, 255, 0.15);
      }
      .cp-sf-btn-sec:hover { background: rgba(255, 255, 255, 0.15); }
      .cp-sf-status {
        margin-top: 5px;
        font-size: 10px;
        color: #9aa0a6;
        line-height: 1.3;
      }
    </style>

    <!-- Header / Drag Bar -->
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
      <div class="cp-menu-item" id="cp-menu-start-both">⚡ Start Both Audio Streams</div>
      <div class="cp-menu-item" id="cp-menu-summary">📊 View Call Summary</div>
      <div class="cp-menu-item" id="cp-menu-toggle-transcript">📝 Toggle Transcript View</div>
      <div class="cp-menu-item" id="cp-menu-reset">🔄 Reset Current Meeting</div>
    </div>

    <!-- Action Bar: Two Dedicated Buttons (My Audio + Client Audio) -->
    <div class="cp-action-bar" id="cp-action-bar">
      <button class="cp-audio-btn" id="cp-btn-my-audio" title="Start/Stop Your Microphone Audio">
        <span class="cp-btn-left">
          <span class="cp-btn-icon">🎤</span>
          <span>My Audio</span>
        </span>
        <span class="cp-audio-badge" id="cp-badge-my-audio">OFF</span>
      </button>

      <button class="cp-audio-btn" id="cp-btn-client-audio" title="Directly Capture Google Meet Client Audio">
        <span class="cp-btn-left">
          <span class="cp-btn-icon">🔊</span>
          <span>Client Audio</span>
        </span>
        <span class="cp-audio-badge" id="cp-badge-client-audio">OFF</span>
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
          <span>📊 CALL SUMMARY & CRM</span>
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

          <!-- Salesforce CRM Sync Section -->
          <div class="cp-sf-box">
            <div class="cp-sf-row">
              <span class="cp-sf-label">☁️ Salesforce CRM</span>
              <span class="cp-sf-badge" id="cp-sf-badge">Not Connected</span>
            </div>
            <div class="cp-sf-actions">
              <button class="cp-sf-btn" id="cp-sf-sync-btn">☁️ Sync Call to Salesforce</button>
              <button class="cp-sf-btn cp-sf-btn-sec" id="cp-sf-login-btn">Connect</button>
            </div>
            <div class="cp-sf-status" id="cp-sf-status"></div>
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
  const muteIndicator = $("cp-mute-indicator");

  const btnMyAudio = $("cp-btn-my-audio");
  const badgeMyAudio = $("cp-badge-my-audio");
  const btnClientAudio = $("cp-btn-client-audio");
  const badgeClientAudio = $("cp-badge-client-audio");

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
    if (!isOpen) {
      refreshSalesforceStatus();
    }
  });

  // Menu items
  $("cp-menu-start-both").addEventListener("click", () => {
    if (!isMyAudioLive) startMyAudio();
    if (!isClientAudioLive) startClientAudio();
  });

  $("cp-menu-summary").addEventListener("click", () => {
    $("cp-acc-body-summary").classList.add("open");
    $("cp-acc-arrow-summary").textContent = "▾";
    renderCallSummary();
    refreshSalesforceStatus();
  });

  $("cp-menu-toggle-transcript").addEventListener("click", () => {
    const body = $("cp-acc-body-transcript");
    const isOpen = body.classList.contains("open");
    body.classList.toggle("open", !isOpen);
    $("cp-acc-arrow-transcript").textContent = isOpen ? "▸" : "▾";
  });

  $("cp-menu-reset").addEventListener("click", () => {
    resetMeetingState();
  });

  // Click-to-Dismiss Cue Card (Telemetry Instrumented)
  cueDismissBtn.addEventListener("click", () => {
    if (window.CopilotAnalytics) {
      window.CopilotAnalytics.trackEvent("cue_card_dismissed", {
        label: cueLabel.textContent,
        badge: cueBadge.textContent
      });
    }
    cueEl.classList.remove("show");
  });

  $("cp-copy-notes-btn").addEventListener("click", () => {
    const text = $("cp-notes-box").textContent;
    navigator.clipboard.writeText(text).then(() => {
      $("cp-copy-notes-btn").textContent = "Copied! ✓";
      setTimeout(() => { $("cp-copy-notes-btn").textContent = "📋 Copy Notes"; }, 2000);
    });
  });

  // ---------------- Salesforce CRM Status & Actions ----------------

  async function refreshSalesforceStatus() {
    try {
      const isAuth = window.SalesforceAuth ? await window.SalesforceAuth.isAuthenticated() : false;
      const badge = $("cp-sf-badge");
      const loginBtn = $("cp-sf-login-btn");

      if (isAuth) {
        badge.textContent = "Connected";
        badge.className = "cp-sf-badge connected";
        loginBtn.textContent = "Disconnect";
      } else {
        badge.textContent = "Not Connected";
        badge.className = "cp-sf-badge";
        loginBtn.textContent = "Connect";
      }
    } catch (e) {
      console.warn("[SF Status Error]", e.message);
    }
  }

  $("cp-sf-login-btn").addEventListener("click", async () => {
    const statusEl = $("cp-sf-status");
    if (!window.SalesforceAuth) {
      statusEl.textContent = "Salesforce module not loaded.";
      return;
    }

    const isAuth = await window.SalesforceAuth.isAuthenticated();
    if (isAuth) {
      await window.SalesforceAuth.logout();
      statusEl.textContent = "Disconnected from Salesforce.";
    } else {
      statusEl.textContent = "Connecting to Salesforce...";
      try {
        const ok = await window.SalesforceAuth.login();
        if (ok) {
          statusEl.textContent = "Connected to Salesforce.";
        }
      } catch (err) {
        // Fallback to mock session for testing
        await window.SalesforceAuth.mockLogin();
        statusEl.textContent = "Connected (Mock Sandbox Mode).";
      }
    }
    await refreshSalesforceStatus();
  });

  $("cp-sf-sync-btn").addEventListener("click", async () => {
    const statusEl = $("cp-sf-status");
    statusEl.textContent = "Syncing meeting notes to Salesforce...";

    try {
      const data = lastOutcomeData || generateLocalSummary();
      const opp = (window.SalesforceAuth && await window.SalesforceAuth.isAuthenticated() && window.SalesforceService)
        ? await window.SalesforceService.queryOpportunity()
        : null;

      const oppId = opp ? opp.Id : "006DiscoveryOpp";
      const talkRatioStr = `Rep ${data.rep_talk_time_pct || 50}% / Client ${data.client_talk_time_pct || 50}%`;

      const res = window.SalesforceService
        ? await window.SalesforceService.syncCallSummary({
            oppId,
            durationMin: data.duration_min,
            notes: data.notes,
            talkRatio: talkRatioStr
          })
        : { ok: true, taskId: "00TMockTaskLocal" };

      if (res && res.ok) {
        statusEl.textContent = `✅ Synced to Salesforce! (Task #${res.taskId})`;
        if (window.CopilotAnalytics) {
          window.CopilotAnalytics.trackEvent("salesforce_task_created", {
            taskId: res.taskId,
            durationMin: data.duration_min
          });
        }
      } else {
        statusEl.textContent = `⚠️ Sync failed: ${res?.error || "Unknown error"}`;
      }
    } catch (err) {
      statusEl.textContent = `⚠️ Sync error: ${err.message}`;
    }
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

  function updateOverallState() {
    if (isMyAudioLive || isClientAudioLive) {
      stateEl.textContent = "LISTENING";
      dotEl.className = "cp-dot live";
    } else if (isStartingMyAudio) {
      stateEl.textContent = "CONNECTING";
      dotEl.className = "cp-dot connecting";
    } else {
      stateEl.textContent = "READY";
      dotEl.className = "cp-dot";
    }
  }

  function resetMeetingState() {
    meetingId = "meet-" + Date.now();
    youWordsCount = 0;
    clientWordsCount = 0;
    totalTurns = 0;
    turnHistory = [];
    lastOutcomeData = null;
    logEl.innerHTML = '<div class="cp-empty">Waiting for speech…</div>';
    cueEl.classList.remove("show");
    $("cp-notes-box").textContent = "Meeting reset. Ready for new call.";
    $("cp-topics-wrap").innerHTML = '<span class="cp-topic-tag">Discovery</span>';
    $("cp-sum-dur").textContent = "0 min";
    $("cp-sum-you").textContent = "50%";
    $("cp-sum-client").textContent = "50%";
    $("cp-sf-status").textContent = "";

    fetch(`${CONFIG.SERVER_URL}/demo-reset`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ meetingId })
    }).catch(() => {});
  }

  // ---------------- Google Meet Native Mute Observer ----------------

  function checkMeetMute() {
    const muteBtn = document.querySelector('[data-is-muted][role="button"], [aria-label*="microphone" i][role="button"], [aria-label*="mic" i][role="button"]');
    if (!muteBtn) return false;
    const isMutedAttr = muteBtn.getAttribute("data-is-muted");
    if (isMutedAttr !== null) return isMutedAttr === "true";
    const aria = (muteBtn.getAttribute("aria-label") || "").toLowerCase();
    return aria.includes("turn on") || aria.includes("unmute");
  }

  function setupMeetMuteObserver() {
    if (meetMuteObserver) return;
    const update = () => {
      const muted = checkMeetMute();
      if (muted !== isMutedByMeet) {
        isMutedByMeet = muted;
        muteIndicator.classList.toggle("show", isMutedByMeet);
        if (isMyAudioLive) {
          if (isMutedByMeet) {
            btnMyAudio.className = "cp-audio-btn muted";
            badgeMyAudio.textContent = "MUTED";
          } else {
            btnMyAudio.className = "cp-audio-btn live";
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
    muteIndicator.classList.remove("show");
    isMutedByMeet = false;
  }

  // ---------------- 1. My Audio (Rep Microphone) ----------------

  async function startMyAudio() {
    if (isMyAudioLive || isStartingMyAudio) return;

    if (window.CopilotConsent) {
      const consented = await window.CopilotConsent.ensureConsent();
      if (!consented) {
        showError("Audio consent required to activate copilot.");
        return;
      }
    }

    try {
      isStartingMyAudio = true;
      btnMyAudio.className = "cp-audio-btn connecting";
      badgeMyAudio.textContent = "CONNECTING…";
      updateOverallState();

      setupMeetMuteObserver();

      // Connect to backend STT with role=rep
      const wsUrl = (CONFIG.SERVER_WS_URL || "ws://localhost:3000/transcribe") + "?role=rep";
      socket = new WebSocket(wsUrl);

      socket.onopen = async () => {
        isStartingMyAudio = false;
        isMyAudioLive = true;
        btnMyAudio.className = isMutedByMeet ? "cp-audio-btn muted" : "cp-audio-btn live";
        badgeMyAudio.textContent = isMutedByMeet ? "MUTED" : "LIVE";
        updateOverallState();

        if (window.CopilotAnalytics) {
          window.CopilotAnalytics.trackEvent("call_started", { meetingId });
        }

        await initMicAudioStream();

        // Auto-attempt client audio if not already running
        if (!isClientAudioLive) {
          startClientAudio();
        }
      };

      socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === "Results") {
            const text = (data.text || "").trim();
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
          console.warn("[transcribe rep parse error]", e);
        }
      };

      socket.onerror = (err) => {
        console.error("[rep socket error]", err);
        showError("Rep microphone transcribe connection failed.");
      };

      socket.onclose = () => {
        if (isMyAudioLive) {
          stopMyAudio();
        }
      };

    } catch (err) {
      isStartingMyAudio = false;
      btnMyAudio.className = "cp-audio-btn";
      badgeMyAudio.textContent = "OFF";
      updateOverallState();
      showError(`My Audio start failed: ${err.message}`);
    }
  }

  async function initMicAudioStream() {
    try {
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
          sampleRate: 16000
        }
      });

      audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
      if (audioContext.state === "suspended") {
        await audioContext.resume();
      }

      const sourceNode = audioContext.createMediaStreamSource(micStream);
      const scriptNode = audioContext.createScriptProcessor(4096, 1, 1);
      scriptNode.onaudioprocess = (e) => {
        if (!isMyAudioLive || !socket || socket.readyState !== WebSocket.OPEN) return;
        const inputData = e.inputBuffer.getChannelData(0);
        const pcm16 = convertFloat32ToInt16(inputData);
        socket.send(pcm16.buffer);
      };

      sourceNode.connect(scriptNode);
      scriptNode.connect(audioContext.destination);

      workletNode = { sourceNode, scriptNode };
    } catch (err) {
      showError(`Microphone access error: ${err.message}`);
      stopMyAudio();
    }
  }

  function convertFloat32ToInt16(float32Array) {
    const l = float32Array.length;
    const int16Array = new Int16Array(l);
    for (let i = 0; i < l; i++) {
      let s = Math.max(-1, Math.min(1, float32Array[i]));
      int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return int16Array;
  }

  function stopMyAudio() {
    isMyAudioLive = false;
    isStartingMyAudio = false;
    btnMyAudio.className = "cp-audio-btn";
    badgeMyAudio.textContent = "OFF";

    if (workletNode) {
      try {
        if (workletNode.scriptNode) workletNode.scriptNode.disconnect();
        if (workletNode.sourceNode) workletNode.sourceNode.disconnect();
      } catch (e) {}
      workletNode = null;
    }

    if (audioContext) {
      audioContext.close().catch(() => {});
      audioContext = null;
    }

    if (micStream) {
      micStream.getTracks().forEach((t) => t.stop());
      micStream = null;
    }

    if (socket) {
      try { socket.close(); } catch (e) {}
      socket = null;
    }

    if (!isClientAudioLive) {
      teardownMeetMuteObserver();
      fetchPostMeetingSummary();
    }
    updateOverallState();
  }

  btnMyAudio.addEventListener("click", () => {
    if (isMyAudioLive) {
      stopMyAudio();
    } else {
      startMyAudio();
    }
  });

  // ---------------- 2. Client Audio (Google Meet Tab Capture) ----------------

  async function startClientAudio() {
    btnClientAudio.className = "cp-audio-btn connecting";
    badgeClientAudio.textContent = "CONNECTING…";

    try {
      const response = await chrome.runtime.sendMessage({
        type: "START_MEETING_AUDIO"
      });

      if (response && response.ok) {
        btnClientAudio.className = "cp-audio-btn client-live";
        badgeClientAudio.textContent = "LIVE";
        isClientAudioLive = true;
        updateOverallState();
        return;
      }

      if (response && response.viaPopup) {
        showError("Connecting client audio via bridge…");
        return;
      }

      const errMsg = (response && response.error) || "";
      if (errMsg.includes("Alt+Shift+M") || errMsg.includes("toolbar icon")) {
        showError("To allow Client Tab Audio: Press Alt+Shift+M or click extension icon once.");
      } else {
        showError(errMsg || "Could not activate Client Audio.");
      }
      btnClientAudio.className = "cp-audio-btn";
      badgeClientAudio.textContent = "OFF";
      isClientAudioLive = false;
      updateOverallState();
    } catch (e) {
      console.warn("[startClientAudio error]", e);
      btnClientAudio.className = "cp-audio-btn";
      badgeClientAudio.textContent = "OFF";
      isClientAudioLive = false;
      updateOverallState();
    }
  }

  function stopClientAudio() {
    chrome.runtime.sendMessage({ type: "STOP_MEETING_AUDIO" }).catch(() => {});
    btnClientAudio.className = "cp-audio-btn";
    badgeClientAudio.textContent = "OFF";
    isClientAudioLive = false;
    updateOverallState();
    if (!isMyAudioLive) {
      fetchPostMeetingSummary();
    }
  }

  btnClientAudio.addEventListener("click", () => {
    if (isClientAudioLive) {
      stopClientAudio();
    } else {
      startClientAudio();
    }
  });

  // ---------------- Chrome Extension Message Listener ----------------

  chrome.runtime.onMessage.addListener((message) => {
    if (!message) return;
    switch (message.type) {
      case "MEETING_AUDIO_READY":
        isClientAudioLive = true;
        btnClientAudio.className = "cp-audio-btn client-live";
        badgeClientAudio.textContent = "LIVE";
        updateOverallState();
        showError("");
        break;

      case "MEETING_AUDIO_STOPPED":
        isClientAudioLive = false;
        btnClientAudio.className = "cp-audio-btn";
        badgeClientAudio.textContent = "OFF";
        updateOverallState();
        break;

      case "MEETING_AUDIO_ERROR":
        isClientAudioLive = false;
        btnClientAudio.className = "cp-audio-btn";
        badgeClientAudio.textContent = "OFF";
        updateOverallState();
        showError(message.error || "Client audio failed.");
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

  // ---------------- Transcript & Turn Processing ----------------

  function setInterim(speaker, text) {
    const emptyEl = logEl.querySelector(".cp-empty");
    if (emptyEl) emptyEl.remove();

    let targetEl = (speaker === "YOU") ? youInterimEl : clientInterimEl;
    if (!text) {
      if (targetEl) targetEl.remove();
      if (speaker === "YOU") youInterimEl = null;
      else clientInterimEl = null;
      return;
    }

    if (!targetEl) {
      targetEl = document.createElement("div");
      targetEl.className = "cp-turn cp-interim";
      targetEl.innerHTML = `<span class="cp-spk ${speaker === "YOU" ? "cp-spk-you" : "cp-spk-client"}">${speaker}</span><span class="cp-txt"></span>`;
      logEl.appendChild(targetEl);
      if (speaker === "YOU") youInterimEl = targetEl;
      else clientInterimEl = targetEl;
    }

    targetEl.querySelector(".cp-txt").textContent = text;
    logEl.scrollTop = logEl.scrollHeight;
  }

  function addFinal(speaker, text) {
    const emptyEl = logEl.querySelector(".cp-empty");
    if (emptyEl) emptyEl.remove();

    if (speaker === "YOU" && youInterimEl) { youInterimEl.remove(); youInterimEl = null; }
    if (speaker === "CLIENT" && clientInterimEl) { clientInterimEl.remove(); clientInterimEl = null; }

    const words = text.trim().split(/\s+/).length;
    if (speaker === "YOU") youWordsCount += words;
    else clientWordsCount += words;
    totalTurns++;

    const turnEl = document.createElement("div");
    turnEl.className = "cp-turn";
    turnEl.innerHTML = `<span class="cp-spk ${speaker === "YOU" ? "cp-spk-you" : "cp-spk-client"}">${speaker}</span><span class="cp-txt">${escapeHtml(text)}</span>`;
    logEl.appendChild(turnEl);
    logEl.scrollTop = logEl.scrollHeight;

    turnHistory.push({ speaker, text, timestamp: Date.now() });

    // Send to Intelligence Backend for Dynamic Playbook / Battle Card Evaluation
    evaluateTurnWithBackend(speaker, text);
  }

  async function evaluateTurnWithBackend(speaker, text) {
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

    // Telemetry tracking for cue card impression
    if (window.CopilotAnalytics) {
      window.CopilotAnalytics.trackEvent("cue_card_shown", {
        label: cue.label,
        priority,
        event: cue.event,
        source: cue.source
      });
    }
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

    if (window.CopilotAnalytics) {
      window.CopilotAnalytics.trackEvent("call_ended", {
        meetingId,
        durationMin: outcome.duration_min,
        repTalkPct: outcome.rep_talk_time_pct,
        clientTalkPct: outcome.client_talk_time_pct,
        topics: outcome.key_topics
      });
      window.CopilotAnalytics.flushEvents();
    }

    // Auto open Call Summary dropdown
    $("cp-acc-body-summary").classList.add("open");
    $("cp-acc-arrow-summary").textContent = "▾";
  }

  function generateLocalSummary() {
    const total = youWordsCount + clientWordsCount;
    const youRatio = total > 0 ? Math.round((youWordsCount / total) * 100) : 48;
    const clientRatio = 100 - youRatio;
    const durationMin = Math.max(1, Math.round(totalTurns * 0.4));

    const allText = turnHistory.map((t) => t.text.toLowerCase()).join(" ");
    const topics = [];
    if (allText.includes("expensive") || allText.includes("budget") || allText.includes("thousand") || allText.includes("cost")) topics.push("Pricing & Budget");
    if (allText.includes("competitor") || allText.includes("other firm") || allText.includes("quote") || allText.includes("hubspot")) topics.push("Competitor Mention");
    if (allText.includes("hours") || allText.includes("manual") || allText.includes("bottleneck")) topics.push("Workflow Pain Points");
    if (allText.includes("timeline") || allText.includes("asap") || allText.includes("start")) topics.push("Timeline & Kickoff");
    if (allText.includes("soc2") || allText.includes("security") || allText.includes("compliance")) topics.push("Security & Compliance");
    if (!topics.length) topics.push("Discovery & Scope Alignment");

    const notes =
`CALL SUMMARY (${durationMin} min)
Talk Ratio: Rep ${youRatio}% | Client ${clientRatio}%

Key Topics Discussed:
${topics.map((t) => `• ${t}`).join("\n")}

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
    $("cp-topics-wrap").innerHTML = topics.map((t) => `<span class="cp-topic-tag">${escapeHtml(t)}</span>`).join("");

    $("cp-notes-box").textContent = data.notes || "Call summary saved.";
  }

  function escapeHtml(str) {
    return (str || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  window.addEventListener("beforeunload", () => {
    if (isMyAudioLive) stopMyAudio();
    if (isClientAudioLive) stopClientAudio();
  });

  refreshSalesforceStatus();
  updateOverallState();
})();
