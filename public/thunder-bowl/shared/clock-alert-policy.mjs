export function nextClockAlert(state, previous = { second: null, buzzed: false }) {
  const second = Math.max(0, Math.ceil(Number(state?.remainingMs) / 1000));
  if (second > 10) return { alert: null, tracker: { second: null, buzzed: false } };
  if (state?.status !== "running") return { alert: null, tracker: previous };
  if (second === 0) {
    if (previous.buzzed) return { alert: null, tracker: previous };
    return { alert: "buzzer", tracker: { second: 0, buzzed: true } };
  }
  if (second === previous.second) return { alert: null, tracker: previous };
  return { alert: "tick", tracker: { second, buzzed: false } };
}
