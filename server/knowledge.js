/**
 * knowledge.js — company knowledge retrieval.
 *
 * Local keyword matching works out of the box so the demo never depends
 * on a network call. COGNEE_URL swaps in the real memory engine when
 * you have it running, with the local path as automatic fallback.
 */

const COGNEE_URL = process.env.COGNEE_URL;

/**
 * Edit this. These are the case studies, pricing facts and FAQ answers
 * the copilot can surface mid-call. Keep bullets under 7 words.
 */
export const KNOWLEDGE = [
  {
    id: "healthcare",
    triggers: ["healthcare", "health care", "medical", "hospital", "clinic", "hipaa", "patient", "scheduling", "doctor", "ehr", "telehealth"],
    label: "RELEVANT CASE STUDY",
    bullets: ["MedFlow: +34% patient conversion", "HIPAA onboarding built in 4 weeks"]
  },
  {
    id: "fintech",
    triggers: ["fintech", "bank", "financial", "payments", "compliance", "soc2", "stripe", "banking"],
    label: "RELEVANT CASE STUDY",
    bullets: ["LedgerPay: 6wk to launch MVP", "SOC2 Type II in scope"]
  },
  {
    id: "ai_engineering",
    triggers: ["ai", "agents", "llm", "copilot", "claude", "gpt", "rag", "anthropic", "deepgram"],
    label: "RELEVANT CASE STUDY",
    bullets: ["Real-time multi-agent copilot", "Sub-100ms pipeline with Director"]
  },
  {
    id: "ecommerce",
    triggers: ["ecommerce", "e-commerce", "shopify", "retail", "cart", "checkout", "conversion"],
    label: "RELEVANT CASE STUDY",
    bullets: ["NorthGoods: +22% AOV increase", "Checkout rebuilt in 4 weeks"]
  },
  {
    id: "pricing",
    triggers: ["how much", "what do you charge", "your rates", "pricing", "cost of your", "rate card", "quote"],
    label: "OUR PRICING",
    bullets: ["Discovery sprint: $8,000 (2 wks)", "Retainer from $6,000/mo"]
  },
  {
    id: "timeline_faq",
    triggers: ["how long", "how fast", "turnaround", "when can you start", "lead time", "timeline", "start date"],
    label: "DELIVERY FACTS",
    bullets: ["Kickoff within 10 business days", "First production milestone in 21 days"]
  },
  {
    id: "team",
    triggers: ["how many people", "your team", "who works on", "team size", "subcontract", "who will do"],
    label: "TEAM FACTS",
    bullets: ["Senior-only engineers, no juniors", "Two-person pod per engagement"]
  }
];

async function retrieveFromCognee(text) {
  if (!COGNEE_URL) return null;
  try {
    const res = await fetch(`${COGNEE_URL}/search`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: text, top_k: 1 })
    });
    if (!res.ok) return null;
    const data = await res.json();
    const hit = (data.results || data.hits || [])[0];
    if (!hit) return null;
    return {
      label: "RELEVANT CONTEXT",
      bullets: String(hit.text || hit.content || "")
        .split("\n")
        .filter(Boolean)
        .slice(0, 2)
    };
  } catch (err) {
    console.warn("[cognee]", err.message);
    return null;
  }
}

function retrieveLocal(text) {
  const lower = text.toLowerCase();
  let best = null;
  let bestScore = 0;

  for (const item of KNOWLEDGE) {
    const score = item.triggers.filter((t) => lower.includes(t)).length;
    if (score > bestScore) {
      bestScore = score;
      best = item;
    }
  }

  if (!best) return null;
  return { label: best.label, bullets: best.bullets, id: best.id };
}

export async function retrieveKnowledge(text) {
  // Only retrieve when the client is actually asking something.
  const asking = /\?|\b(have you|do you|can you|what about|how much|how long|how many)\b/i.test(text);
  if (!asking) return null;

  const remote = await retrieveFromCognee(text);
  if (remote) return remote;

  return retrieveLocal(text);
}
