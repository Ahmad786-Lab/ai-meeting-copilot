/**
 * server.js — Meeting Intelligence, Diarization STT, Rules Engine 2.0 & Salesforce Relay
 *
 * Architecture:
 *  - WebSocket /transcribe: Direct backend bridge to Deepgram STT (nova-2 diarization)
 *  - Rate Limiting: Max 2 concurrent transcription streams per IP
 *  - Audit Logging: Logs every transcription session (timestamp, IP, duration)
 *  - Rules Engine 2.0 API:
 *      * GET /api/playbooks: Retrieve active objection playbooks
 *      * POST /api/playbooks: Create or update objection rules
 *      * POST /api/playbooks/upload: Ingest playbook CSV (Trigger,Playbook,Priority,Action)
 *  - Telemetry API:
 *      * POST /api/events: Ingest client analytics (cues shown/dismissed, call stats)
 *  - Salesforce CRM Integration:
 *      * POST /sync-to-salesforce: Relay call notes into Salesforce Tasks
 *  - POST /turn: Runs agents in parallel, returning priority-rated cues (URGENT/CONTEXTUAL/FYI)
 *  - POST /end: Generates clean post-call summary
 */

import http from "node:http";
import { WebSocketServer, WebSocket } from "ws";

import { getMeeting, addTurn, applyDiff, missingSlots, talkRatio, resetMeeting, AGENDA_SLOTS } from "./state.js";
import { processTurn, getActivePlaybooks, savePlaybooks, loadPlaybooks } from "./agents.js";
import { llmText, llmAvailable } from "./llm.js";
import { KNOWLEDGE } from "./knowledge.js";

const PORT = process.env.PORT || 3000;
const HOST = "0.0.0.0";
const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY || "1951c128682faca7eae8f43605be44a5ca809e54";

// Rate limiting map: ip -> active connection count (max 2)
const activeStreamsByIp = new Map();
const MAX_CONCURRENT_STREAMS = 2;

// In-memory telemetry events buffer
const telemetryEvents = [];
const MAX_STORED_EVENTS = 5000;

function sendJson(res, statusCode, data) {
  const body = JSON.stringify(data);
  res.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization"
  });
  res.end(body);
}

function agendaView(meeting) {
  return AGENDA_SLOTS.map((slot) => ({
    slot,
    done: Boolean(meeting.slots[slot].value),
    value: meeting.slots[slot].value
  }));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        // Fallback for raw text/csv
        resolve({ rawText: raw });
      }
    });
    req.on("error", reject);
  });
}

function parsePlaybookCsv(csvText) {
  const lines = csvText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 1) return [];

  const startIndex = lines[0].toLowerCase().includes("trigger") ? 1 : 0;
  const results = [];

  for (let i = startIndex; i < lines.length; i++) {
    const line = lines[i];
    const regex = /(?:^|,)(\"(?:[^\"]+|\"\")*\"|[^,]*)/g;
    const tokens = [];
    let m;

    while ((m = regex.exec(line)) !== null) {
      let val = m[1] || "";
      if (val.startsWith('"') && val.endsWith('"')) {
        val = val.slice(1, -1).replace(/""/g, '"');
      }
      tokens.push(val.trim());
      if (regex.lastIndex === line.length) break;
    }

    if (tokens.length >= 2 && tokens[0]) {
      const trigger = tokens[0];
      const name = tokens[1] || "CUSTOM OBJECTION";
      const priorityRaw = (tokens[2] || "CONTEXTUAL").toUpperCase();
      const priority = ["URGENT", "CONTEXTUAL", "FYI"].includes(priorityRaw) ? priorityRaw : "CONTEXTUAL";
      const actions = tokens[3]
        ? tokens[3].split(/[;|]/).map((a) => a.trim()).filter(Boolean)
        : ["Address client concern directly"];

      const id =
        "pb-" +
        name.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 24) +
        "-" +
        Math.random().toString(36).slice(2, 6);

      results.push({
        id,
        trigger,
        name,
        priority,
        actions,
        active: true
      });
    }
  }

  return results;
}

// ---------------------------------------------------------------
// HTTP Request Router
// ---------------------------------------------------------------

const server = http.createServer(async (req, res) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization"
    });
    return res.end();
  }

  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const pathname = url.pathname;

  try {
    // GET /health — lightweight liveness probe
    if (req.method === "GET" && pathname === "/health") {
      return sendJson(res, 200, {
        ok: true,
        deepgram_configured: Boolean(DEEPGRAM_API_KEY),
        llm: llmAvailable ? "connected" : "rules-only (no ANTHROPIC_API_KEY)",
        knowledge_items: KNOWLEDGE.length,
        playbooks_count: getActivePlaybooks().length,
        telemetry_events_count: telemetryEvents.length
      });
    }

    // POST /demo-reset
    if (req.method === "POST" && pathname === "/demo-reset") {
      const body = await readBody(req);
      const { meetingId } = body || {};
      resetMeeting(meetingId);
      console.log(`[demo-reset] meeting reset: ${meetingId || "ALL"}`);
      return sendJson(res, 200, { ok: true, reset: meetingId || "all" });
    }

    // -------------------------------------------------------------
    // Dynamic Objection Playbook Endpoints (Rules Engine 2.0)
    // -------------------------------------------------------------

    // GET /api/playbooks — List all dynamic playbooks
    if (req.method === "GET" && pathname === "/api/playbooks") {
      const list = getActivePlaybooks().map(({ compiledRegex, ...pb }) => pb);
      return sendJson(res, 200, { ok: true, playbooks: list });
    }

    // POST /api/playbooks — Add or update playbooks
    if (req.method === "POST" && pathname === "/api/playbooks") {
      const body = await readBody(req);
      const current = getActivePlaybooks();

      if (Array.isArray(body.playbooks)) {
        savePlaybooks(body.playbooks);
        return sendJson(res, 200, { ok: true, message: "Playbooks saved", count: body.playbooks.length });
      }

      if (body.trigger && body.name) {
        const id = body.id || "pb-" + Date.now().toString(36);
        const updated = current.filter((p) => p.id !== id);
        updated.push({
          id,
          trigger: body.trigger,
          name: body.name,
          priority: body.priority || "CONTEXTUAL",
          actions: Array.isArray(body.actions) ? body.actions : [body.actions || "Acknowledge client concern"],
          active: body.active !== false
        });
        savePlaybooks(updated);
        return sendJson(res, 200, { ok: true, playbook: id });
      }

      return sendJson(res, 400, { error: "Invalid playbook payload. Expected { playbooks: [...] } or { trigger, name }" });
    }

    // POST /api/playbooks/upload — Bulk CSV upload
    if (req.method === "POST" && pathname === "/api/playbooks/upload") {
      const body = await readBody(req);
      const csvContent = body.csv || body.rawText;

      if (!csvContent) {
        return sendJson(res, 400, { error: "No CSV content provided. Expected { csv: '...' } or text/csv body." });
      }

      const parsed = parsePlaybookCsv(csvContent);
      if (!parsed.length) {
        return sendJson(res, 400, { error: "No valid playbook rows parsed. CSV format: Trigger,Playbook,Priority,Action" });
      }

      const current = getActivePlaybooks();
      const existingIds = new Set(parsed.map((p) => p.id));
      const merged = current.filter((p) => !existingIds.has(p.id)).concat(parsed);
      savePlaybooks(merged);

      console.log(`[playbooks] CSV imported ${parsed.length} rules. Total now: ${merged.length}`);
      return sendJson(res, 200, {
        ok: true,
        imported_count: parsed.length,
        total_playbooks: merged.length,
        playbooks: parsed
      });
    }

    // -------------------------------------------------------------
    // Telemetry & Analytics Ingestion
    // -------------------------------------------------------------

    // POST /api/events — High-throughput telemetry batch ingestion
    if (req.method === "POST" && pathname === "/api/events") {
      const body = await readBody(req);
      const events = Array.isArray(body.events) ? body.events : (body.event ? [body] : []);

      for (const ev of events) {
        telemetryEvents.push({
          ...ev,
          received_at: new Date().toISOString()
        });
        if (telemetryEvents.length > MAX_STORED_EVENTS) {
          telemetryEvents.shift();
        }
      }

      if (events.length > 0) {
        const types = events.map((e) => e.event_type).join(", ");
        console.log(`[analytics] ingested ${events.length} event(s): [${types}]`);
      }

      return sendJson(res, 200, { ok: true, received: events.length });
    }

    // -------------------------------------------------------------
    // Salesforce CRM Relay Proxy
    // -------------------------------------------------------------

    // POST /sync-to-salesforce — Secure proxy to Salesforce REST API Task creation
    if (req.method === "POST" && pathname === "/sync-to-salesforce") {
      const body = await readBody(req);
      const { oppId, subject, description, accessToken, instanceUrl } = body || {};

      // Handle Mock / Sandbox mode
      if (!accessToken || accessToken.startsWith("mock_") || !instanceUrl) {
        const mockTaskId = "00T" + Math.random().toString(36).substring(2, 12).toUpperCase();
        console.log(`[salesforce] mock sync completed for Opp: ${oppId || "MockOpp"} (Task: ${mockTaskId})`);
        return sendJson(res, 200, {
          ok: true,
          taskId: mockTaskId,
          mock: true,
          message: "Saved in Mock Salesforce Mode"
        });
      }

      // Live Salesforce REST API Call
      try {
        const cleanInstance = instanceUrl.replace(/\/+$/, "");
        const taskEndpoint = `${cleanInstance}/services/data/v58.0/sobjects/Task`;

        const sfRes = await fetch(taskEndpoint, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            WhatId: oppId && !oppId.includes("Mock") ? oppId : undefined,
            Subject: subject || "AI Meeting Copilot Discovery Summary",
            Description: description || "",
            Status: "Completed",
            Priority: "Normal",
            ActivityDate: new Date().toISOString().split("T")[0]
          })
        });

        const sfData = await sfRes.json();

        if (sfRes.ok) {
          console.log(`[salesforce] live Task created: ${sfData.id}`);
          return sendJson(res, 200, { ok: true, taskId: sfData.id });
        } else {
          console.warn(`[salesforce] API error from Salesforce:`, sfData);
          return sendJson(res, sfRes.status, {
            ok: false,
            error: sfData[0] ? sfData[0].message : JSON.stringify(sfData)
          });
        }
      } catch (err) {
        console.error(`[salesforce] relay connection failed:`, err);
        return sendJson(res, 500, { ok: false, error: err.message });
      }
    }

    // -------------------------------------------------------------
    // Core Copilot Turn Intelligence & End
    // -------------------------------------------------------------

    // POST /turn — Real-time turn intelligence
    if (req.method === "POST" && pathname === "/turn") {
      const body = await readBody(req);
      const { meetingId, speaker, text } = body || {};

      if (!meetingId || !speaker || !text) {
        return sendJson(res, 400, { error: "meetingId, speaker, and text are required" });
      }

      if (text.trim().split(/\s+/).length < 2) {
        return sendJson(res, 200, { cue: null, skipped: "too short" });
      }

      const meeting = getMeeting(meetingId);
      const turnIndex = addTurn(meeting, speaker, text);

      try {
        const result = await processTurn(meeting, speaker, text, turnIndex);
        applyDiff(meeting, result.diff, turnIndex);

        for (const c of result.commitments) {
          meeting.commitments.push({ ...c, turn: turnIndex });
        }
        for (const e of result.events) {
          meeting.events.push({ ...e, turn: turnIndex, text });
          if (e.event === "price_objection") {
            meeting.objections.push({ text, turn: turnIndex });
          }
        }

        const finalCue = result.cue;

        console.log(
          `[turn ${turnIndex}] ${speaker}: ${text.slice(0, 50)}... ` +
          `priority=${finalCue ? finalCue.priority : "-"} ` +
          `cue=${finalCue ? finalCue.label : "-"} ` +
          `${result.latency_ms}ms`
        );

        return sendJson(res, 200, {
          cue: finalCue,
          agenda: agendaView(meeting),
          commitments: meeting.commitments,
          latency_ms: result.latency_ms
        });
      } catch (err) {
        console.error("[turn] failed:", err);
        return sendJson(res, 200, { cue: null, error: err.message });
      }
    }

    // POST /end — Call Summary
    if (req.method === "POST" && pathname === "/end") {
      const body = await readBody(req);
      const { meetingId } = body || {};
      const meeting = getMeeting(meetingId);

      const transcript = meeting.transcript
        .map((t) => `${t.speaker}: ${t.text}`)
        .join("\n");

      const youRatio = talkRatio(meeting);
      const clientRatio = 100 - youRatio;
      const durationMin = Math.max(1, Math.round((Date.now() - meeting.started_at) / 60000));

      // Key topics aggregation
      const topicsSet = new Set();
      meeting.events.forEach((e) => {
        if (e.event === "price_objection" || e.event === "budget") topicsSet.add("Pricing & Budget");
        if (e.event === "competitor_mention") topicsSet.add("Competitor Comparison");
        if (e.event === "pain_point") topicsSet.add("Workflow Pain Points");
        if (e.event === "buying_signal") topicsSet.add("Buying Signals");
        if (e.event === "timeline") topicsSet.add("Timeline & Delivery");
        if (e.event === "decision_maker") topicsSet.add("Stakeholder Decision");
        if (e.event === "security_compliance") topicsSet.add("Security & Compliance");
      });
      if (!topicsSet.size) topicsSet.add("Discovery & Scope Alignment");

      const keyTopics = Array.from(topicsSet);
      const keyPoints = [];
      if (meeting.client && meeting.client.problems && meeting.client.problems.length) {
        keyPoints.push(...meeting.client.problems);
      }
      if (meeting.commitments && meeting.commitments.length) {
        keyPoints.push(...meeting.commitments.map((c) => `${c.owner}: ${c.action}`));
      }
      if (!keyPoints.length) {
        keyPoints.push("Discussed operational bottlenecks and timeline expectations.");
      }

      const notes =
`CALL SUMMARY (${durationMin} min)
Talk Ratio: Rep ${youRatio}% | Client ${clientRatio}%

Key Topics Discussed:
${keyTopics.map((t) => `• ${t}`).join("\n")}

Action Items & Next Steps:
${keyPoints.map((p) => `• ${p}`).join("\n")}`;

      console.log(`[end] meeting concluded: ${meetingId} (${durationMin} min)`);

      return sendJson(res, 200, {
        meeting_id: meetingId,
        duration_min: durationMin,
        rep_talk_time_pct: youRatio,
        client_talk_time_pct: clientRatio,
        talk_ratio: `Rep ${youRatio}% | Client ${clientRatio}%`,
        key_topics: keyTopics,
        key_points: keyPoints,
        notes,
        transcript
      });
    }

    // 404
    return sendJson(res, 404, { error: "Not found" });
  } catch (err) {
    console.error("[server] error:", err);
    return sendJson(res, 500, { error: err.message });
  }
});

// ---------------------------------------------------------------
// WebSocket Server — Backend-Managed Deepgram STT with Diarization
// ---------------------------------------------------------------

const wss = new WebSocketServer({ server });

wss.on("connection", (clientWs, req) => {
  const clientIp = req.socket.remoteAddress || "127.0.0.1";
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  if (url.pathname !== "/transcribe") {
    clientWs.close(1008, "Invalid endpoint");
    return;
  }

  // 1. Rate Limiting Check
  const currentCount = activeStreamsByIp.get(clientIp) || 0;
  if (currentCount >= MAX_CONCURRENT_STREAMS) {
    console.warn(`[rate-limit] rejected stream for ${clientIp} (exceeds max ${MAX_CONCURRENT_STREAMS})`);
    clientWs.send(JSON.stringify({ type: "Error", message: "Rate limit exceeded: max 2 active streams." }));
    clientWs.close(1008, "Rate limit exceeded");
    return;
  }
  activeStreamsByIp.set(clientIp, currentCount + 1);

  // 2. Audit Log Start
  const sessionId = "sess-" + Date.now() + "-" + Math.random().toString(36).slice(2, 7);
  const startTime = Date.now();
  console.log(`[audit] transcription session started: ${sessionId} IP: ${clientIp} at ${new Date().toISOString()}`);

  if (!DEEPGRAM_API_KEY) {
    clientWs.send(JSON.stringify({ type: "Error", message: "DEEPGRAM_API_KEY not set on server." }));
    clientWs.close(1011, "Missing API Key");
    return;
  }

  let deepgramWs = null;
  let isClosed = false;
  let retryCount = 0;
  const MAX_RETRIES = 3;

  function connectToDeepgram() {
    if (isClosed) return;

    // Single stream with speaker diarization enabled
    const deepgramUrl =
      "wss://api.deepgram.com/v1/listen?model=nova-2&diarize=true&smart_format=true&interim_results=true&encoding=linear16&sample_rate=16000";

    deepgramWs = new WebSocket(deepgramUrl, ["token", DEEPGRAM_API_KEY]);

    deepgramWs.on("open", () => {
      retryCount = 0;
      console.log(`[deepgram] connected for session ${sessionId}`);
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(JSON.stringify({ type: "Ready", sessionId }));
      }
    });

    deepgramWs.on("message", (raw) => {
      if (clientWs.readyState !== WebSocket.OPEN) return;
      try {
        const data = JSON.parse(raw.toString());
        if (data.type === "Results" && data.channel && data.channel.alternatives && data.channel.alternatives[0]) {
          const alt = data.channel.alternatives[0];
          const text = (alt.transcript || "").trim();
          if (!text) return;

          // Speaker Diarization: detect speaker (0 = YOU, 1 = CLIENT)
          let speaker = 0;
          if (alt.words && alt.words.length > 0) {
            const spkrs = alt.words.map((w) => w.speaker).filter((s) => s !== undefined);
            if (spkrs.length > 0) {
              speaker = spkrs[0];
            }
          }

          clientWs.send(JSON.stringify({
            type: "Results",
            speaker,
            text,
            is_final: Boolean(data.is_final)
          }));
        }
      } catch (err) {
        console.warn(`[deepgram parse error]`, err.message);
      }
    });

    deepgramWs.on("error", (err) => {
      console.error(`[deepgram error] ${sessionId}:`, err.message);
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(JSON.stringify({ type: "Error", message: "Deepgram connection error." }));
      }
    });

    deepgramWs.on("close", () => {
      console.log(`[deepgram closed] for session ${sessionId}`);
      if (!isClosed && retryCount < MAX_RETRIES) {
        retryCount++;
        const delay = Math.min(1000 * Math.pow(2, retryCount), 4000);
        console.log(`[deepgram] retrying connection (${retryCount}/${MAX_RETRIES}) in ${delay}ms...`);
        setTimeout(connectToDeepgram, delay);
      }
    });
  }

  connectToDeepgram();

  // Forward client audio chunks to Deepgram
  clientWs.on("message", (audioData) => {
    if (deepgramWs && deepgramWs.readyState === WebSocket.OPEN) {
      deepgramWs.send(audioData);
    }
  });

  clientWs.on("close", () => {
    isClosed = true;
    const durationSec = Math.round((Date.now() - startTime) / 1000);
    console.log(`[audit] session ended: ${sessionId} duration=${durationSec}s IP=${clientIp}`);

    const updated = Math.max(0, (activeStreamsByIp.get(clientIp) || 1) - 1);
    if (updated === 0) activeStreamsByIp.delete(clientIp);
    else activeStreamsByIp.set(clientIp, updated);

    if (deepgramWs) {
      try {
        deepgramWs.send(JSON.stringify({ type: "CloseStream" }));
        deepgramWs.close();
      } catch (e) {}
      deepgramWs = null;
    }
  });
});

// ---------------------------------------------------------------
// Server Startup
// ---------------------------------------------------------------

server.listen(PORT, HOST, () => {
  console.log(`\n  Copilot server on http://localhost:${PORT}`);
  console.log(`  Deepgram STT WebSocket on ws://localhost:${PORT}/transcribe`);
  console.log(`  Dynamic Playbooks: ${getActivePlaybooks().length} rules loaded`);
  console.log(`  LLM: ${llmAvailable ? "connected" : "RULES ONLY - set ANTHROPIC_API_KEY"}`);
  console.log(`  Knowledge items: ${KNOWLEDGE.length}\n`);
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`\n[FATAL] Port ${PORT} is already in use. Run: lsof -nP -iTCP:${PORT} -sTCP:LISTEN\n`);
  } else {
    console.error("\n[FATAL] Server error:", err);
  }
  process.exit(1);
});

process.on("uncaughtException", (err) => {
  console.error("\n[FATAL] Uncaught exception:", err);
});

process.on("unhandledRejection", (reason) => {
  console.error("\n[WARN] Unhandled rejection:", reason);
});
