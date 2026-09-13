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
  if (capturing && activeTabId === tabId) {
    toContent({ type: "MEETING_AUDIO_READY" });
    return;
  }

  if (capturing) await stopTabCapture();

  activeTabId = tabId;

  await ensureOffscreen();

  const streamId = await new Promise((resolve, reject) => {
    try {
      chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }, (id) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (!id) {
          reject(new Error("No stream ID returned by tabCapture."));
          return;
        }
        resolve(id);
      });
    } catch (e) {
      reject(e);
    }
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

// ---------------- keyboard shortcut (Alt+Shift+M) ----------------

if (chrome.commands && chrome.commands.onCommand) {
  chrome.commands.onCommand.addListener(async (command) => {
    if (command === "toggle-meeting-audio") {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || !tab.id) return;
      if (capturing && activeTabId === tab.id) {
        await stopTabCapture();
      } else {
        try {
          await startTabCapture(tab.id);
        } catch (err) {
          console.error("[copilot] shortcut capture failed:", err);
          toContent({ type: "MEETING_AUDIO_ERROR", error: err.message });
        }
      }
    }
  });
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
          console.warn("[copilot] direct tab capture failed:", err.message);
          try {
            await chrome.storage.local.set({ autoStartTabAudio: true, targetTabId: tabId });
            if (chrome.action && chrome.action.openPopup) {
              await chrome.action.openPopup();
              sendResponse({ ok: true, viaPopup: true });
            } else {
              sendResponse({
                ok: false,
                error: "Press Alt+Shift+M or click toolbar icon to allow tab audio."
              });
            }
          } catch (popupErr) {
            sendResponse({
              ok: false,
              error: "Press Alt+Shift+M or click toolbar icon to allow tab audio."
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
