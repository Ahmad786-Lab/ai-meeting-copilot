/* background.js — Service worker for AI Meeting Copilot */

const OFFSCREEN_PATH = "offscreen.html";

let activeTabId = null;
let creating = null;
let capturing = false;

// ---------------- Offscreen Document Management ----------------

async function hasOffscreen() {
  if (chrome.runtime.getContexts) {
    try {
      const contexts = await chrome.runtime.getContexts({
        contextTypes: ["OFFSCREEN_DOCUMENT"],
      });
      return contexts.length > 0;
    } catch (e) {}
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
  } catch (err) {
    if (!err.message || !err.message.includes("Only a single offscreen document")) {
      throw err;
    }
  } finally {
    creating = null;
  }
}

async function closeOffscreen() {
  if (await hasOffscreen()) {
    try {
      await chrome.offscreen.closeDocument();
    } catch (e) {}
  }
}

// ---------------- Content Script Bridge ----------------

function toContent(message) {
  if (activeTabId == null) return;
  chrome.tabs.sendMessage(activeTabId, message).catch(() => {});
}

// ---------------- Tab Audio Capture Lifecycle ----------------

async function startTabCapture(tabId) {
  if (capturing && activeTabId === tabId) {
    toContent({ type: "MEETING_AUDIO_READY" });
    return;
  }

  if (capturing) {
    await stopTabCapture();
  }

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
  try {
    chrome.runtime.sendMessage({ target: "offscreen", type: "STOP_TAB_CAPTURE" });
  } catch (e) {}
  await closeOffscreen();
  toContent({ type: "MEETING_AUDIO_STOPPED" });
  activeTabId = null;
}

// ---------------- Toolbar Icon Direct Toggle (No Popup) ----------------

if (chrome.action && chrome.action.onClicked) {
  chrome.action.onClicked.addListener(async (tab) => {
    if (!tab || !tab.id) return;
    if (capturing && activeTabId === tab.id) {
      await stopTabCapture();
    } else {
      try {
        await startTabCapture(tab.id);
      } catch (err) {
        console.error("[copilot] action click capture failed:", err);
        toContent({ type: "MEETING_AUDIO_ERROR", error: err.message });
      }
    }
  });
}

// ---------------- Keyboard Shortcut (Alt+Shift+M) ----------------

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

// ---------------- Message Router ----------------

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.target === "offscreen") return;

  switch (message.type) {
    // Content script requesting direct client audio capture
    case "START_MEETING_AUDIO":
    case "ACTIVATE_MEETING_COPILOT":
    case "REQUEST_MEETING_AUDIO": {
      const tabId = (sender && sender.tab && sender.tab.id) ? sender.tab.id : (message.tabId || activeTabId);
      if (!tabId) {
        sendResponse({ ok: false, error: "No active Google Meet tab detected." });
        return true;
      }
      startTabCapture(tabId)
        .then(() => sendResponse({ ok: true }))
        .catch((err) => {
          console.error("[copilot] startTabCapture failed:", err.message);
          toContent({ type: "MEETING_AUDIO_ERROR", error: err.message });
          sendResponse({ ok: false, error: err.message });
        });
      return true;
    }

    case "STOP_MEETING_AUDIO":
    case "DEACTIVATE_MEETING_COPILOT":
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
  if (tabId === activeTabId) {
    stopTabCapture().catch(() => {});
  }
});
