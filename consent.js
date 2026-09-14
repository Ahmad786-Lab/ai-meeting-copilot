/**
 * consent.js — Audio Privacy Notice Modal & Consent Management
 *
 * Verifies user consent in chrome.storage.local before capturing audio.
 * Displays accessible modal compliant with GDPR/audio wiretapping notices.
 */

window.CopilotConsent = (() => {
  const STORAGE_KEY = "user_consented";

  function hasConsented() {
    return new Promise((resolve) => {
      chrome.storage.local.get([STORAGE_KEY], (res) => {
        resolve(Boolean(res && res[STORAGE_KEY]));
      });
    });
  }

  function showModal() {
    return new Promise((resolve) => {
      // Avoid duplicate modals
      if (document.getElementById("ai-copilot-consent-modal")) return;

      // Link CSS if not already injected
      if (!document.getElementById("cp-consent-style")) {
        const link = document.createElement("link");
        link.id = "cp-consent-style";
        link.rel = "stylesheet";
        link.href = chrome.runtime.getURL("consent.css");
        document.head.appendChild(link);
      }

      const modalWrapper = document.createElement("div");
      modalWrapper.id = "ai-copilot-consent-modal";
      modalWrapper.className = "cp-consent-overlay";
      modalWrapper.setAttribute("role", "dialog");
      modalWrapper.setAttribute("aria-modal", "true");
      modalWrapper.innerHTML = `
        <div class="cp-consent-card">
          <div class="cp-consent-header">
            <span class="cp-consent-icon">🔒</span>
            <h2 class="cp-consent-title">Audio Privacy Notice</h2>
          </div>

          <p class="cp-consent-intro">
            This extension captures your microphone and meeting audio to provide real-time sales coaching.
          </p>

          <ul class="cp-consent-list">
            <li>
              <span class="cp-bullet-icon">🔒</span>
              <span>Your audio is encrypted and sent to Deepgram for transcription only.</span>
            </li>
            <li>
              <span class="cp-bullet-icon">⏰</span>
              <span>Transcripts are stored locally on your machine for 30 days, then auto-deleted.</span>
            </li>
            <li>
              <span class="cp-bullet-icon">⚠️</span>
              <span>All meeting participants should consent to audio capture. Check your local laws.</span>
            </li>
            <li>
              <span class="cp-bullet-icon">📋</span>
              <span>See our Privacy Policy for data retention and deletion policies.</span>
            </li>
          </ul>

          <div class="cp-consent-actions">
            <button id="cp-consent-decline" class="cp-btn cp-btn-decline" type="button">Decline (Extension Disabled)</button>
            <button id="cp-consent-agree" class="cp-btn cp-btn-agree" type="button">I Agree & Continue</button>
          </div>
        </div>
      `;

      document.body.appendChild(modalWrapper);

      const agreeBtn = document.getElementById("cp-consent-agree");
      const declineBtn = document.getElementById("cp-consent-decline");

      // Trap focus
      agreeBtn.focus();

      agreeBtn.addEventListener("click", async () => {
        const timestamp = Date.now();
        await chrome.storage.local.set({ [STORAGE_KEY]: timestamp });
        modalWrapper.remove();
        resolve(true);
      });

      declineBtn.addEventListener("click", async () => {
        await chrome.storage.local.set({ [STORAGE_KEY]: false });
        modalWrapper.remove();
        resolve(false);
      });
    });
  }

  async function ensureConsent() {
    const consented = await hasConsented();
    if (consented) return true;
    return await showModal();
  }

  return {
    hasConsented,
    showModal,
    ensureConsent
  };
})();
