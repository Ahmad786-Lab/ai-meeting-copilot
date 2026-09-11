/* popup.js */

const activateBtn = document.getElementById("activate");
const deactivateBtn = document.getElementById("deactivate");
const msg = document.getElementById("msg");
const tabState = document.getElementById("tabState");

let currentTab = null;

function say(text, cls) {
  msg.textContent = text;
  msg.className = "msg " + (cls || "");
}

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTab = tab;

  const isMeet =
    tab && tab.url && tab.url.indexOf("https://meet.google.com/") === 0;

  tabState.textContent = isMeet
    ? "Google Meet detected."
    : "Open a Google Meet tab to activate.";

  activateBtn.disabled = !isMeet;

  const status = await chrome.runtime.sendMessage({ type: "GET_STATUS" });
  if (status && status.capturing) {
    activateBtn.classList.add("hidden");
    deactivateBtn.classList.remove("hidden");
    say("Meeting audio connected.", "ok");
  }
}

activateBtn.addEventListener("click", async () => {
  if (!currentTab || !currentTab.id) {
    say("Could not find the active tab.", "err");
    return;
  }

  activateBtn.textContent = "Activating…";
  activateBtn.disabled = true;

  const response = await chrome.runtime.sendMessage({
    type: "ACTIVATE_MEETING_COPILOT",
    tabId: currentTab.id,
  });

  activateBtn.textContent = "Activate Copilot";

  if (response && response.ok) {
    // Tell the HUD to start the microphone side too.
    chrome.tabs
      .sendMessage(currentTab.id, { type: "START_MIC" })
      .catch(() => {});
    await chrome.storage.local.set({ isActive: true });
    activateBtn.classList.add("hidden");
    deactivateBtn.classList.remove("hidden");
    say("Meeting audio connected.", "ok");
  } else {
    activateBtn.disabled = false;
    say((response && response.error) || "Activation failed.", "err");
  }
});

deactivateBtn.addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "DEACTIVATE_MEETING_COPILOT" });
  await chrome.storage.local.set({ isActive: false });
  deactivateBtn.classList.add("hidden");
  activateBtn.classList.remove("hidden");
  activateBtn.disabled = false;
  say("Stopped.", "");
});

init();
