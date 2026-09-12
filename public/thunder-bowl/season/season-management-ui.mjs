const el = (tag, text = "", className = "") => { const n = document.createElement(tag); n.textContent = text; if (className) n.className = className; return n; };
const fmt = (n) => Number.isFinite(n) ? n.toFixed(1) : "Unknown";
const when = (s) => s && Number.isFinite(Date.parse(s)) ? new Date(s).toLocaleString() : "Not verified";
const label = (s) => String(s).replaceAll("_", " ").toLowerCase();
export const IMPORT_COLUMNS = {
  usage: ["player", "snapShare", "routeShare", "targets", "carries", "redZoneTouches"],
  bid: ["player", "teamId", "amount", "outcome", "transactionId"],
  result: ["player", "points", "final"],
  stash: ["player", "eligible", "returnEvidence", "keeperCost", "nextYearValue"],
  "ir-slot": ["player"],
};

export function parseEvidenceCsv(text) {
  if (typeof text !== "string" || text.length > 1_000_000) throw new Error("Use a CSV file smaller than 1 MB.");
  const rows = []; let row = [], field = "", quoted = false, closed = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) { if (c === '"' && text[i + 1] === '"') { field += '"'; i++; } else if (c === '"') { quoted = false; closed = true; } else field += c; }
    else if (c === '"' && field === "" && !closed) quoted = true;
    else if (c === ",") { row.push(field); field = ""; closed = false; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(field); if (row.some((s) => s.trim())) rows.push(row); row = []; field = ""; closed = false; }
    else { if (closed || c === '"') throw new Error("Invalid CSV quoting."); field += c; }
  }
  if (quoted) throw new Error("CSV has an unclosed quote.");
  row.push(field); if (row.some((s) => s.trim())) rows.push(row);
  return rows;
}

export function evidenceFromCsv(text, { kind, week, season, sourceUrl, observedAt, players }) {
  const rows = parseEvidenceCsv(text.replace(/^\uFEFF/, ""));
  const headers = rows.shift()?.map((s) => s.trim());
  const allowed = IMPORT_COLUMNS[kind];
  if (!allowed || !headers?.includes("player") || new Set(headers).size !== headers.length || headers.some((h) => !allowed.includes(h))) throw new Error("The column headings do not match the selected template.");
  if (!rows.length) throw new Error("Add evidence rows below the column headings.");
  return rows.map((values, index) => {
    if (values.length !== headers.length) throw new Error(`Row ${index + 2} has the wrong number of columns.`);
    const row = Object.fromEntries(headers.map((h, i) => [h, values[i].trim()]));
    const matches = players.filter((p) => [p.playerId, p.name].some((s) => s.toLowerCase() === row.player.toLowerCase()));
    if (!(kind === "ir-slot" && row.player.toUpperCase() === "EMPTY") && matches.length !== 1) throw new Error(`Row ${index + 2}: '${row.player}' is not an unambiguous catalog player. Use the player ID shown in the catalog export.`);
    const result = { kind, week: Number(week), season, playerId: matches[0]?.playerId ?? null, sourceUrl, observedAt };
    for (const h of headers.filter((h) => h !== "player")) {
      if (row[h] === "") continue;
      if (["snapShare", "routeShare", "targets", "carries", "redZoneTouches", "amount", "points", "keeperCost", "nextYearValue"].includes(h)) {
        if (!/^-?\d+(?:\.\d+)?$/.test(row[h])) throw new Error(`Row ${index + 2}: ${h} must be numeric.`);
        result[h] = Number(row[h]);
      } else if (["final", "eligible"].includes(h)) {
        if (!/^(true|false)$/i.test(row[h])) throw new Error(`Row ${index + 2}: ${h} must be true or false.`);
        result[h] = row[h].toLowerCase() === "true";
      } else result[h] = row[h];
    }
    return result;
  });
}

function panel(tab, id, title, { first = false, collapsed = true } = {}) {
  const host = document.getElementById(`tab-${tab}`);
  let outer = document.getElementById(id);
  if (!outer) { outer = el(collapsed ? "details" : "section", "", "panel management-panel"); outer.id = id; first ? host.prepend(outer) : host.append(outer); }
  outer.replaceChildren(el(collapsed ? "summary" : "h2", title));
  const body = el("div", "", "management-body"); outer.append(body); return body;
}
function note(body, text) { body.append(el("p", text, "management-note")); }
function card(body, title, detail) { const c = el("article", "", "management-card"); c.append(el("h3", title)); if (detail) c.append(el("p", detail)); body.append(c); return c; }
function list(body, lines) { const l = el("ul"); for (const line of lines) l.append(el("li", line)); body.append(l); }
function table(body, headers, rows) {
  const wrap = el("div", "", "table-wrap"); const t = el("table"); const head = el("thead"), tr = el("tr");
  for (const h of headers) tr.append(el("th", h)); head.append(tr); t.append(head);
  const tbody = el("tbody"); for (const r of rows) { const tr = el("tr"); for (const c of r) tr.append(el("td", String(c))); tbody.append(tr); }
  t.append(tbody); wrap.append(t); body.append(wrap);
}
function download(name, text) { const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" })); const a = el("a"); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
function csvCell(s) { return `"${String(s).replaceAll('"', '""')}"`; }

function importForm(body, plan, { offline, onImport }) {
  note(body, "Optional evidence import—not a replacement for Update CBS. Automatic bid/workload/final-score feeds are not connected here yet. Import verified report data using a template; blank metrics stay unknown. Copies of imports and corrections are retained privately. Never import provider fantasy points as Thunder Bowl actuals unless the scoring matches.");
  const form = el("form", "", "management-form");
  const addField = (caption, input) => { const l = el("label", caption); l.append(input); form.append(l); return input; };
  const kind = el("select"); for (const [value, text] of [["usage", "Observed workload"], ["bid", "Processed waiver bids"], ["result", "Final Thunder Bowl scores"], ["stash", "IR keeper evidence"], ["ir-slot", "My CBS IR-slot occupancy"]]) { const o = el("option", text); o.value = value; kind.append(o); }
  addField("Evidence type", kind);
  const week = el("input"); week.type = "number"; week.min = 1; week.max = 18; week.value = plan.week; week.required = true; addField("Report week (completed week for workload/scores)", week);
  const source = el("input"); source.type = "url"; source.required = true; source.placeholder = "https://… source report"; addField("Source report link", source);
  const observed = el("input"); observed.type = "datetime-local"; observed.required = true;
  const date = new Date(); observed.value = new Date(date - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16); addField("Evidence observed at (your local time)", observed);
  const file = el("input"); file.type = "file"; file.accept = ".csv,text/csv"; addField("CSV file (or paste below)", file);
  const input = el("textarea"); input.rows = 6; input.required = true; input.spellcheck = false; addField("CSV evidence", input);
  const instructions = el("p", "", "management-note"); form.append(instructions);
  const update = () => { input.placeholder = IMPORT_COLUMNS[kind.value].join(","); instructions.textContent = kind.value === "ir-slot" ? "Enter the occupant's name, or EMPTY to confirm the slot is empty. Reverify daily. This does not move a player in CBS." : kind.value === "stash" ? "eligible: true/false based on CBS; returnEvidence: a sourced quote/summary; keeperCost: next-year contract cost; nextYearValue: your explicitly estimated 2027 dollar value. These are estimates, not guaranteed proceeds." : kind.value === "usage" ? "Shares use percentages from 0–100; other columns are observed counts for one completed game week, not season totals. Missing columns/values are unknown." : kind.value === "bid" ? "teamId: use the IDs below. outcome: WON or LOST. transactionId must uniquely identify the processed claim; never guess a losing bid." : "points must use Thunder Bowl league scoring; final must be true. Only completed regular-season weeks are accepted."; };
  kind.addEventListener("change", update); update();
  const template = el("button", "Download blank template", "button"); template.type = "button"; template.addEventListener("click", () => download(`thunder-${kind.value}.csv`, IMPORT_COLUMNS[kind.value].join(",") + "\n"));
  const catalog = el("button", "Download player / team IDs", "button"); catalog.type = "button"; catalog.addEventListener("click", () => download("thunder-player-identities.csv", "playerId,name,position,teamId,teamName\n" + plan.playerStats.map((p) => [p.playerId, p.name, p.position, p.ownerTeamId || "", p.ownerTeamName || ""].map(csvCell).join(",")).join("\n")));
  const submit = el("button", "Validate and save evidence", "button primary"); submit.type = "submit"; submit.disabled = offline;
  const status = el("p", offline ? "Offline: evidence is read-only." : "", "management-note"); status.setAttribute("role", "status");
  file.addEventListener("change", async () => { try { if (file.files[0]?.size > 1_000_000) throw new Error("Use a CSV smaller than 1 MB."); input.value = file.files[0] ? await file.files[0].text() : ""; } catch (e) { status.textContent = e.message; } });
  form.addEventListener("submit", async (event) => {
    event.preventDefault(); if (offline || submit.disabled) return;
    try {
      const records = evidenceFromCsv(input.value, { kind: kind.value, week: week.value, season: plan.season, sourceUrl: source.value, observedAt: new Date(observed.value).toISOString(), players: plan.playerStats });
      submit.disabled = true; status.textContent = "Validating and saving privately…";
      await onImport(records);
      document.getElementById("management-import-result").textContent = `Saved ${records.length} evidence row(s). Reopen the relevant section to review the updated analysis.`;
    } catch (e) { status.textContent = e.message; submit.disabled = false; }
  });
  form.append(template, catalog, submit, status); body.append(form);
  const result = el("p"); result.id = "management-import-result"; result.setAttribute("role", "status"); body.append(result);
  note(body, "League team IDs: " + plan.league.teams.map((t) => `${t.teamName} = ${t.teamId}`).join("; "));
}

export function renderManagement(plan, options = {}) {
  if (!plan.management) return;
  const m = plan.management;
  const today = panel("start-sit", "management-today", `${plan.lineup.teamName}: team checklist`, { first: true, collapsed: false });
  note(today, `${options.offline ? "OFFLINE — saved evidence; refresh online before acting. " : ""}Checked ${when(m.asOf)}. ${m.confidenceNote}`);
  if (plan.viewing?.mode === "FORECAST") note(today, "Future-week outlook—not a submitted lineup or game-day instruction. Long-range shapes are estimates.");
  for (const a of m.actions) { const c = card(today, a.title, a.detail); const link = el("a", "Review section", "management-link"); link.href = `#${a.tab}`; c.append(link); }
  const day = panel("start-sit", "management-game-day", "Game-day backup plan");
  note(day, m.gameDay.lockPolicy + ` Submitted lineup captured: ${when(m.gameDay.submittedAsOf)}.`);
  for (const p of m.gameDay.rows) {
    const c = card(day, `${p.name} · ${label(p.status)} · ${when(p.kickoffAt)}`, p.injury?.status || "No captured injury flag; recheck before lock.");
    if (!p.backups.length) note(c, "No eligible same-position bench replacement identified. A waiver pickup requires separate availability and roster checks.");
    for (const b of p.backups) note(c, `${b.name}: ${fmt(b.points)} pts · ${label(b.status)} · decide before ${when(b.decideBy)}${b.earlyDecision ? " — backup plays earlier; do not wait for the starter's late inactive report." : ""}`);
  }
  const sources = panel("admin", "management-sources", "Evidence quality & provenance");
  table(sources, ["Source", "Status", "Week / rows", "Retrieved", "Published"], m.sourceAudit.map((s) => [s.source, label(s.status), `${s.week ?? "—"} / ${s.rows}`, when(s.retrievedAt), when(s.publishedAt)]));
  note(sources, "A successful retrieval does not mean the provider published new projections. Season-derived player rows are estimates, even when a provider's name appears beside them.");
  const waiver = panel("waivers", "management-market", "League bid history & safe fallback claims");
  const market = m.waiverMarket;
  note(waiver, `Recorded bids: ${market.recordedBids} (${market.winningBids} wins, ${market.losingBids} losses). Budget: ${fmt(market.budget)}; protected reserve: ${fmt(market.reserve)}; spendable: $${market.spendable}.`);
  note(waiver, market.note);
  if (!market.chain.length) note(waiver, "Hold FAB: no priced, actionable fallback chain is available.");
  for (const r of market.chain) card(waiver, `${r.order}. ${r.name} — bid $${r.recommended}, never above $${r.maximum}`, `${r.drop ? `Drop ${r.drop.name}. ` : "Open roster spot. "}${r.condition}`);
  for (const r of market.pricing) { const c = card(waiver, `${r.name}: market evidence`, `${r.sampleCount} recorded ${r.position} winning bids; observed range ${r.observedWinningRange ? `$${r.observedWinningRange[0]}–$${r.observedWinningRange[1]}` : "unknown"}. ${r.evidence}`); note(c, `Current uncovered starter needs: ${r.likelyNeedTeams.map((t) => t.teamName).join(", ") || "none identified"}. This is not a prediction of their bids.`); }
  const workload = panel("player-stats", "management-workload", "Observed workload & breakout watch");
  if (!m.workload.length) note(workload, "No comparable completed-week workload evidence has been captured. Projections and preseason totals are not treated as actual snap/route/target trends. Verified workload reports can be imported in Admin.");
  for (const p of m.workload.slice(0, 40)) { const c = card(workload, `${p.name} · ${p.position} ${p.nflTeam} · ${label(p.signal)}`, `${p.leagueStatus} · ${p.games} observed week(s)`); list(c, p.changes.map((r) => `${r.metric}: ${r.latest} vs previous ${r.previousAverage} (${r.delta >= 0 ? "+" : ""}${r.delta}); Week ${r.week}`)); }
  const trades = panel("trades", "management-trade-fit", "Trade-by-trade depth, injuries & bye coverage");
  const gaps = (r) => r.byeGaps.map((g) => `W${g.week} ${g.position} ×${g.missing}`).join(", ") || "None";
  for (const t of m.tradeFit) {
    const c = card(trades, `${t.sends.join(" + ")} → ${t.receives.join(" + ")} (${t.rival})`);
    table(c, ["Team", "Coverage gaps before", "Coverage gaps after", "Injured after"], [["Dogs of War", gaps(t.dogsBefore), gaps(t.dogsAfter), t.dogsAfter.injured.join(", ") || "None captured"], [t.rival, gaps(t.rivalBefore), gaps(t.rivalAfter), t.rivalAfter.injured.join(", ") || "None captured"]]);
  }
  note(trades, "Coverage means enough non-bye players by position, not equal player quality. Current injuries affect only the current-week coverage check; future recovery is not assumed known. Use the existing two-sided projection deltas alongside these gaps.");
  const stash = panel("waivers", "management-stash", "One-slot IR opportunity-cost comparison");
  note(stash, `${label(m.stash.occupancy)}. ${m.stash.note}`);
  if (!m.stash.candidates.length) note(stash, "No captured IR candidate currently qualifies for this comparison.");
  for (const p of m.stash.candidates) card(stash, `${p.name} · ${p.position} ${p.nflTeam} · bye ${p.bye ?? "—"} · ${p.currentSlot ? "current occupant" : label(p.verdict)}`, `Keeper cost: ${fmt(p.keeperCost)}; estimated next-year value: ${fmt(p.nextYearValue)}; estimated surplus: ${fmt(p.estimatedSurplus)}; improvement over occupant: ${fmt(p.improvementOverOccupant)}. ${p.returnEvidence || "Return / CBS eligibility evidence still needs verification."}`);
  const outcomes = panel("admin", "management-outcomes", "Recommendation scorecard — frozen decisions vs actuals");
  note(outcomes, m.outcomes.note);
  if (!m.outcomes.projectionWeeks?.length) note(outcomes, "No weekly all-player projection archive exists yet. The next current-week refresh with captured kickoff times will freeze one automatically.");
  table(outcomes, ["Week", "Projection archive", "Audit status", "Players frozen", "Final actuals matched", "Blend MAE"], (m.outcomes.projectionWeeks || []).map((w) => [w.week, when(w.capturedAt), w.auditEligible ? "Pregame — eligible" : "After kickoff — archived, excluded", w.projectedPlayers, w.observedPlayers, fmt(w.meanAbsoluteError)]));
  if (!m.outcomes.weeks.length) note(outcomes, "No eligible pregame checkpoint yet. Refresh CBS before the first kickoff with complete player game times to establish one. There are no claimed wins or accuracy scores without real results.");
  table(outcomes, ["Week", "Checkpoint", "Final scores", "Projection MAE", "Recommended lineup actual", "Hindsight gap"], m.outcomes.weeks.map((w) => [w.week, when(w.capturedAt), `${w.observedPlayers}/${w.rosterPlayers}`, fmt(w.meanAbsoluteError), fmt(w.recommendedActualTotal), fmt(w.hindsightGap)]));
  table(outcomes, ["Rank", "Provider", "Observed player-weeks", "MAE", "Bias", "RMSE", "Evidence"], m.outcomes.providers.map((p) => [p.rank, p.source, p.sampleCount, fmt(p.meanAbsoluteError), fmt(p.meanError), fmt(p.rootMeanSquaredError), p.calibrationReady ? "Descriptive ranking—not a calibrated win probability" : "Small sample; do not calibrate from this"]));
  if (m.outcomes.playerAudits?.length) table(outcomes, ["Week", "Player", "Pos.", "Frozen blend", "Actual", "Absolute error", "Direct provider audit"], m.outcomes.playerAudits.slice(0, 100).map((p) => [p.week, p.name, p.position, fmt(p.projected), fmt(p.actual), fmt(p.absoluteError), p.providers.map((provider) => `${provider.source}: ${fmt(provider.projected)} (${fmt(provider.absoluteError)} error)`).join("; ") || "No direct weekly provider row"]));
  importForm(panel("admin", "management-import", "Import verified workload, bids, actuals or IR evidence"), plan, options);
}
