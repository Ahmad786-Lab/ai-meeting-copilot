/**
 * state.js — the live Meeting State.
 *
 * One object per meeting. Small, auditable, cheap to update.
 * Agents write diffs into it; nobody re-summarises the transcript.
 */

const meetings = new Map();

export const AGENDA_SLOTS = [
  "problem",
  "goals",
  "budget",
  "timeline",
  "decision_maker",
  "next_step"
];

export function getMeeting(meetingId) {
  if (!meetings.has(meetingId)) {
    meetings.set(meetingId, {
      id: meetingId,
      started_at: Date.now(),
      meeting_type: "discovery_call",
      stage: "discovery",

      slots: Object.fromEntries(
        AGENDA_SLOTS.map((s) => [s, { value: null, turn: null }])
      ),

      client: { problems: [], goals: [] },
      objections: [],
      commitments: [],
      events: [],
      transcript: [],

      telemetry: {
        you_words: 0,
        client_words: 0,
        questions_asked: 0,
        turns: 0
      },

      // Director budget
      last_cue_at: 0,
      cue_count: 0
    });
  }
  return meetings.get(meetingId);
}

export function allMeetings() {
  return [...meetings.values()];
}

export function addTurn(meeting, speaker, text) {
  const turnIndex = meeting.transcript.length;
  meeting.transcript.push({ speaker, text, ts: Date.now() });
  meeting.telemetry.turns += 1;

  const words = text.trim().split(/\s+/).length;
  if (speaker === "YOU") {
    meeting.telemetry.you_words += words;
    if (text.includes("?")) meeting.telemetry.questions_asked += 1;
  } else {
    meeting.telemetry.client_words += words;
  }

  return turnIndex;
}

export function applyDiff(meeting, diff, turnIndex) {
  if (!diff) return;

  for (const slot of AGENDA_SLOTS) {
    const incoming = diff[slot];
    if (incoming && !meeting.slots[slot].value) {
      meeting.slots[slot] = { value: incoming, turn: turnIndex };
    }
  }

  if (diff.problem) {
    if (!meeting.client.problems.includes(diff.problem)) {
      meeting.client.problems.push(diff.problem);
    }
  }
  if (diff.goals && !meeting.client.goals.includes(diff.goals)) {
    meeting.client.goals.push(diff.goals);
  }
}

export function missingSlots(meeting) {
  return AGENDA_SLOTS.filter((s) => !meeting.slots[s].value);
}

export function talkRatio(meeting) {
  const t = meeting.telemetry;
  const total = t.you_words + t.client_words;
  if (!total) return 0;
  return Math.round((t.you_words / total) * 100);
}

export function resetMeeting(meetingId) {
  if (meetingId) {
    meetings.delete(meetingId);
  } else {
    meetings.clear();
  }
}

