/**
 * llm.js — one small wrapper around the model.
 *
 * Everything here is designed to degrade rather than fail. If there is
 * no API key, or the call is slow, or the model returns something that
 * isn't JSON, we return the caller's fallback. A live HUD must never
 * block on the network.
 */

const API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.LLM_MODEL || "claude-haiku-4-5-20251001";
const TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS || 2500);

export const llmAvailable = Boolean(API_KEY);

export async function llmJson({ system, user, fallback, maxTokens = 200 }) {
  if (!API_KEY) return fallback;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        "x-api-key": API_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: maxTokens,
        system: system + "\n\nReturn raw JSON only. No markdown, no prose.",
        messages: [{ role: "user", content: user }]
      })
    });

    if (!res.ok) {
      console.warn("[llm] http", res.status);
      return fallback;
    }

    const data = await res.json();
    const text = (data.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("")
      .replace(/```json|```/g, "")
      .trim();

    return JSON.parse(text);
  } catch (err) {
    if (err.name !== "AbortError") console.warn("[llm]", err.message);
    return fallback;
  } finally {
    clearTimeout(timer);
  }
}

/** Bigger, slower call for post-meeting work. No timeout pressure. */
export async function llmText({ system, user, maxTokens = 1500 }) {
  if (!API_KEY) return null;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": API_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: process.env.LLM_MODEL_LARGE || "claude-sonnet-5",
        max_tokens: maxTokens,
        system,
        messages: [{ role: "user", content: user }]
      })
    });

    if (!res.ok) return null;
    const data = await res.json();
    return (data.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("");
  } catch (err) {
    console.warn("[llm-large]", err.message);
    return null;
  }
}
