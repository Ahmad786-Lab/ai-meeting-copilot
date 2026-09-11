/**
 * agents.js — the multi-agent fan-out.
 *
 * On every completed turn, four agents run IN PARALLEL against the
 * meeting's own isolated store. A fifth component, the Director,
 * reads all four results and decides whether the user's attention is
 * worth interrupting.
 *
 * Layer 1 is pure pattern matching and costs nothing. Layer 2 only
 * fires when Layer 1 finds a candidate, which keeps latency and spend
 * down and stops the HUD nagging on every sentence.
 */

import { AGENDA_SLOTS, missingSlots } from "./state.js";
import { llmJson, llmAvailable } from "./llm.js";
import { retrieveKnowledge } from "knowledge.js";

// ---------------------------------------------------------------
// Layer 1 — free, instant pattern matching
// ---------------------------------------------------------------

const PATTERNS = [
  {
    event: "price_objection",
    label: "PRICE OBJECTION",
    re: /\b(expensive|too much|pricey|costs? too|out of (our )?budget|cheaper|quoted us|lower price|can'?t afford)\b/i,
    importance: 0.95,
  },
  {
    event: "competitor_mention",
    label: "COMPETITOR",
    re: /\b(another agency|another vendor|competitor|we'?re also (talking|looking)|other quote|someone else quoted)\b/i,
    importance: 0.85,
  },
  {
    event: "pain_point",
    label: "QUANTIFY THE PAIN",
    re: /\b(manually|hours (a|every|per) week|struggle|problem is|pain|frustrat|takes us|waste|inefficien|bottleneck)\b/i,
    importance: 0.8,
  },
  {
    event: "buying_signal",
    label: "BUYING SIGNAL",
    re: /\b(how (soon|quickly) can|when could we start|what'?s the next step|send (us|me) (a|the) proposal|sign|get started|onboard)\b/i,
    importance: 0.9,
  },
  {
    event: "budget",
    label: "BUDGET MENTIONED",
    re: /\b(budget|\$\s?\d|\d+k\b|spend|allocated|price range)\b/i,
    importance: 0.7,
  },
  {
    event: "timeline",
    label: "TIMELINE",
    re: /\b(by (next|the end)|deadline|timeline|q[1-4]\b|next (month|quarter|week)|asap|end of (the )?(month|year))\b/i,
    importance: 0.6,
  },
  {
    event: "decision_maker",
    label: "DECISION MAKER",
    re: /\b(my (boss|partner|team)|need to (check|ask|run it by)|the board|our cto|ceo|approve|sign ?off|stakeholder)\b/i,
    importance: 0.75,
  },
  {
    event: "technical_question",
    label: "QUESTION ASKED",
    re: /\b(have you (worked|done)|do you (have|support|integrate)|can you|what about|experience with|case stud)\b/i,
    importance: 0.8,
  },
  {
    event: "scope_risk",
    label: "SCOPE RISK",
    re: /\b(also need|while you'?re at it|one more thing|could you also|add(ing)? on|as well as)\b/i,
    importance: 0.7,
  },
];

function detectPatterns(text) {
  return PATTERNS.filter((p) => p.re.test(text));
}

const COMMITMENT_RE =
  /\b(i'?ll|we'?ll|i will|we will|let me|send (you|me)|i'?m going to|by (monday|tuesday|wednesday|thursday|friday|tomorrow|next week)|follow up)\b/i;

// ---------------------------------------------------------------
// Agent 1 — Event Detector
// ---------------------------------------------------------------

async function eventAgent(meeting, speaker, text) {
  const hits = detectPatterns(text);
  if (!hits.length) return { events: [] };

  // Only the client's words create pressure on the user.
  const relevant =
    speaker === "CLIENT"
      ? hits
      : hits.filter((h) => ["commitment", "scope_risk"].includes(h.event));

  return {
    events: relevant.map((h) => ({
      event: h.event,
      label: h.label,
      importance: h.importance,
    })),
  };
}

// ---------------------------------------------------------------
// Agent 2 — Agenda Tracker (slot filling)
// ---------------------------------------------------------------

async function agendaAgent(meeting, speaker, text) {
  const open = missingSlots(meeting);
  if (!open.length) return { diff: null };

  // Cheap pre-filter: don't call the model unless a slot plausibly moved.
  const looksRelevant =
    PATTERNS.some((p) => AGENDA_SLOTS.includes(p.event) && p.re.test(text)) ||
    /\b(problem|goal|want|need|hoping|trying to)\b/i.test(text);

  if (!looksRelevant) return { diff: null };

  // No model key? Fall back to patterns so the agenda still fills.
  if (!llmAvailable) return { diff: rulesDiff(text, open) };

  const diff = await llmJson({
    system:
      "You extract structured facts from one turn of a sales discovery call. " +
      "Return JSON only. Include a key ONLY if this turn clearly establishes it. " +
      "Omit anything uncertain. Values must be under 8 words.",
    user:
      `Open slots: ${open.join(", ")}\n` +
      `Speaker: ${speaker}\n` +
      `Turn: "${text}"\n\n` +
      `Return JSON with any of: ${open.map((s) => `"${s}"`).join(", ")}. ` +
      `Return {} if nothing is established.`,
    fallback: {},
  });

  return { diff };
}

const SLOT_RULES = {
  problem:
    /\b(manually|problem is|struggle|pain|takes us|waste|bottleneck|hours (a|every|per) week)\b/i,
  goals:
    /\b(we want|we need|goal is|hoping to|trying to|looking to|success (would|looks))\b/i,
  budget:
    /\b(budget|\$\s?\d|\d+\s?k\b|thousand|allocated|price range|we can spend)\b/i,
  timeline:
    /\b(by (next|the end)|deadline|q[1-4]\b|next (month|quarter|week)|end of (the )?(month|quarter|year)|asap)\b/i,
  decision_maker:
    /\b(my (boss|partner|manager)|check with|run it by|the board|approve|sign ?off|i decide|i'?m the one who)\b/i,
  next_step:
    /\b(send (you|me)|follow up|next step|proposal|schedule|book|call on|meet (again|on))\b/i,
};

function rulesDiff(text, open) {
  const diff = {};
  for (const slot of open) {
    const re = SLOT_RULES[slot];
    if (re && re.test(text)) {
      // Store the sentence fragment as evidence.
      diff[slot] = text.length > 60 ? text.slice(0, 57) + "..." : text;
    }
  }
  return Object.keys(diff).length ? diff : null;
}

// ---------------------------------------------------------------
// Agent 3 — Commitment Extractor
// ---------------------------------------------------------------

async function commitmentAgent(meeting, speaker, text) {
  if (!COMMITMENT_RE.test(text)) return { commitments: [] };

  if (!llmAvailable) {
    const due = text.match(
      /\b(monday|tuesday|wednesday|thursday|friday|tomorrow|next week|end of (the )?(week|month))\b/i
    );
    return {
      commitments: [
        {
          owner: speaker,
          action: text.length > 70 ? text.slice(0, 67) + "..." : text,
          due: due ? due[0] : null,
        },
      ],
    };
  }

  const result = await llmJson({
    system:
      "Extract concrete commitments from one turn of a meeting. " +
      "A commitment is a specific action someone promised to do. " +
      'Return JSON: {"commitments":[{"owner":"YOU"|"CLIENT","action":"...","due":"..."|null}]}. ' +
      "Return an empty array if nothing was actually promised.",
    user: `Speaker: ${speaker}\nTurn: "${text}"`,
    fallback: { commitments: [] },
  });

  return { commitments: result.commitments || [] };
}

// ---------------------------------------------------------------
// Agent 4 — Knowledge Retriever
// ---------------------------------------------------------------

async function knowledgeAgent(meeting, speaker, text) {
  if (speaker !== "CLIENT") return { knowledge: null };
  const knowledge = await retrieveKnowledge(text);
  return { knowledge };
}

// ---------------------------------------------------------------
// The Director — decides whether to interrupt
// ---------------------------------------------------------------

const COOLDOWN_MS = 10000; // hackathon demo pacing; 90s in production
const MAX_CUES = 12;

async function director(meeting, speaker, text, results) {
  const { events, knowledge } = results;

  if (!events.length && !knowledge) return null;

  const now = Date.now();
  if (meeting.cue_count >= MAX_CUES) return null;

  // Knowledge beats advice and bypasses the cooldown: the client asked a
  // direct question, so answering it is never an interruption.
  if (knowledge) {
    meeting.last_cue_at = now;
    meeting.cue_count += 1;
    return {
      label: knowledge.label,
      bullets: knowledge.bullets,
      source: "knowledge",
      event: "knowledge_retrieval",
    };
  }

  const top = events.sort((a, b) => b.importance - a.importance)[0];

  // High-stakes moments (price objections, buying signals) override the
  // cooldown. Everything else waits its turn.
  const urgent = top.importance >= 0.9;
  if (!urgent && now - meeting.last_cue_at < COOLDOWN_MS) return null;

  const cue = await llmJson({
    system:
      "You are a live sales copilot. The user is mid-conversation and can " +
      'only glance at the screen. Return JSON: {"bullets":["...","..."]}. ' +
      "Maximum 2 bullets. Each bullet MUST be under 7 words. " +
      "Imperative voice. No pleasantries, no explanation, no punctuation at the end.",
    user:
      `Detected: ${top.event}\n` +
      `Client just said: "${text}"\n` +
      `Still missing from agenda: ${
        missingSlots(meeting).join(", ") || "nothing"
      }\n` +
      `What should the user do right now?`,
    fallback: { bullets: fallbackBullets(top.event) },
  });

  meeting.last_cue_at = now;
  meeting.cue_count += 1;

  return {
    label: top.label,
    bullets: (cue.bullets || []).slice(0, 2),
    source: "llm",
    event: top.event,
  };
}

// Cached bullets so the HUD never blocks on the network.
function fallbackBullets(event) {
  const map = {
    price_objection: [
      "Ask what their quote includes",
      "Re-anchor on business outcome",
    ],
    competitor_mention: ["Ask what they liked", "Differentiate on outcome"],
    pain_point: ["Ask what those hours cost", "Find out who handles it"],
    buying_signal: ["Confirm a specific date", "Ask who else must approve"],
    budget: [
      "Ask what range they approved",
      "Tie price to the cost of inaction",
    ],
    timeline: ["Ask what drives that date", "Confirm the decision process"],
    decision_maker: ["Ask who signs off", "Offer to join that conversation"],
    technical_question: [
      "Answer with a specific example",
      "Ask why it matters to them",
    ],
    scope_risk: ["Clarify what is in scope", "Price the addition separately"],
  };
  return map[event] || ["Ask an open follow-up question"];
}

// ---------------------------------------------------------------
// Fan-out
// ---------------------------------------------------------------

export async function processTurn(meeting, speaker, text, turnIndex) {
  const t0 = Date.now();

  // Four agents, genuinely in parallel, each reading the same
  // meeting-scoped store.
  const [ev, ag, cm, kn] = await Promise.all([
    eventAgent(meeting, speaker, text),
    agendaAgent(meeting, speaker, text),
    commitmentAgent(meeting, speaker, text),
    knowledgeAgent(meeting, speaker, text),
  ]);

  const results = {
    events: ev.events,
    diff: ag.diff,
    commitments: cm.commitments,
    knowledge: kn.knowledge,
  };

  const cue = await director(meeting, speaker, text, results);

  return {
    ...results,
    cue,
    latency_ms: Date.now() - t0,
    turnIndex,
  };
}
