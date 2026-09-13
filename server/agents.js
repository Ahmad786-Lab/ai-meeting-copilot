/**
 * agents.js — the multi-agent fan-out & Director.
 *
 * On every completed turn, four agents run IN PARALLEL against the
 * meeting's own isolated store. The Director reads all four results
 * and provides contextual sales talking points and objection battle cards.
 */

import { AGENDA_SLOTS, missingSlots } from "./state.js";
import { llmJson, llmAvailable } from "./llm.js";
import { retrieveKnowledge } from "./knowledge.js";

// ---------------------------------------------------------------
// Layer 1 — Pattern Matching for Live Meeting Events
// ---------------------------------------------------------------

const PATTERNS = [
  {
    event: "price_objection",
    label: "PRICE OBJECTION BATTLE CARD",
    re: /\b(expensive|too much|pricey|costs? too|out of (our )?budget|cheaper|quoted us|lower price|can'?t afford|high price|five thousand|eight thousand)\b/i,
    importance: 0.95
  },
  {
    event: "competitor_mention",
    label: "COMPETITOR COMPARISON",
    re: /\b(another agency|another vendor|competitor|we'?re also (talking|looking)|other quote|someone else quoted|alternative|other firm)\b/i,
    importance: 0.85
  },
  {
    event: "pain_point",
    label: "TALKING POINT: QUANTIFY THE PAIN",
    re: /\b(manually|manual|hours (a|every|per) week|struggle|problem is|pain|frustrat|takes us|waste|inefficien|bottleneck|time consuming|headache)\b/i,
    importance: 0.8
  },
  {
    event: "buying_signal",
    label: "BUYING SIGNAL: CLOSE FOR NEXT STEPS",
    re: /\b(how (soon|quickly) can|when could we start|what'?s the next step|send (us|me) (a|the) proposal|sign|get started|onboard|move forward|sounds great|interested)\b/i,
    importance: 0.9
  },
  {
    event: "budget",
    label: "TALKING POINT: VALUE ANCHORING",
    re: /\b(budget|\$\s?\d|\d+k\b|spend|allocated|price range|investment|cost limit)\b/i,
    importance: 0.75
  },
  {
    event: "timeline",
    label: "TALKING POINT: TIMELINE QUALIFICATION",
    re: /\b(by (next|the end)|deadline|timeline|q[1-4]\b|next (month|quarter|week)|asap|end of (the )?(month|year)|launch date)\b/i,
    importance: 0.7
  },
  {
    event: "decision_maker",
    label: "TALKING POINT: STAKEHOLDER MAPPING",
    re: /\b(my (boss|partner|team)|need to (check|ask|run it by)|the board|our cto|ceo|approve|sign ?off|stakeholder|manager)\b/i,
    importance: 0.8
  },
  {
    event: "technical_question",
    label: "TECHNICAL & CAPABILITIES PROMPT",
    re: /\b(have you (worked|done)|do you (have|support|integrate)|can you|what about|experience with|case stud|how does your|tech stack|architecture)\b/i,
    importance: 0.8
  },
  {
    event: "scope_risk",
    label: "SCOPE MANAGEMENT PROMPT",
    re: /\b(also need|while you'?re at it|one more thing|could you also|add(ing)? on|as well as|feature creep)\b/i,
    importance: 0.7
  }
];

function detectPatterns(text) {
  return PATTERNS.filter((p) => p.re.test(text));
}

const COMMITMENT_RE =
  /\b(i'?ll|we'?ll|i will|we will|let me|send (you|me)|i'?m going to|by (monday|tuesday|wednesday|thursday|friday|tomorrow|next week)|follow up|proposal by)\b/i;

// ---------------------------------------------------------------
// Agent 1 — Event Detector
// ---------------------------------------------------------------

async function eventAgent(meeting, speaker, text) {
  const hits = detectPatterns(text);
  if (!hits.length) return { events: [] };

  return {
    events: hits.map((h) => ({
      event: h.event,
      label: h.label,
      importance: h.importance
    }))
  };
}

// ---------------------------------------------------------------
// Agent 2 — Agenda Tracker (Slot Filling)
// ---------------------------------------------------------------

async function agendaAgent(meeting, speaker, text) {
  const open = missingSlots(meeting);
  if (!open.length) return { diff: null };

  const looksRelevant = PATTERNS.some(
    (p) => AGENDA_SLOTS.includes(p.event) && p.re.test(text)
  ) || /\b(problem|goal|want|need|hoping|trying to|budget|timeline|deadline|hours|manual)\b/i.test(text);

  if (!looksRelevant) return { diff: null };

  const diff = {};
  const lower = text.toLowerCase();

  if (open.includes("problem") && (lower.includes("problem") || lower.includes("struggle") || lower.includes("manual") || lower.includes("waste"))) {
    diff.problem = text.slice(0, 100);
  }
  if (open.includes("budget") && (lower.includes("thousand") || lower.includes("$") || lower.includes("budget") || lower.includes("quote"))) {
    diff.budget = text.slice(0, 80);
  }
  if (open.includes("timeline") && (lower.includes("quarter") || lower.includes("month") || lower.includes("week") || lower.includes("soon") || lower.includes("asap"))) {
    diff.timeline = text.slice(0, 80);
  }
  if (open.includes("decision_maker") && (lower.includes("boss") || lower.includes("board") || lower.includes("team") || lower.includes("approve") || lower.includes("cto"))) {
    diff.decision_maker = text.slice(0, 80);
  }

  return { diff: Object.keys(diff).length ? diff : null };
}

// ---------------------------------------------------------------
// Agent 3 — Commitment Extractor
// ---------------------------------------------------------------

async function commitmentAgent(meeting, speaker, text) {
  if (!COMMITMENT_RE.test(text)) return { commitments: [] };

  const match = text.match(/by\s+(monday|tuesday|wednesday|thursday|friday|tomorrow|next week)/i);
  const due = match ? match[1] : null;

  return {
    commitments: [
      {
        owner: speaker,
        action: text.slice(0, 90),
        due
      }
    ]
  };
}

// ---------------------------------------------------------------
// Agent 4 — Knowledge Retriever
// ---------------------------------------------------------------

async function knowledgeAgent(meeting, speaker, text) {
  const knowledge = await retrieveKnowledge(text);
  return { knowledge };
}

// ---------------------------------------------------------------
// The Director — Surfaces Talking Points & Battle Cards
// ---------------------------------------------------------------

const COOLDOWN_MS = 2500; // 2.5s pacing
const MAX_CUES = 25;

async function director(meeting, speaker, text, results) {
  const { events, knowledge } = results;
  const now = Date.now();

  if (meeting.cue_count >= MAX_CUES) return null;

  // 1. Knowledge match (case study, pricing, team structure) always takes priority
  if (knowledge) {
    meeting.last_cue_at = now;
    meeting.cue_count += 1;
    return {
      label: knowledge.label,
      bullets: knowledge.bullets,
      source: "knowledge",
      event: "knowledge_retrieval",
      urgent: true
    };
  }

  // 2. High-priority conversation events (objections, buying signals, pain points)
  if (events && events.length > 0) {
    const top = events.sort((a, b) => b.importance - a.importance)[0];
    const urgent = top.importance >= 0.85;

    if (!urgent && now - meeting.last_cue_at < COOLDOWN_MS) {
      return null;
    }

    const bullets = fallbackBullets(top.event);

    meeting.last_cue_at = now;
    meeting.cue_count += 1;

    return {
      label: top.label,
      bullets: bullets.slice(0, 2),
      source: "event_detector",
      event: top.event,
      urgent
    };
  }

  // 3. Proactive Talking Points for YOU (driving the agenda forward)
  if (speaker === "YOU" && now - meeting.last_cue_at >= COOLDOWN_MS) {
    const missing = missingSlots(meeting);
    if (missing.length > 0) {
      const nextSlot = missing[0];
      const slotTalkingPoints = {
        problem: {
          label: "TALKING POINT: UNCOVER WORKFLOW PAIN",
          bullets: ["Ask what part of the workflow is slowest", "Ask how many hours per week are lost"]
        },
        impact: {
          label: "TALKING POINT: QUANTIFY BUSINESS IMPACT",
          bullets: ["Ask what happens if this isn't solved", "Anchor cost against ongoing manual hours"]
        },
        timeline: {
          label: "TALKING POINT: QUALIFY DEADLINE",
          bullets: ["Ask what date or event drives this", "Confirm target kickoff date"]
        },
        budget: {
          label: "TALKING POINT: ALIGN ON BUDGET",
          bullets: ["Ask what range was approved for this", "Anchor value before discussing numbers"]
        },
        decision_maker: {
          label: "TALKING POINT: MAP KEY STAKEHOLDERS",
          bullets: ["Ask who else evaluates proposals", "Offer to present directly to their team"]
        },
        next_step: {
          label: "TALKING POINT: SECURE NEXT MEETING",
          bullets: ["Propose a 30-min review this Thursday", "Confirm specific scope for proposal"]
        }
      };

      if (slotTalkingPoints[nextSlot]) {
        meeting.last_cue_at = now;
        meeting.cue_count += 1;
        return {
          ...slotTalkingPoints[nextSlot],
          source: "agenda_copilot",
          event: "proactive_talking_point",
          urgent: false
        };
      }
    }
  }

  return null;
}

// Battle card talk tracks
function fallbackBullets(event) {
  const map = {
    price_objection: [
      "Acknowledge: 'Understand completely, let's look at scope.'",
      "Ask: 'What specific capabilities were included in that quote?'"
    ],
    competitor_mention: [
      "Ask what capabilities stood out to them most",
      "Differentiate on senior engineering pod & speed to production"
    ],
    pain_point: [
      "Ask how many team hours are lost every week",
      "Calculate monthly cost of that manual bottleneck"
    ],
    buying_signal: [
      "Confirm a specific date: 'Let's review Thursday at 2 PM.'",
      "Ask who else on the team should join the review"
    ],
    budget: [
      "Ask what price range they have allocated for this",
      "Anchor against the cost of doing nothing for another quarter"
    ],
    timeline: [
      "Ask what business milestone is driving that deadline",
      "Highlight: We kickoff within 10 business days"
    ],
    decision_maker: [
      "Ask who gives final commercial approval",
      "Offer to send an executive summary deck for their boss"
    ],
    technical_question: [
      "Cite relevant production milestone (e.g. MedFlow in 4 wks)",
      "Offer to share technical architecture breakdown"
    ],
    scope_risk: [
      "Clarify what is included in core Phase 1 sprint",
      "Offer to price add-on features in secondary milestone"
    ]
  };
  return map[event] || ["Ask an open follow-up question to probe deeper"];
}

// ---------------------------------------------------------------
// Fan-Out Entrypoint
// ---------------------------------------------------------------

export async function processTurn(meeting, speaker, text, turnIndex) {
  const t0 = Date.now();

  const [ev, ag, cm, kn] = await Promise.all([
    eventAgent(meeting, speaker, text),
    agendaAgent(meeting, speaker, text),
    commitmentAgent(meeting, speaker, text),
    knowledgeAgent(meeting, speaker, text)
  ]);

  const results = {
    events: ev.events,
    diff: ag.diff,
    commitments: cm.commitments,
    knowledge: kn.knowledge
  };

  const cue = await director(meeting, speaker, text, results);

  return {
    ...results,
    cue,
    latency_ms: Date.now() - t0,
    turnIndex
  };
}
