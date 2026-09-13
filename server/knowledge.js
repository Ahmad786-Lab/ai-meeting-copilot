/**
 * knowledge.js — company knowledge retrieval.
 *
 * Local keyword matching works out of the box so the meeting copilot
 * surfaces relevant case studies, pricing, and FAQ bullets in under 1ms.
 */

/**
 * These are the case studies, pricing facts and FAQ answers
 * the copilot surfaces mid-call. Keep bullets under 7 words.
 */
export const KNOWLEDGE = [
  {
    id: "healthcare",
    triggers: ["healthcare", "health care", "medical", "hospital", "clinic", "hipaa", "patient", "scheduling", "doctor", "ehr", "telehealth"],
    label: "RELEVANT CASE STUDY (HEALTHCARE)",
    bullets: ["MedFlow: +34% patient conversion", "HIPAA onboarding built in 4 weeks"]
  },
  {
    id: "fintech",
    triggers: ["fintech", "bank", "financial", "payments", "compliance", "soc2", "stripe", "banking", "billing"],
    label: "RELEVANT CASE STUDY (FINTECH)",
    bullets: ["LedgerPay: 6wk to launch MVP", "SOC2 Type II compliance in scope"]
  },
  {
    id: "ai_engineering",
    triggers: ["ai", "agents", "llm", "copilot", "claude", "gpt", "rag", "anthropic", "deepgram", "automation"],
    label: "RELEVANT CASE STUDY (AI/AUTOMATION)",
    bullets: ["Real-time multi-agent copilot", "Sub-100ms pipeline with Director"]
  },
  {
    id: "ecommerce",
    triggers: ["ecommerce", "e-commerce", "shopify", "retail", "cart", "checkout", "conversion", "orders"],
    label: "RELEVANT CASE STUDY (ECOMMERCE)",
    bullets: ["NorthGoods: +22% AOV increase", "Checkout rebuilt in 4 weeks"]
  },
  {
    id: "pricing",
    triggers: ["how much", "what do you charge", "your rates", "pricing", "cost", "rate card", "quote", "cost of your", "proposal cost"],
    label: "OUR PRICING TALKING POINTS",
    bullets: ["Discovery sprint: $8,000 (2 wks)", "Ongoing retainer from $6,000/mo"]
  },
  {
    id: "timeline_faq",
    triggers: ["how long", "how fast", "turnaround", "when can you start", "lead time", "timeline", "start date", "kickoff", "how soon"],
    label: "DELIVERY & TIMELINE FACTS",
    bullets: ["Kickoff within 10 business days", "First production milestone in 21 days"]
  },
  {
    id: "team",
    triggers: ["how many people", "your team", "who works on", "team size", "subcontract", "who will do", "engineers", "developers"],
    label: "TEAM & POD STRUCTURE",
    bullets: ["Senior-only engineers, no juniors", "Dedicated two-person pod per project"]
  }
];

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

  if (!best || bestScore === 0) return null;
  return { label: best.label, bullets: best.bullets, id: best.id };
}

export async function retrieveKnowledge(text) {
  // Surfaces talking points whenever relevant topics are mentioned
  return retrieveLocal(text);
}
