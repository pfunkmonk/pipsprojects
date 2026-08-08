const APP_MODE = new URLSearchParams(window.location.search).get("mode");
const REPLAY_2025 = APP_MODE === "2025-replay";
const PRACTICE_AUCTION = APP_MODE === "practice-auction";
const DATABASE_NAME = REPLAY_2025
  ? "thunder-bowl-2025-replay"
  : PRACTICE_AUCTION
    ? "thunder-bowl-2026-practice"
    : "thunder-bowl-2026";
const DATABASE_VERSION = 1;
const META_STORE = "meta";
const EVENT_STORE = "events";

let databasePromise;

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result), { once: true });
    request.addEventListener("error", () => reject(request.error || new Error("IndexedDB request failed.")), { once: true });
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.addEventListener("complete", () => resolve(), { once: true });
    transaction.addEventListener("abort", () => reject(transaction.error || new Error("IndexedDB transaction was aborted.")), { once: true });
    transaction.addEventListener("error", () => reject(transaction.error || new Error("IndexedDB transaction failed.")), { once: true });
  });
}

export function openDatabase() {
  if (databasePromise) return databasePromise;
  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.addEventListener("upgradeneeded", () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(META_STORE)) database.createObjectStore(META_STORE, { keyPath: "key" });
      if (!database.objectStoreNames.contains(EVENT_STORE)) {
        const store = database.createObjectStore(EVENT_STORE, { keyPath: "id" });
        store.createIndex("order", "order", { unique: true });
      }
    });
    request.addEventListener("success", () => resolve(request.result), { once: true });
    request.addEventListener("error", () => reject(request.error || new Error("Could not open local draft storage.")), { once: true });
    request.addEventListener("blocked", () => reject(new Error("Local draft storage is blocked by another older app tab.")), { once: true });
  });
  return databasePromise;
}

export async function getMeta(key, fallback = null) {
  const database = await openDatabase();
  const transaction = database.transaction(META_STORE, "readonly");
  const done = transactionDone(transaction);
  const record = await requestResult(transaction.objectStore(META_STORE).get(key));
  await done;
  return record ? record.value : fallback;
}

export async function setMeta(key, value) {
  const database = await openDatabase();
  const transaction = database.transaction(META_STORE, "readwrite");
  const done = transactionDone(transaction);
  transaction.objectStore(META_STORE).put({ key, value });
  await done;
}

export async function getOrCreateDeviceId() {
  const existing = await getMeta("deviceId");
  if (existing) return existing;
  const id = `device-${crypto.randomUUID()}`;
  await setMeta("deviceId", id);
  return id;
}

export async function readEvents() {
  const database = await openDatabase();
  const transaction = database.transaction(EVENT_STORE, "readonly");
  const done = transactionDone(transaction);
  const records = await requestResult(transaction.objectStore(EVENT_STORE).getAll());
  await done;
  return records.sort((left, right) => left.order - right.order).map((record) => record.event);
}

export async function replaceEvents(events) {
  const database = await openDatabase();
  const transaction = database.transaction(EVENT_STORE, "readwrite");
  const done = transactionDone(transaction);
  const store = transaction.objectStore(EVENT_STORE);
  store.clear();
  events.forEach((event, order) => store.put({ id: event.id, order, event }));
  await done;
}

export async function appendEvents(events) {
  if (!events.length) return;
  const current = await readEvents();
  const byId = new Set(current.map((event) => event.id));
  const combined = [...current];
  for (const event of events) {
    if (!byId.has(event.id)) {
      combined.push(event);
      byId.add(event.id);
    }
  }
  await replaceEvents(combined);
}

function bytesToBase64(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function deriveOfflineHash(code, salt, iterations) {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey("raw", encoder.encode(code), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    keyMaterial,
    256,
  );
  return new Uint8Array(bits);
}

export async function saveOfflineVerifier(code) {
  const iterations = 150000;
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await deriveOfflineHash(code, salt, iterations);
  await setMeta("offlineVerifier", {
    version: 1,
    iterations,
    salt: bytesToBase64(salt),
    hash: bytesToBase64(hash),
    verifiedAt: new Date().toISOString(),
  });
}

export async function hasOfflineVerifier() {
  return Boolean(await getMeta("offlineVerifier"));
}

export async function verifyOfflineCode(code) {
  const verifier = await getMeta("offlineVerifier");
  if (!verifier || verifier.version !== 1) return false;
  const expected = base64ToBytes(verifier.hash);
  const actual = await deriveOfflineHash(code, base64ToBytes(verifier.salt), verifier.iterations);
  if (actual.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < actual.length; index += 1) difference |= actual[index] ^ expected[index];
  return difference === 0;
}

export async function registerOfflineShell() {
  if (!("serviceWorker" in navigator)) return null;
  return navigator.serviceWorker.register("./service-worker.js", { scope: "./" });
}
