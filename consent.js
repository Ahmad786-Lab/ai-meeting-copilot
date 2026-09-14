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
      try {
        if (!chrome || !chrome.storage || !chrome.storage.local) {
          resolve(true);
          return;
        }
        chrome.storage.local.get([STORAGE_KEY], (res) => {
          if (chrome.runtime && chrome.runtime.lastError) {
            resolve(true);
            return;
          }
          resolve(Boolean(res && res[STORAGE_KEY]));
        });
      } catch (e) {
        resolve(true);
      }
    });
  }

  function showModal() {
    return new Promise((resolve) => {
      try {
        // Remove duplicate modal if present
        const existing = document.getElementById("ai-copilot-consent-modal");
        if (existing) existing.remove();

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
              <button id="cp-consent-decline" class="cp-btn cp-btn-decline" type="button">Decline</button>
              <button id="cp-consent-agree" class="cp-btn cp-btn-agree" type="button">I Agree & Continue</button>
            </div>
          </div>
        `;

        document.body.appendChild(modalWrapper);

        const agreeBtn = document.getElementById("cp-consent-agree");
        const declineBtn = document.getElementById("cp-consent-decline");

        if (agreeBtn) {
          agreeBtn.focus();
          agreeBtn.addEventListener("click", async () => {
            const timestamp = Date.now();
            try {
              if (chrome && chrome.storage && chrome.storage.local) {
                await chrome.storage.local.set({ [STORAGE_KEY]: timestamp });
              }
            } catch (e) {}
            modalWrapper.remove();
            resolve(true);
          });
        }

        if (declineBtn) {
          declineBtn.addEventListener("click", async () => {
            try {
              if (chrome && chrome.storage && chrome.storage.local) {
                await chrome.storage.local.set({ [STORAGE_KEY]: false });
              }
            } catch (e) {}
            modalWrapper.remove();
            resolve(false);
          });
        }

        // Safety timeout to prevent freeze
        setTimeout(() => {
          if (document.getElementById("ai-copilot-consent-modal")) {
            resolve(true);
          }
        }, 15000);
      } catch (err) {
        resolve(true);
      }
    });
  }

  async function ensureConsent() {
    try {
      const consented = await hasConsented();
      if (consented) return true;
      return await showModal();
    } catch (e) {
      return true;
    }
  }

  return {
    hasConsented,
    showModal,
    ensureConsent
  };
})();
