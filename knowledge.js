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
    triggers: [
      "healthcare",
      "health care",
      "medical",
      "hospital",
      "clinic",
      "hipaa",
      "patient",
    ],
    label: "RELEVANT CASE STUDY",
    bullets: ["MedFlow: +34% conversion", "Redesigned patient onboarding"],
  },
  {
    id: "fintech",
    triggers: [
      "fintech",
      "bank",
      "financial",
      "payments",
      "compliance",
      "soc2",
    ],
    label: "RELEVANT CASE STUDY",
    bullets: ["LedgerPay: 6wk to launch", "SOC2 delivered in scope"],
  },
  {
    id: "ecommerce",
    triggers: [
      "ecommerce",
      "e-commerce",
      "shopify",
      "retail",
      "cart",
      "checkout",
    ],
    label: "RELEVANT CASE STUDY",
    bullets: ["NorthGoods: +22% AOV", "Checkout rebuilt in 4 weeks"],
  },
  {
    id: "pricing",
    triggers: [
      "how much",
      "what do you charge",
      "your rates",
      "pricing",
      "cost of your",
    ],
    label: "OUR PRICING",
    bullets: ["Discovery sprint: $8,000", "Retainer from $6,000/mo"],
  },
  {
    id: "timeline_faq",
    triggers: [
      "how long",
      "how fast",
      "turnaround",
      "when can you start",
      "lead time",
    ],
    label: "DELIVERY FACTS",
    bullets: ["Kickoff within 2 weeks", "First deliverable in 21 days"],
  },
  {
    id: "team",
    triggers: [
      "how many people",
      "your team",
      "who works on",
      "team size",
      "subcontract",
    ],
    label: "TEAM FACTS",
    bullets: ["Senior-only, no juniors", "Two people per engagement"],
  },
];

async function retrieveFromCognee(text) {
  if (!COGNEE_URL) return null;
  try {
    const res = await fetch(`${COGNEE_URL}/search`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: text, top_k: 1 }),
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
        .slice(0, 2),
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
  const asking =
    /\?|\b(have you|do you|can you|what about|how much|how long|how many)\b/i.test(
      text
    );
  if (!asking) return null;

  const remote = await retrieveFromCognee(text);
  if (remote) return remote;

  return retrieveLocal(text);
}
