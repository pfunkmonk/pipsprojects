import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { mergeEventStreams, replayDraft, toPublicSnapshot, validateDraftPack } from "../public/thunder-bowl/state-engine.mjs";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const publicRoot = join(projectRoot, "public");
const pack = validateDraftPack(JSON.parse(await readFile(join(projectRoot, "netlify/functions/_data/draft-pack-2026-provisional.json"), "utf8")));
const port = Number(process.env.THUNDER_QA_PORT || 8899);
const displayToken = "local-qa-display";
let events = [];
let revision = 0;
const generation = 1;

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
};

function json(response, status, value, headers = {}) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers });
  response.end(JSON.stringify(value));
}

async function requestBody(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 5_000_000) throw new Error("Request body too large.");
  }
  return body ? JSON.parse(body) : {};
}

function ledgerPayload() {
  return {
    events,
    generation,
    displayBoardUrl: `http://localhost:${port}/thunder-bowl/board?token=${displayToken}`,
  };
}

async function serveStatic(pathname, response) {
  const route = pathname === "/thunder-bowl/" || pathname === "/thunder-bowl"
    ? "thunder-bowl/index.html"
    : pathname === "/thunder-bowl/board"
      ? "thunder-bowl/public.html"
      : pathname.replace(/^\//, "");
  const normalizedRoute = normalize(route);
  if (normalizedRoute.startsWith("..") || !normalizedRoute.startsWith("thunder-bowl")) {
    json(response, 404, { error: "Not found" });
    return;
  }
  try {
    const content = await readFile(join(publicRoot, normalizedRoute));
    response.writeHead(200, {
      "Content-Type": mimeTypes[extname(normalizedRoute)] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    response.end(content);
  } catch {
    json(response, 404, { error: "Not found" });
  }
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url || "/", `http://localhost:${port}`);
  try {
    if (url.pathname === "/api/thunder-bowl/auth") {
      json(response, 200, {
        authenticated: true,
        displayBoardUrl: `http://localhost:${port}/thunder-bowl/board?token=${displayToken}`,
      });
      return;
    }
    if (url.pathname === "/api/thunder-bowl/pack") {
      if (request.headers["if-none-match"] === `"${pack.packId}"`) {
        response.writeHead(304, { ETag: `"${pack.packId}"` });
        response.end();
      } else {
        json(response, 200, pack, { ETag: `"${pack.packId}"` });
      }
      return;
    }
    if (url.pathname === "/api/thunder-bowl/status") {
      json(response, 503, { error: "Live status intentionally disabled in isolated QA." });
      return;
    }
    if (url.pathname === "/api/thunder-bowl/ledger" && request.method === "GET") {
      json(response, 200, ledgerPayload());
      return;
    }
    if (url.pathname === "/api/thunder-bowl/ledger" && request.method === "POST") {
      const body = await requestBody(request);
      const initialClient = body.generation == null && revision === 0 && events.length === 0;
      if ((!initialClient && body.generation !== generation) || !Array.isArray(body.events)) {
        json(response, 409, { code: "LEDGER_GENERATION_MISMATCH", error: "Isolated QA ledger generation mismatch." });
        return;
      }
      events = mergeEventStreams(events, body.events);
      replayDraft(events);
      revision += 1;
      json(response, 200, ledgerPayload());
      return;
    }
    if (url.pathname === "/api/thunder-bowl/public") {
      if (url.searchParams.get("token") !== displayToken) {
        json(response, 403, { error: "Invalid local QA display token." });
        return;
      }
      const snapshot = toPublicSnapshot(replayDraft(events), { revision: `local-${revision}`, updatedAt: new Date().toISOString() });
      json(response, 200, snapshot, { ETag: `"local-${revision}"` });
      return;
    }
    await serveStatic(url.pathname, response);
  } catch (error) {
    json(response, 400, { error: error?.message || "Local QA request failed." });
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Thunder Bowl isolated QA server: http://localhost:${port}/thunder-bowl/`);
});
