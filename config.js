/* config.js
 * ----------------------------------------------------------------
 * Client configuration. API keys have been moved to backend (.env)
 * to ensure maximum security.
 */

var AI_COPILOT_CONFIG = {
  SERVER_URL: "http://localhost:3000",
  SERVER_WS_URL: "ws://localhost:3000/transcribe",

  // ---- Language ------------------------------------------------
  // "multi"  Mixed-language conversations (English, Spanish, Hindi, etc.)
  // "en"     English only
  LANGUAGE: "multi",

  // Automatically pause transcribing when microphone is muted in Google Meet.
  RESPECT_MEET_MUTE: true,

  // Show non-Latin scripts in Latin letters
  ROMANIZE: true,

  // Deepgram model managed by backend
  MODEL: "nova-2",
};
