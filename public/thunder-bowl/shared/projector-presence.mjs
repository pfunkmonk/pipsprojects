const STORAGE_KEY = "thunder-bowl-projector-presence-v1";
const CHANNEL_NAME = "thunder-bowl-projector-presence";
const channel = typeof window !== "undefined" && typeof BroadcastChannel === "function" ? new BroadcastChannel(CHANNEL_NAME) : null;

export const PROJECTOR_STALE_AFTER_MS = 5000;

export function readProjectorPresence() {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}

export function writeProjectorPresence(details = {}) {
  const presence = { ...details, lastSeen: Date.now() };
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(presence)); } catch { /* Presence is advisory only. */ }
  channel?.postMessage(presence);
  window.dispatchEvent(new CustomEvent("thunder-bowl-projector-presence", { detail: presence }));
  return presence;
}

export function projectorPresenceIsFresh(presence, now = Date.now()) {
  return Boolean(presence?.lastSeen && now - presence.lastSeen <= PROJECTOR_STALE_AFTER_MS);
}

export function subscribeProjectorPresence(callback) {
  const onChannel = (event) => callback(event.data);
  const onStorage = (event) => { if (event.key === STORAGE_KEY) callback(readProjectorPresence()); };
  const onCustom = (event) => callback(event.detail);
  channel?.addEventListener("message", onChannel);
  window.addEventListener("storage", onStorage);
  window.addEventListener("thunder-bowl-projector-presence", onCustom);
  return () => {
    channel?.removeEventListener("message", onChannel);
    window.removeEventListener("storage", onStorage);
    window.removeEventListener("thunder-bowl-projector-presence", onCustom);
  };
}
