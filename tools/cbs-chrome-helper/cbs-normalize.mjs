const VALID_POSITIONS = new Set(["QB", "RB", "WR", "TE", "K", "DST"]);

function numberOrNull(value) {
  const text = String(value ?? "").replace(/[%,$]/g, "").trim();
  if (!text || text === "—" || text === "-") return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

function requiredInteger(value, label, minimum, maximum) {
  const number = numberOrNull(value);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) throw new Error(`${label} is missing or invalid.`);
  return number;
}

function positionFrom(cells, combined) {
  for (const cell of cells) {
    const position = cell.trim().toUpperCase() === "TD" ? "DST" : cell.trim().toUpperCase();
    if (VALID_POSITIONS.has(position)) return position;
  }
  const match = combined.match(/\b(QB|RB|WR|TE|K|DST|TD)\b/i);
  const position = match?.[1]?.toUpperCase() === "TD" ? "DST" : match?.[1]?.toUpperCase();
  if (!VALID_POSITIONS.has(position)) throw new Error("CBS row has no supported position.");
  return position;
}

function teamFrom(combined, position) {
  const escaped = position === "DST" ? "(?:DST|TD)" : position;
  const nearPosition = combined.match(new RegExp(`\\b${escaped}\\b\\s*[•·-]\\s*([A-Z]{2,3}|FA)\\b`, "i"));
  if (nearPosition) return nearPosition[1].toUpperCase();
  const codes = combined.match(/\b[A-Z]{2,3}\b/g) || [];
  const excluded = new Set(["QB", "RB", "WR", "TE", "DST"]);
  const team = codes.find((code) => !excluded.has(code));
  if (!team) throw new Error("CBS row has no NFL team code.");
  return team;
}

export function normalizeCbsTeamRows(team, rawRows) {
  if (!team || !Array.isArray(rawRows)) throw new Error("CBS team capture is malformed.");
  const players = [];
  const seen = new Set();
  for (const row of rawRows) {
    const id = String(row?.cbsPlayerId || "");
    const name = String(row?.name || "").trim();
    const cells = Array.isArray(row?.cells) ? row.cells.map((value) => String(value || "").trim()) : [];
    if (!/^\d{1,10}$/.test(id) || name.length < 2 || cells.length < 8 || seen.has(id)) continue;
    const combined = cells.join(" ");
    const position = positionFrom(cells, combined);
    const nflTeam = teamFrom(combined, position);
    const salary = requiredInteger(cells.at(-5), `${name} salary`, 0, 200);
    const contractYear = requiredInteger(cells.at(-4), `${name} contract year`, 1, 3);
    players.push({
      cbsPlayerId: id,
      name,
      position,
      nflTeam,
      salary,
      contractYear,
      // CBS renders the trailing scoring columns as: prior season, 3-year
      // average, current-season projection. Keep this header order explicit;
      // salary and contract remain the two columns immediately before them.
      priorSeasonPoints: numberOrNull(cells.at(-3)),
      threeYearAverage: numberOrNull(cells.at(-2)),
      projectedPoints: numberOrNull(cells.at(-1)),
      // Anchor the schedule/rank fields from the stable trailing CBS columns.
      // CBS currently omits the historical blank leading cell on the all-team
      // report, while some team views still include it.
      opponent: cells.at(-13) || null,
      gameTime: cells.at(-12) || null,
      bye: numberOrNull(cells.at(-11)),
      overUnder: numberOrNull(cells.at(-10)),
      positionRank: numberOrNull(cells.at(-9)),
      opponentVsPosition: numberOrNull(cells.at(-8)),
      rosteredPercent: numberOrNull(cells.at(-7)),
      startedPercent: numberOrNull(cells.at(-6)),
      newsTitles: (row.newsTitles || []).filter((value) => typeof value === "string").slice(0, 10),
      markerClasses: (row.markerClasses || []).filter((value) => typeof value === "string").slice(0, 20),
    });
    seen.add(id);
  }
  // A CBS roster is legitimately below the 14-player target while the auction
  // is still being entered. Preserve that authenticated partial state; the app
  // applies separate safety gates before treating the league as waiver-ready.
  if (players.length < 1 || players.length > 25) throw new Error(`${team.name} returned ${players.length} roster rows; expected 1–25.`);
  return { teamId: team.teamId, cbsTeamId: team.cbsTeamId, name: team.name, players };
}
