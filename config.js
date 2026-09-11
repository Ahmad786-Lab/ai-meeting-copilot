/* config.js
 * ----------------------------------------------------------------
 * Your settings. Edit this file, save it, then reload the extension
 * at chrome://extensions. Chrome does not pick up edits on its own.
 *
 * Local development only. Anyone who installs this extension can read
 * this file, so this key must move behind a backend that issues
 * temporary credentials before anyone else uses the product.
 */

var AI_COPILOT_CONFIG = {
  DEEPGRAM_API_KEY: "1951c128682faca7eae8f43605be44a5ca809e54",
  SERVER_URL: "http://localhost:3000",

  // ---- Language ------------------------------------------------
  //
  // "multi"  Mixed-language conversations. Handles switching between
  //          languages mid-sentence. Requires MODEL: "nova-3".
  //          Supports: English, Spanish, French, German, Hindi,
  //          Italian, Japanese, Dutch, Russian, Portuguese.
  //
  // "en"     English only. Most accurate if the call is truly
  //          English-only.
  //
  // "es"     Any single language code also works ("fr", "de", "hi",
  //          "pt", "ja", ...). Use this when you know the call is in
  //          one non-English language - it beats "multi" for accuracy.
  //
  LANGUAGE: "multi",

  // Automatically pause transcribing you when your microphone is muted in Google Meet.
  RESPECT_MEET_MUTE: true,

  // Show non-Latin scripts in Latin letters you can read out loud.
  // "मैं सोच रहा हूं" -> "main soch raha hoon"
  // This does NOT translate. Set to false to see the native script.
  ROMANIZE: true,

  // nova-3 is required for LANGUAGE: "multi".
  // nova-2 covers some languages nova-3 doesn't support yet.
  MODEL: "nova-3",
};

// ---- Do not edit below --------------------------------------------

function aiCopilotDeepgramUrl() {
  const cfg = AI_COPILOT_CONFIG;

  // Deepgram recommends 100ms endpointing for code-switching,
  // 300ms is better for a single known language.
  const endpointing = cfg.LANGUAGE === "multi" ? 100 : 300;

  const params = new URLSearchParams({
    model: cfg.MODEL,
    language: cfg.LANGUAGE,
    smart_format: "true",
    interim_results: "true",
    endpointing: String(endpointing),
    utterance_end_ms: "1000",
  });

  return "wss://api.deepgram.com/v1/listen?" + params.toString();
}
