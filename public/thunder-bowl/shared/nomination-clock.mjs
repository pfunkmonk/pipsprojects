const STORAGE_KEY = "thunder-bowl-nomination-clock-v1";
const CHANNEL_NAME = "thunder-bowl-nomination-clock";
const channel = typeof window !== "undefined" && typeof BroadcastChannel === "function" ? new BroadcastChannel(CHANNEL_NAME) : null;

export const NOMINATION_CLOCK_DURATION_MS = 120_000;
const MIN_DURATION_MS = 15_000;
const MAX_DURATION_MS = 10 * 60_000;

function validDuration(durationMs) {
  const parsed = Number(durationMs);
  return Number.isFinite(parsed) && parsed >= MIN_DURATION_MS && parsed <= MAX_DURATION_MS
    ? Math.round(parsed / 1000) * 1000
    : NOMINATION_CLOCK_DURATION_MS;
}

function defaultState() {
  return { status: "paused", durationMs: NOMINATION_CLOCK_DURATION_MS, remainingMs: NOMINATION_CLOCK_DURATION_MS, deadline: null, updatedAt: Date.now() };
}

export function clockFromSnapshot(clock, now = Date.now()) {
  if (!clock || !["running", "paused"].includes(clock.status)) return defaultState();
  const durationMs = validDuration(clock.durationMs);
  const baseRemaining = Math.max(0, Math.min(durationMs, Number(clock.remainingMs) || 0));
  const elapsedSinceServer = clock.status === "running" ? Math.max(0, now - Number(clock.serverNow || now)) : 0;
  return {
    status: clock.status,
    durationMs,
    remainingMs: Math.max(0, baseRemaining - elapsedSinceServer),
    deadline: clock.deadline ?? null,
    updatedAt: Number(clock.serverNow) || now,
  };
}

export function readNominationClock(now = Date.now()) {
  let stored;
  try { stored = JSON.parse(globalThis.localStorage?.getItem(STORAGE_KEY) || "null"); } catch { stored = null; }
  const state = stored && ["running", "paused"].includes(stored.status) ? stored : defaultState();
  const durationMs = validDuration(state.durationMs);
  const remainingMs = state.status === "running" ? Math.max(0, Number(state.deadline) - now) : Math.max(0, Number(state.remainingMs) || 0);
  return { ...state, durationMs, remainingMs };
}

function writeClock(state) {
  const next = { ...state, updatedAt: Date.now() };
  try { globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* Clock still works in this tab. */ }
  channel?.postMessage(next);
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("thunder-bowl-nomination-clock", { detail: next }));
  return next;
}

export function startNominationClock() {
  const durationMs = readNominationClock().durationMs;
  return writeClock({ status: "running", durationMs, remainingMs: durationMs, deadline: Date.now() + durationMs });
}

export function pauseNominationClock() {
  const current = readNominationClock();
  return writeClock({ status: "paused", durationMs: current.durationMs, remainingMs: current.remainingMs, deadline: null });
}

export function resumeNominationClock() {
  const current = readNominationClock();
  const remainingMs = current.remainingMs > 0 ? current.remainingMs : current.durationMs;
  return writeClock({ status: "running", durationMs: current.durationMs, remainingMs, deadline: Date.now() + remainingMs });
}

export function resetNominationClock() {
  const durationMs = readNominationClock().durationMs;
  return writeClock({ status: "paused", durationMs, remainingMs: durationMs, deadline: null });
}

export function setNominationClockDuration(durationMs) {
  const current = readNominationClock();
  const nextDurationMs = validDuration(durationMs);
  return writeClock(current.status === "running"
    ? { status: "running", durationMs: nextDurationMs, remainingMs: nextDurationMs, deadline: Date.now() + nextDurationMs }
    : { status: "paused", durationMs: nextDurationMs, remainingMs: nextDurationMs, deadline: null });
}

export function formatNominationClock(remainingMs) {
  const totalSeconds = Math.max(0, Math.ceil(Number(remainingMs) / 1000));
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, "0")}`;
}

export function subscribeNominationClock(callback) {
  if (typeof window === "undefined") return () => {};
  const onChannel = () => callback(readNominationClock());
  const onStorage = (event) => { if (event.key === STORAGE_KEY) callback(readNominationClock()); };
  const onCustom = () => callback(readNominationClock());
  channel?.addEventListener("message", onChannel);
  window.addEventListener("storage", onStorage);
  window.addEventListener("thunder-bowl-nomination-clock", onCustom);
  return () => {
    channel?.removeEventListener("message", onChannel);
    window.removeEventListener("storage", onStorage);
    window.removeEventListener("thunder-bowl-nomination-clock", onCustom);
  };
}
