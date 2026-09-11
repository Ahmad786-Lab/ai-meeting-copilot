/**
 * test-call.js — replays a fake discovery call against the server so you
 * can see cues fire without needing a real meeting.
 *
 *   node test-call.js
 */

const URL = process.env.SERVER || "http://localhost:3000";
const MEETING = "test-" + Date.now();

const CALL = [
  ["YOU", "Thanks for making the time today. What is currently causing the biggest problem for your team?"],
  ["CLIENT", "We spend about twenty hours every week doing this manually and it's killing us."],
  ["YOU", "That sounds painful. Walk me through what that process looks like."],
  ["CLIENT", "We manually process around two hundred requests every week across three people."],
  ["YOU", "Got it. What would success look like six months from now?"],
  ["CLIENT", "Have you worked with healthcare companies before? We're in the patient scheduling space."],
  ["YOU", "We have, quite a bit actually."],
  ["CLIENT", "Honestly, eight thousand dollars sounds expensive. Another agency quoted us five thousand."],
  ["YOU", "I understand. Let me ask what that five thousand dollar proposal includes."],
  ["CLIENT", "I'd need to check with my boss before we sign anything, he approves the budget."],
  ["CLIENT", "How soon can you start if we move forward? We need this done by end of quarter."],
  ["YOU", "I'll send you the proposal Tuesday and we can review it together Thursday."]
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function run() {
  console.log(`\n  Replaying a discovery call against ${URL}\n`);

  for (const [speaker, text] of CALL) {
    const res = await fetch(URL + "/turn", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ meetingId: MEETING, speaker, text })
    });
    const data = await res.json();

    console.log(`  ${speaker}: ${text}`);
    if (data.cue) {
      console.log(`\n     ┌─ ${data.cue.label}`);
      for (const b of data.cue.bullets) console.log(`     │  • ${b}`);
      console.log(`     └─ ${data.latency_ms}ms via ${data.cue.source}\n`);
    }
    await sleep(1200);
  }

  const end = await fetch(URL + "/end", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ meetingId: MEETING })
  }).then((r) => r.json());

  console.log("\n  ── POST MEETING ──");
  console.log("  Talk ratio:      ", end.talk_ratio);
  console.log("  Agenda coverage: ", end.agenda_coverage);
  console.log("  Problems:        ", end.problems);
  console.log("  Objections:      ", end.objections);
  console.log("  Commitments:     ", JSON.stringify(end.commitments));
  if (end.analysis) {
    console.log("  Summary:         ", end.analysis.summary);
    console.log("  Scores:          ", JSON.stringify(end.analysis.scores, null, 2));
  }
  console.log("");
}

run().catch(console.error);
