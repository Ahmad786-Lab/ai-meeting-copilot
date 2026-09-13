/* background.js — service worker */

const OFFSCREEN_PATH = "offscreen.html";

let activeTabId = null;
let creating = null;
let capturing = false;

// ---------------- offscreen document ----------------

async function hasOffscreen() {
  if (chrome.runtime.getContexts) {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ["OFFSCREEN_DOCUMENT"],
      documentUrls: [chrome.runtime.getURL(OFFSCREEN_PATH)],
    });
    return contexts.length > 0;
  }
  return false;
}

async function ensureOffscreen() {
  if (await hasOffscreen()) return;
  if (creating) {
    await creating;
    return;
  }
  creating = chrome.offscreen.createDocument({
    url: OFFSCREEN_PATH,
    reasons: ["USER_MEDIA"],
    justification: "Capture meeting tab audio so it can be transcribed.",
  });
  try {
    await creating;
  } finally {
    creating = null;
  }
}

async function closeOffscreen() {
  if (await hasOffscreen()) {
    await chrome.offscreen.closeDocument();
  }
}

// ---------------- content script bridge ----------------

function toContent(message) {
  if (activeTabId == null) return;
  chrome.tabs.sendMessage(activeTabId, message).catch(() => {});
}

// ---------------- start / stop ----------------

async function startTabCapture(tabId) {
  // Already capturing this tab. Don't try again - Chrome rejects a second
  // capture on the same tab, and the user would see a false error.
  if (capturing && activeTabId === tabId) {
    toContent({ type: "MEETING_AUDIO_READY" });
    return;
  }

  // Capturing a different tab: tear the old one down first.
  if (capturing) await stopTabCapture();

  activeTabId = tabId;

  await ensureOffscreen();

  const streamId = await new Promise((resolve, reject) => {
    chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }, (id) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(id);
    });
  });

  chrome.runtime.sendMessage({
    target: "offscreen",
    type: "START_TAB_CAPTURE",
    streamId,
  });
}

async function stopTabCapture() {
  capturing = false;
  chrome.runtime.sendMessage({ target: "offscreen", type: "STOP_TAB_CAPTURE" });
  await closeOffscreen();
  toContent({ type: "MEETING_AUDIO_STOPPED" });
  activeTabId = null;
}

// ---------------- router ----------------

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message && message.target === "offscreen") return;

  switch (message && message.type) {
    case "ACTIVATE_MEETING_COPILOT":
      startTabCapture(message.tabId)
        .then(() => sendResponse({ ok: true }))
        .catch((err) => {
          console.error("[copilot] activation failed:", err);
          if (!capturing) {
            toContent({ type: "MEETING_AUDIO_ERROR", error: err.message });
          }
          sendResponse({
            ok: capturing,
            error: capturing ? null : err.message,
          });
        });
      return true;

    case "DEACTIVATE_MEETING_COPILOT":
      stopTabCapture()
        .then(() => sendResponse({ ok: true }))
        .catch((err) => sendResponse({ ok: false, error: err.message }));
      return true;

    // Content script asking to start meeting audio directly or via popup bridge
    case "START_MEETING_AUDIO":
    case "REQUEST_MEETING_AUDIO": {
      const tabId = (sender && sender.tab) ? sender.tab.id : (message.tabId || activeTabId);
      startTabCapture(tabId)
        .then(() => sendResponse({ ok: true }))
        .catch(async (err) => {
          console.warn("[copilot] meeting audio direct start failed, trying popup bridge:", err.message);
          try {
            await chrome.storage.local.set({ autoStartTabAudio: true, targetTabId: tabId });
            if (chrome.action && chrome.action.openPopup) {
              await chrome.action.openPopup();
              sendResponse({ ok: true, viaPopup: true });
            } else {
              sendResponse({
                ok: false,
                error: "Click extension icon in toolbar once to enable tab audio."
              });
            }
          } catch (popupErr) {
            console.error("[copilot] openPopup failed:", popupErr.message);
            sendResponse({
              ok: false,
              error: "Click extension icon in toolbar once to permit tab audio."
            });
          }
        });
      return true;
    }

    case "STOP_MEETING_AUDIO":
      stopTabCapture()
        .then(() => sendResponse({ ok: true }))
        .catch(() => sendResponse({ ok: false }));
      return true;

    case "OFFSCREEN_CAPTURE_READY":
      capturing = true;
      toContent({ type: "MEETING_AUDIO_READY" });
      break;

    case "OFFSCREEN_ERROR":
      console.error("[copilot] offscreen error:", message.error);
      capturing = false;
      toContent({ type: "MEETING_AUDIO_ERROR", error: message.error });
      break;

    case "GET_STATUS":
      sendResponse({ capturing, activeTabId });
      return true;

    case "CLIENT_TRANSCRIPT":
      toContent({
        type: "CLIENT_TRANSCRIPT",
        text: message.text,
        isFinal: message.isFinal,
      });
      break;
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === activeTabId) stopTabCapture().catch(() => {});
});
