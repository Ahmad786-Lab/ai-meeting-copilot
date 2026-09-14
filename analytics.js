/**
 * analytics.js — Telemetry & Usage Tracking Client
 *
 * Tracks user engagement: cue cards shown, cue cards dismissed,
 * objections detected, call duration, and talk time ratios.
 * Batches events and posts to the backend analytics ingestion endpoint.
 */

window.CopilotAnalytics = (() => {
  const ENDPOINT = "http://localhost:3000/api/events";
  let eventQueue = [];
  let flushTimer = null;
  const userId = "rep_" + (Math.abs(navigator.userAgent.split("").reduce((a, b) => ((a << 5) - a) + b.charCodeAt(0), 0)) % 10000);

  function trackEvent(eventType, metadata = {}) {
    const event = {
      timestamp: Math.floor(Date.now() / 1000),
      user_id: userId,
      company_id: "default_org",
      event_type: eventType,
      metadata
    };

    eventQueue.push(event);

    if (!flushTimer) {
      flushTimer = setTimeout(flushEvents, 3000);
    }
  }

  async function flushEvents() {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }

    if (!eventQueue.length) return;

    const batch = eventQueue.slice();
    eventQueue = [];

    try {
      await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ events: batch }),
        signal: AbortSignal.timeout(3000)
      });
    } catch (e) {
      // Re-queue on network failure
      eventQueue.push(...batch);
    }
  }

  window.addEventListener("beforeunload", () => {
    if (eventQueue.length > 0 && navigator.sendBeacon) {
      navigator.sendBeacon(ENDPOINT, JSON.stringify({ events: eventQueue }));
    }
  });

  return {
    trackEvent,
    flushEvents
  };
})();
