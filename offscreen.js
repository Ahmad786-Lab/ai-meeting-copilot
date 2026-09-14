/* offscreen.js — Captures Google Meet tab audio and streams to backend STT */

let mediaStream = null;
let scriptNode = null;
let sourceNode = null;
let socket = null;
let audioContext = null;
let isCapturing = false;

function report(type, payload) {
  chrome.runtime.sendMessage(Object.assign({ type }, payload || {}));
}

function convertFloat32ToInt16(float32Array) {
  const l = float32Array.length;
  const int16Array = new Int16Array(l);
  for (let i = 0; i < l; i++) {
    let s = Math.max(-1, Math.min(1, float32Array[i]));
    int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return int16Array;
}

function openBackendSocket() {
  return new Promise((resolve, reject) => {
    const wsUrl = "ws://localhost:3000/transcribe?role=client";
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      console.log("[offscreen] connected to backend transcribe for CLIENT audio");
      resolve(ws);
    };

    ws.onerror = (err) => {
      console.error("[offscreen] WebSocket connection failed:", err);
      reject(new Error("Backend transcribe connection failed (client audio)."));
    };

    ws.onclose = () => {
      console.warn("[offscreen] WebSocket closed");
      socket = null;
      if (isCapturing && mediaStream && mediaStream.active) {
        console.log("[offscreen] auto-reconnecting client audio socket in 1.5s...");
        setTimeout(() => {
          if (isCapturing) {
            openBackendSocket().then((newWs) => { socket = newWs; }).catch(() => {});
          }
        }, 1500);
      }
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "Results") {
          const text = (data.text || "").trim();
          if (!text) return;
          report("CLIENT_TRANSCRIPT", {
            text,
            isFinal: Boolean(data.is_final)
          });
        }
      } catch (e) {
        console.warn("[offscreen] error parsing transcript:", e);
      }
    };
  });
}

async function startCapture(streamId) {
  await stopCapture();
  isCapturing = true;

  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: "tab",
          chromeMediaSourceId: streamId,
        },
      },
      video: false,
    });

    // 1. AudioContext setup: routes audio back to speakers so user can hear the meeting
    audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
    if (audioContext.state === "suspended") {
      try { await audioContext.resume(); } catch (e) {}
    }

    sourceNode = audioContext.createMediaStreamSource(mediaStream);
    // Crucial: Route tab audio back to user's headphones/speakers!
    sourceNode.connect(audioContext.destination);

    // 2. Open backend WebSocket with role=client
    socket = await openBackendSocket();

    // 3. Audio processor to stream 16-bit linear PCM to backend
    scriptNode = audioContext.createScriptProcessor(4096, 1, 1);
    scriptNode.onaudioprocess = (e) => {
      if (!isCapturing || !socket || socket.readyState !== WebSocket.OPEN) return;
      const inputData = e.inputBuffer.getChannelData(0);
      const pcm16 = convertFloat32ToInt16(inputData);
      socket.send(pcm16.buffer);
    };

    sourceNode.connect(scriptNode);
    scriptNode.connect(audioContext.destination);

    report("OFFSCREEN_CAPTURE_READY");
  } catch (err) {
    console.error("[offscreen] startCapture failed:", err);
    report("OFFSCREEN_ERROR", { error: err.message });
    await stopCapture();
  }
}

async function stopCapture() {
  isCapturing = false;

  if (scriptNode) {
    try { scriptNode.disconnect(); } catch (e) {}
    scriptNode = null;
  }

  if (sourceNode) {
    try { sourceNode.disconnect(); } catch (e) {}
    sourceNode = null;
  }

  if (socket) {
    try {
      socket.send(JSON.stringify({ type: "CloseStream" }));
      socket.close();
    } catch (e) {}
    socket = null;
  }

  if (mediaStream) {
    try {
      mediaStream.getTracks().forEach((t) => t.stop());
    } catch (e) {}
    mediaStream = null;
  }

  if (audioContext) {
    try {
      await audioContext.close();
    } catch (e) {}
    audioContext = null;
  }
}

chrome.runtime.onMessage.addListener((message) => {
  if (!message || message.target !== "offscreen") return;

  if (message.type === "START_TAB_CAPTURE") {
    startCapture(message.streamId).catch((err) => {
      report("OFFSCREEN_ERROR", { error: err.message });
    });
  }

  if (message.type === "STOP_TAB_CAPTURE") {
    stopCapture().catch(() => {});
  }
});
