/**
 * agents.js — The Multi-Agent Fan-Out, Director & Rules Engine 2.0
 *
 * On every completed turn, four agents run IN PARALLEL against the
 * meeting's own isolated store. The Director evaluates:
 *  1. Dynamic Objection Playbooks (loaded from playbooks.json / database)
 *  2. Knowledge Retriever (case studies, pricing models)
 *  3. Event Detector (built-in objection & agenda patterns)
 *  4. Agenda Copilot (proactive talking points for YOU)
 *
 * Emits battle cards with explicit priority levels: URGENT, CONTEXTUAL, or FYI.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { AGENDA_SLOTS, missingSlots } from "./state.js";
import { llmJson, llmAvailable } from "./llm.js";
import { retrieveKnowledge } from "./knowledge.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PLAYBOOKS_FILE = path.join(__dirname, "playbooks.json");

// ---------------------------------------------------------------
// Rules Engine 2.0 — Dynamic Objection Playbooks
// ---------------------------------------------------------------

let dynamicPlaybooks = [];

export function loadPlaybooks() {
  try {
    if (fs.existsSync(PLAYBOOKS_FILE)) {
      const raw = fs.readFileSync(PLAYBOOKS_FILE, "utf8");
      const list = JSON.parse(raw);
      dynamicPlaybooks = list.map((item) => {
        let compiledRegex = null;
        try {
          compiledRegex = new RegExp(item.trigger, "i");
        } catch (e) {
          console.warn(`[playbook regex error] for ${item.id}:`, e.message);
        }
        return {
          ...item,
          compiledRegex
        };
      });
      console.log(`[playbooks] loaded ${dynamicPlaybooks.length} dynamic playbooks.`);
    }
  } catch (err) {
    console.warn("[playbooks] failed to load playbooks.json:", err.message);
  }
}

export function getActivePlaybooks() {
  if (!dynamicPlaybooks.length) {
    loadPlaybooks();
  }
  return dynamicPlaybooks;
}

export function savePlaybooks(newList) {
  dynamicPlaybooks = newList.map((item) => {
    let compiledRegex = null;
    try {
      compiledRegex = new RegExp(item.trigger, "i");
    } catch (e) {
      console.warn(`[playbook regex error] for ${item.id}:`, e.message);
    }
    return {
      ...item,
      compiledRegex
    };
  });

  const cleanList = newList.map(({ compiledRegex, ...rest }) => rest);
  fs.writeFileSync(PLAYBOOKS_FILE, JSON.stringify(cleanList, null, 2), "utf8");
  return dynamicPlaybooks;
}

// Initial load
loadPlaybooks();

// ---------------------------------------------------------------
// Layer 1 — Default Pattern Matching for Live Meeting Events
// ---------------------------------------------------------------

const PATTERNS = [
  {
    event: "price_objection",
    label: "PRICE OBJECTION BATTLE CARD",
    priority: "URGENT",
    re: /\b(expensive|too much|pricey|costs? too|out of (our )?budget|cheaper|quoted us|lower price|can'?t afford|high price|five thousand|eight thousand)\b/i,
    importance: 0.95
  },
  {
    event: "competitor_mention",
    label: "COMPETITOR COMPARISON",
    priority: "URGENT",
    re: /\b(another agency|another vendor|competitor|we'?re also (talking|looking)|other quote|someone else quoted|alternative|other firm)\b/i,
    importance: 0.85
  },
  {
    event: "buying_signal",
    label: "BUYING SIGNAL: CLOSE FOR NEXT STEPS",
    priority: "URGENT",
    re: /\b(how (soon|quickly) can|when could we start|what'?s the next step|send (us|me) (a|the) proposal|sign|get started|onboard|move forward|sounds great|interested)\b/i,
    importance: 0.9
  },
  {
    event: "decision_maker",
    label: "TALKING POINT: STAKEHOLDER MAPPING",
    priority: "URGENT",
    re: /\b(my (boss|partner|team)|need to (check|ask|run it by)|the board|our cto|ceo|approve|sign ?off|stakeholder|manager)\b/i,
    importance: 0.85
  },
  {
    event: "pain_point",
    label: "TALKING POINT: QUANTIFY THE PAIN",
    priority: "CONTEXTUAL",
    re: /\b(manually|manual|hours (a|every|per) week|struggle|problem is|pain|frustrat|takes us|waste|inefficien|bottleneck|time consuming|headache)\b/i,
    importance: 0.8
  },
  {
    event: "budget",
    label: "TALKING POINT: VALUE ANCHORING",
    priority: "CONTEXTUAL",
    re: /\b(budget|\$\s?\d|\d+k\b|spend|allocated|price range|investment|cost limit)\b/i,
    importance: 0.75
  },
  {
    event: "timeline",
    label: "TALKING POINT: TIMELINE QUALIFICATION",
    priority: "CONTEXTUAL",
    re: /\b(by (next|the end)|deadline|timeline|q[1-4]\b|next (month|quarter|week)|asap|end of (the )?(month|year)|launch date)\b/i,
    importance: 0.7
  },
  {
    event: "technical_question",
    label: "TECHNICAL & CAPABILITIES PROMPT",
    priority: "CONTEXTUAL",
    re: /\b(have you (worked|done)|do you (have|support|integrate)|can you|what about|experience with|case stud|how does your|tech stack|architecture)\b/i,
    importance: 0.8
  },
  {
    event: "scope_risk",
    label: "SCOPE MANAGEMENT PROMPT",
    priority: "CONTEXTUAL",
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
      priority: h.priority,
      importance: h.importance
    }))
  };
}

// ---------------------------------------------------------------
// Agent 2 — Agenda Tracker (Slot Filling)
// ---------------------------------------------------------------

async function agendaAgent(meeting, speaker, text) {
  const missing = missingSlots(meeting);
  if (!missing.length) return { diff: {} };

  const diff = {};

  if (missing.includes("problem")) {
    const m = text.match(/\b(problem is|struggle with|issue is|bottleneck|waste \w+ hours?|manual \w+)\s+(.{5,80})/i);
    if (m) diff.problem = m[0].trim();
  }

  if (missing.includes("impact")) {
    const m = text.match(/\b(costs? us|losing|waste|spend|takes?)\s+(\$?\d[\d,\.]*\s*(?:hours?|k|dollars?|per week|a month)?)/i);
    if (m) diff.impact = m[0].trim();
  }

  if (missing.includes("timeline")) {
    const m = text.match(/\b(?:by|before|in|target|deadline is)\s+([A-Z][a-z]+|\d{1,2}[\/\-]\d{1,2}|end of (?:month|quarter|year)|asap|next (?:week|month))/i);
    if (m) diff.timeline = m[0].trim();
  }

  if (missing.includes("budget")) {
    const m = text.match(/(?:\$|usd\s*)\s*(\d[\d,\.]*\s*k?)|(\b\d+\s*k\b\s*budget)/i);
    if (m) diff.budget = m[0].trim();
  }

  if (missing.includes("decision_maker")) {
    const m = text.match(/\b(my (?:boss|partner|board|cto|ceo)|we have to (?:decide|approve)|i (?:am the|make the) decision)/i);
    if (m) diff.decision_maker = m[0].trim();
  }

  if (missing.includes("next_step")) {
    const m = text.match(/\b(?:send (?:me|us) (?:a |the )?proposal|meeting on [A-Z][a-z]+|call (?:next week|tomorrow)|review (?:together|with team))/i);
    if (m) diff.next_step = m[0].trim();
  }

  return { diff };
}

// ---------------------------------------------------------------
// Agent 3 — Commitment Extractor
// ---------------------------------------------------------------

async function commitmentAgent(meeting, speaker, text) {
  if (!COMMITMENT_RE.test(text)) return { commitments: [] };

  const sentences = text.split(/[.!?]+/).map((s) => s.trim()).filter(Boolean);
  const hits = sentences.filter((s) => COMMITMENT_RE.test(s));

  if (!hits.length) return { commitments: [] };

  const commitments = hits.map((h) => {
    const dueMatch = h.match(/\bby\s+([A-Za-z]+|\d{1,2}[\/\-]\d{1,2}|tomorrow|next week|end of \w+)/i);
    return {
      owner: speaker,
      action: h.slice(0, 140),
      due: dueMatch ? dueMatch[1] : null
    };
  });

  return { commitments };
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
const MAX_CUES = 35;

async function director(meeting, speaker, text, results) {
  const { events, knowledge } = results;
  const now = Date.now();

  if (meeting.cue_count >= MAX_CUES) return null;

  // 1. Dynamic Objection Playbooks (Rules Engine 2.0)
  const activePbs = getActivePlaybooks().filter((p) => p.active !== false);
  for (const pb of activePbs) {
    if (pb.compiledRegex && pb.compiledRegex.test(text)) {
      const isUrgent = pb.priority === "URGENT";
      if (!isUrgent && now - meeting.last_cue_at < COOLDOWN_MS) {
        continue;
      }
      meeting.last_cue_at = now;
      meeting.cue_count += 1;
      return {
        label: pb.name,
        bullets: (pb.actions || []).slice(0, 2),
        source: "dynamic_playbook",
        event: pb.id,
        priority: pb.priority || "URGENT",
        urgent: isUrgent
      };
    }
  }

  // 2. Knowledge match (case study, pricing model, team pod)
  if (knowledge) {
    meeting.last_cue_at = now;
    meeting.cue_count += 1;
    return {
      label: knowledge.label,
      bullets: knowledge.bullets,
      source: "knowledge",
      event: "knowledge_retrieval",
      priority: "CONTEXTUAL",
      urgent: false
    };
  }

  // 3. Built-in Pattern Events (fallback objections, buying signals)
  if (events && events.length > 0) {
    const top = events.sort((a, b) => b.importance - a.importance)[0];
    const isUrgent = top.priority === "URGENT" || top.importance >= 0.85;

    if (!isUrgent && now - meeting.last_cue_at < COOLDOWN_MS) {
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
      priority: top.priority || (isUrgent ? "URGENT" : "CONTEXTUAL"),
      urgent: isUrgent
    };
  }

  // 4. Proactive Talking Points for YOU (driving agenda forward)
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
          priority: "CONTEXTUAL",
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
