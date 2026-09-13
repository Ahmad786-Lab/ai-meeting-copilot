# Meeting Intelligence Server

The AI layer. The Chrome extension POSTs each completed speech turn here;
four agents run in parallel and a Director decides whether to interrupt.

## Run it

```bash
cd copilot-server
npm install
node server.js
```

You should see `Copilot server on http://localhost:3000`.

**It works with no API key.** Pattern matching handles event detection,
slot filling and commitment extraction. Set `ANTHROPIC_API_KEY` to get
context-aware bullets and the post-meeting analysis:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
node server.js
```

## Test without a meeting

```bash
node test-call.js
```

Replays a scripted discovery call and prints every cue that fires.

## Architecture

```
completed turn
      |
      v
  4 agents IN PARALLEL   (each reads the meeting's own isolated store)
      |
      +-- Event Detector       objection / pain / buying signal / competitor
      +-- Agenda Tracker       fills the six discovery slots
      +-- Commitment Extractor "send proposal Tuesday"
      +-- Knowledge Retriever  case studies, pricing, FAQ
      |
      v
  Director        is this worth the user's attention right now?
      |
      v
   0 or 1 cue  ->  HUD
```

### Why the Director matters

Suppression is the feature. It holds a cooldown, a per-meeting cue cap,
and an importance threshold. Price objections and buying signals override
the cooldown; everything else waits. Knowledge retrieval bypasses it
entirely, because answering a direct question is never an interruption.

### Why every meeting gets its own store

Four agents write concurrently during a live call. A shared database
across meetings means lock contention and cross-client contamination.
Isolation per meeting is what makes the concurrency safe.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| POST | `/turn` | The hot path. `{meetingId, speaker, text}` → `{cue, agenda, commitments}` |
| POST | `/time-check` | `{meetingId, minutesRemaining}` → agenda-gap cue |
| GET | `/state/:meetingId` | Full Meeting State. Useful to show on stage. |
| POST | `/end` | Post-meeting summary, scores, follow-up email |
| GET | `/health` | Check whether the LLM is wired up |

## Customise before demoing

`knowledge.js` holds the case studies and pricing the copilot surfaces
mid-call. Edit `KNOWLEDGE` to match your story. Keep bullets under seven
words — they have to be readable at a glance.

`agents.js` holds the detection patterns and the fallback bullets. The
fallbacks are what render when the model is slow, so make them good.
