const VALID_POSITIONS = new Set(["QB", "RB", "WR", "TE", "K", "DST"]);
const MAX_ROSTER_SIZE = 14;

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
  // Eight legal starters are sufficient after the draft; teams may carry up to
  // six reserves. Preserve incomplete captures, then let the server validate
  // the exact positional minimum before it enables roster-dependent advice.
  if (players.length < 1 || players.length > MAX_ROSTER_SIZE) throw new Error(`${team.name} returned ${players.length} roster rows; expected 1–${MAX_ROSTER_SIZE}.`);
  return { teamId: team.teamId, cbsTeamId: team.cbsTeamId, name: team.name, players };
}

function projectedPlayer(row, position, week) {
  const id = String(row?.cbsPlayerId || "");
  const name = String(row?.name || "").trim();
  const nflTeam = String(row?.nflTeam || "").trim().toUpperCase();
  const cells = Array.isArray(row?.cells) ? row.cells.map((value) => String(value || "").trim()) : [];
  if (!/^\d{1,10}$/.test(id) || name.length < 2 || !/^[A-Z]{2,3}$/.test(nflTeam) || cells.length < 10) return null;
  const common = {
    cbsPlayerId: id,
    name,
    position,
    nflTeam,
    week,
    opponent: cells[3] || null,
    providerPoints: numberOrNull(cells.at(-1)),
  };
  if (position === "QB") {
    if (cells.length !== 20) return null;
    return {
      ...common,
      projectedStats: {
        passingAttempts: numberOrNull(cells[9]),
        passingCompletions: numberOrNull(cells[10]),
        passingYards: numberOrNull(cells[11]),
        passingTouchdowns: numberOrNull(cells[12]),
        interceptionsThrown: numberOrNull(cells[13]),
        rushingAttempts: numberOrNull(cells[14]),
        rushingYards: numberOrNull(cells[15]),
        rushingTouchdowns: numberOrNull(cells[17]),
        fumblesLost: numberOrNull(cells[18]),
      },
    };
  }
  if (position === "RB") {
    if (cells.length !== 20) return null;
    return {
      ...common,
      projectedStats: {
        rushingAttempts: numberOrNull(cells[9]),
        rushingYards: numberOrNull(cells[10]),
        rushingTouchdowns: numberOrNull(cells[12]),
        targets: numberOrNull(cells[13]),
        receptions: numberOrNull(cells[14]),
        receivingYards: numberOrNull(cells[15]),
        receivingTouchdowns: numberOrNull(cells[17]),
        fumblesLost: numberOrNull(cells[18]),
      },
    };
  }
  if (["WR", "TE"].includes(position)) {
    if (cells.length !== 20) return null;
    return {
      ...common,
      projectedStats: {
        targets: numberOrNull(cells[9]),
        receptions: numberOrNull(cells[10]),
        receivingYards: numberOrNull(cells[11]),
        receivingTouchdowns: numberOrNull(cells[13]),
        rushingAttempts: numberOrNull(cells[14]),
        rushingYards: numberOrNull(cells[15]),
        rushingTouchdowns: numberOrNull(cells[17]),
        fumblesLost: numberOrNull(cells[18]),
      },
    };
  }
  if (position === "K") {
    if (cells.length !== 24) return null;
    return {
      ...common,
      projectedStats: {
        fieldGoalsMade: numberOrNull(cells[9]),
        fieldGoalAttempts: numberOrNull(cells[10]),
        fieldGoalsMade1To19: numberOrNull(cells[11]),
        fieldGoalsMade20To29: numberOrNull(cells[13]),
        fieldGoalsMade30To39: numberOrNull(cells[15]),
        fieldGoalsMade40To49: numberOrNull(cells[17]),
        fieldGoalsMade50Plus: numberOrNull(cells[19]),
        extraPointsMade: numberOrNull(cells[21]),
        extraPointAttempts: numberOrNull(cells[22]),
      },
    };
  }
  if (position === "DST") {
    if (cells.length !== 19) return null;
    return {
      ...common,
      projectedStats: {
        defensiveSacks: numberOrNull(cells[8]),
        defensiveFumblesRecovered: numberOrNull(cells[9]),
        defensiveInterceptions: numberOrNull(cells[10]),
        defensiveTouchdowns: numberOrNull(cells[12]),
        defensiveSafeties: numberOrNull(cells[13]),
        defensiveYardsAllowed: numberOrNull(cells[14]),
        defensivePointsAllowed: numberOrNull(cells[16]),
      },
    };
  }
  return null;
}

export function normalizeCbsProjectionRows(position, rawRows, week) {
  if (!VALID_POSITIONS.has(position) || !Array.isArray(rawRows) || !Number.isSafeInteger(week) || week < 1 || week > 18) throw new Error("CBS weekly projection capture is malformed.");
  const seen = new Set();
  const projections = [];
  for (const raw of rawRows) {
    const row = projectedPlayer(raw, position, week);
    if (!row || seen.has(row.cbsPlayerId)) continue;
    projections.push(row);
    seen.add(row.cbsPlayerId);
  }
  if (!projections.length || projections.length > 100) throw new Error(`CBS ${position} Week ${week} projection coverage is unsafe (${projections.length} rows).`);
  return projections;
}
