/* offscreen.js — invisible document that captures the meeting tab audio */

let mediaStream = null;
let recorder = null;
let socket = null;
let audioContext = null;
let keepAliveTimer = null;
let isCapturing = false;

function report(type, payload) {
  chrome.runtime.sendMessage(Object.assign({ type }, payload || {}));
}

function startKeepAlive() {
  stopKeepAlive();
  keepAliveTimer = setInterval(() => {
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "KeepAlive" }));
    }
  }, 8000);
}

function stopKeepAlive() {
  if (keepAliveTimer) {
    clearInterval(keepAliveTimer);
    keepAliveTimer = null;
  }
}

function openDeepgram(apiKey) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(aiCopilotDeepgramUrl(), ["token", apiKey]);

    ws.onopen = () => {
      startKeepAlive();
      resolve(ws);
    };

    ws.onerror = () => {
      reject(new Error("Deepgram connection failed (meeting audio)."));
    };

    ws.onclose = () => {
      stopKeepAlive();
      socket = null;
      // Auto-reconnect if we are still supposed to be capturing tab audio
      if (isCapturing && mediaStream && mediaStream.active) {
        console.log("[offscreen] Deepgram socket closed, reconnecting...");
        setTimeout(() => {
          if (isCapturing) {
            openDeepgram(apiKey)
              .then((newWs) => {
                socket = newWs;
              })
              .catch(() => {});
          }
        }, 1000);
      }
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type !== "Results") return;
        const alt = data.channel && data.channel.alternatives[0];
        const text = alt && alt.transcript && alt.transcript.trim();
        if (!text) return;
        report("CLIENT_TRANSCRIPT", { text, isFinal: !!data.is_final });
      } catch (e) {
        /* metadata frame */
      }
    };
  });
}

async function startCapture(streamId) {
  const apiKey = AI_COPILOT_CONFIG.DEEPGRAM_API_KEY;
  if (!apiKey || apiKey === "PASTE_YOUR_DEEPGRAM_KEY_HERE") {
    throw new Error(
      "Add your Deepgram key to config.js, then reload the extension."
    );
  }
  await stopCapture();
  isCapturing = true;

  mediaStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      mandatory: {
        chromeMediaSource: "tab",
        chromeMediaSourceId: streamId,
      },
    },
    video: false,
  });

  // Capturing a tab mutes it for the user — route audio back to speakers.
  audioContext = new AudioContext();
  if (audioContext.state === "suspended") {
    try { await audioContext.resume(); } catch (e) {}
  }
  audioContext
    .createMediaStreamSource(mediaStream)
    .connect(audioContext.destination);

  socket = await openDeepgram(apiKey);

  const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
    ? "audio/webm;codecs=opus"
    : (MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "");

  recorder = mimeType
    ? new MediaRecorder(mediaStream, { mimeType })
    : new MediaRecorder(mediaStream);

  recorder.ondataavailable = (event) => {
    if (event.data.size > 0 && socket && socket.readyState === WebSocket.OPEN) {
      socket.send(event.data);
    }
  };

  recorder.start(250);
  report("OFFSCREEN_CAPTURE_READY");
}

async function stopCapture() {
  isCapturing = false;
  stopKeepAlive();

  if (recorder && recorder.state !== "inactive") recorder.stop();
  recorder = null;

  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: "CloseStream" }));
    socket.close();
  }
  socket = null;

  if (mediaStream) mediaStream.getTracks().forEach((t) => t.stop());
  mediaStream = null;

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
