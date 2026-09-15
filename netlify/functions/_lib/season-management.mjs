import { PREMIUM_PROJECTION_SOURCES, projectionSourceWeights } from "../../../public/thunder-bowl/projection-lab.mjs";

// Evidence-only management tools. No forecasts are promoted to observed results.
const SLOTS = { QB: 1, RB: 2, WR: 2, TE: 1, K: 1, DST: 1 };
const HOUR = 3_600_000;
const finite = (x) => typeof x === "number" && Number.isFinite(x);
const mean = (xs) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
const round = (x) => finite(x) ? Math.round(x * 100) / 100 : null;
const round4 = (x) => finite(x) ? Math.round(x * 10_000) / 10_000 : null;
const unavailable = (p) => /\b(out|ir|pup|suspended|doubtful)\b|injured reserve|physically unable/i.test(p?.injury?.status || "");
const weightedQuantile = (samples, percentile) => {
  const rows = samples.filter((sample) => finite(sample.value) && finite(sample.weight) && sample.weight > 0).sort((a, b) => a.value - b.value);
  const total = rows.reduce((sum, sample) => sum + sample.weight, 0);
  if (!total) return null;
  const target = total * percentile;
  let seen = 0;
  for (const sample of rows) { seen += sample.weight; if (seen >= target) return sample.value; }
  return rows.at(-1)?.value ?? null;
};
const denverDay = (iso) => Number.isFinite(Date.parse(iso)) ? new Intl.DateTimeFormat("en-US", { timeZone: "America/Denver", weekday: "short" }).format(new Date(iso)) : null;

export function sourceAudit({ leagueState, fbgSnapshot, fantasyProsSnapshot, pffSnapshot, week, now }) {
  return [["CBS", leagueState, leagueState?.projectionWeek, leagueState?.projectionCount ?? leagueState?.weeklyProjections?.length],
    ["Footballguys", fbgSnapshot, fbgSnapshot?.week, fbgSnapshot?.items?.length],
    ["FantasyPros", fantasyProsSnapshot, fantasyProsSnapshot?.week, fantasyProsSnapshot?.items?.length],
    ["PFF", pffSnapshot, pffSnapshot?.week, pffSnapshot?.items?.length]].map(([source, data, sourceWeek, rows]) => {
    const retrievedAt = data?.capturedAt || null;
    // Legacy providerAsOf often contains the capture timestamp. It is not publication evidence.
    const publishedAt = data?.publicationEvidence?.verified === true ? data.publicationEvidence.publishedAt : null;
    const ageHours = Number.isFinite(Date.parse(retrievedAt)) ? (Date.parse(now) - Date.parse(retrievedAt)) / HOUR : null;
    const status = !rows ? "MISSING" : sourceWeek !== week ? "WRONG_WEEK" : ageHours === null || ageHours < 0 ? "UNVERIFIED_TIME" : ageHours > 48 ? "STALE" : "RECENT_CAPTURE";
    return { source, week: sourceWeek ?? null, rows: rows || 0, retrievedAt, publishedAt, ageHours: round(ageHours), status,
      note: publishedAt ? "Provider publication timestamp verified." : "Retrieval time only; provider publication time was not verified." };
  });
}

export function kickoffAt(gameTime, week, season = 2026) {
  if (typeof gameTime !== "string" || !Number.isInteger(week) || week < 1 || week > 18) return null;
  if (/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(gameTime)) return Number.isFinite(Date.parse(gameTime)) ? new Date(gameTime).toISOString() : null;
  const match = gameTime.match(/^(Tue(?:s)?|Wed|Thu(?:rs?)?|Fri|Sat|Sun|Mon)\s+(\d{1,2}):(\d{2})\s*(am|pm)\s+(MT|ET|CT|PT)$/i);
  if (!match || season !== 2026) return null;
  let [, day, hour, minute, ampm, zone] = match;
  if (+hour < 1 || +hour > 12 || +minute > 59) return null;
  const offset = ["tue", "wed", "thu", "fri", "sat", "sun", "mon"].indexOf(day.slice(0, 3).toLowerCase());
  const local = Date.UTC(2026, 8, 8 + (week - 1) * 7 + offset, (+hour % 12) + (/pm/i.test(ampm) ? 12 : 0), +minute);
  const formatter = new Intl.DateTimeFormat("en-CA", { timeZone: { MT: "America/Denver", ET: "America/New_York", CT: "America/Chicago", PT: "America/Los_Angeles" }[zone.toUpperCase()], year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  let utc = local;
  for (let i = 0; i < 3; i++) {
    const p = Object.fromEntries(formatter.formatToParts(new Date(utc)).map((p) => [p.type, p.value]));
    utc += local - Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
  }
  return new Date(utc).toISOString();
}

export function buildGameDay(plan, now) {
  const roster = [...plan.lineup.starters, ...plan.lineup.bench].map((p) => ({ ...p, kickoffAt: kickoffAt(p.gameTime, plan.week, plan.season) }));
  const byId = new Map(roster.map((p) => [p.playerId, p]));
  const submitted = plan.scoringPreview?.week === plan.week && plan.scoringPreview?.status === "COMPLETE"
    ? plan.scoringPreview.teams.find((t) => t.teamId === plan.lineup.teamId)?.starters : null;
  const hasSubmission = submitted?.length === 8;
  const open = (p) => Boolean(p?.kickoffAt && Date.parse(p.kickoffAt) > Date.parse(now));
  const submittedIds = new Set((submitted || []).map((p) => p.playerId));
  const rows = plan.lineup.starters.map((entry) => {
    const p = byId.get(entry.playerId);
    const choices = roster.filter((q) => q.position === p.position && q.playerId !== p.playerId && !submittedIds.has(q.playerId) && !plan.lineup.starters.some((s) => s.playerId === q.playerId) && q.bye !== plan.week && !unavailable(q) && finite(q.points))
      .sort((a, b) => b.points - a.points)
      .map((q) => ({ playerId: q.playerId, name: q.name, points: q.points, kickoffAt: q.kickoffAt,
        status: !p.kickoffAt || !q.kickoffAt ? "VERIFY_TIME" : !open(p) || !open(q) ? "LOCKED" : "AVAILABLE",
        decideBy: p.kickoffAt && q.kickoffAt ? new Date(Math.min(Date.parse(p.kickoffAt), Date.parse(q.kickoffAt))).toISOString() : null,
        earlyDecision: Boolean(p.kickoffAt && q.kickoffAt && q.kickoffAt < p.kickoffAt) }));
    return { playerId: p.playerId, name: p.name, position: p.position, kickoffAt: p.kickoffAt,
      status: !p.kickoffAt ? "VERIFY_TIME" : open(p) ? "OPEN" : "LOCKED", injury: p.injury, backups: choices };
  });
  const entering = plan.lineup.starters.filter((p) => !submittedIds.has(p.playerId));
  const leaving = (submitted || []).filter((p) => !plan.lineup.starters.some((s) => s.playerId === p.playerId));
  const changes = hasSubmission ? entering.map((p) => {
    const index = leaving.findIndex((q) => q.position === p.position);
    const q = index < 0 ? null : leaving.splice(index, 1)[0];
    const incoming = byId.get(p.playerId), outgoing = q && byId.get(q.playerId);
    const delta = finite(p.points) && finite(q?.points) ? round(p.points - q.points) : null;
    return { incoming: p.name, outgoing: q?.name || "unfilled slot", delta,
      status: !open(incoming) || !open(outgoing) ? "VERIFY_LOCK" : delta !== null && delta < 1 && !unavailable(outgoing) ? "OPTIONAL" : "REVIEW",
      reason: !open(incoming) || !open(outgoing) ? "One or both kickoff times are missing or have passed. Verify CBS locks; do not automatically swap." : "Recommended lineup differs from captured CBS starters. Review and submit in CBS yourself." };
  }) : [];
  return { asOf: now, submittedKnown: hasSubmission, submittedAsOf: plan.scoringPreview?.asOf || null, changes, rows,
    lockPolicy: "Conservative per-player kickoff guard; CBS remains authoritative for eligibility and locks. The app never submits a lineup.",
    verdict: plan.lineup.starters.length !== 8 ? "INCOMPLETE" : !hasSubmission ? "VERIFY_CBS" : changes.some((c) => c.status !== "OPTIONAL") ? "REVIEW" : "KEEP" };
}

export function workloadTrends(records, players, week) {
  const metrics = ["snapShare", "routeShare", "targets", "carries", "redZoneTouches"];
  return players.map((p) => {
    const games = records.filter((r) => r.kind === "usage" && r.playerId === p.playerId && r.week < week).sort((a, b) => a.week - b.week).slice(-6);
    const changes = metrics.flatMap((metric) => {
      const observed = games.filter((r) => finite(r[metric]));
      if (observed.length < 2) return [];
      const last = observed.at(-1), baseline = observed.slice(0, -1).slice(-3);
      return [{ metric, latest: last[metric], previousAverage: round(mean(baseline.map((r) => r[metric]))), delta: round(last[metric] - mean(baseline.map((r) => r[metric]))), week: last.week, sourceUrl: last.sourceUrl }];
    });
    const positive = changes.filter((c) => c.delta >= (c.metric.endsWith("Share") ? 10 : 2));
    return { playerId: p.playerId, name: p.name, position: p.position, nflTeam: p.nflTeam, leagueStatus: p.leagueStatus,
      games: games.length, changes, latestWeek: games.at(-1)?.week ?? null,
      signal: games.at(-1)?.week !== week - 1 ? "STALE_OR_BYE" : positive.length >= 2 ? "BREAKOUT_WATCH" : positive.length ? "MONITOR" : "NO_CLEAR_RISE" };
  }).filter((r) => r.changes.length).sort((a, b) => Number(b.signal === "BREAKOUT_WATCH") - Number(a.signal === "BREAKOUT_WATCH") || a.name.localeCompare(b.name));
}

export function waiverMarket(plan, records) {
  const fab = plan.waivers.fab || {};
  const players = new Map(plan.playerStats.map((p) => [p.playerId, p]));
  const bids = records.filter((r) => r.kind === "bid" && r.week <= plan.week);
  const spendable = finite(fab.spendable) ? Math.max(0, Math.floor(fab.spendable)) : 0;
  const groups = new Map();
  const priced = (plan.waivers.recommendations || []).map((r) => {
    const samples = bids.filter((b) => b.outcome === "WON" && players.get(b.playerId)?.position === r.add.position).map((b) => b.amount).sort((a, b) => a - b);
    const historicalMedian = samples.length ? samples[Math.floor((samples.length - 1) / 2)] : null;
    const cap = finite(r.fab?.maximum) ? Math.min(spendable, r.fab.maximum) : null;
    const recommended = finite(r.fab?.recommended) && cap >= 1 ? Math.min(cap, Math.max(r.fab.recommended, samples.length >= 5 ? historicalMedian : 0)) : null;
    const rivals = plan.league.teams.filter((t) => t.teamId !== plan.league.userTeamId).map((t) => {
      const eligible = t.roster.map((p) => players.get(p.playerId)).filter((p) => p?.position === r.add.position && p.bye !== plan.week && !unavailable(p));
      return { teamId: t.teamId, teamName: t.teamName, needsStarter: eligible.length < SLOTS[r.add.position] };
    }).filter((t) => t.needsStarter);
    const item = { playerId: r.add.playerId, name: r.add.name, position: r.add.position, drop: r.drop, recommended, maximum: cap,
      observedWinningRange: samples.length ? [samples[0], samples.at(-1)] : null, historicalMedian, sampleCount: samples.length,
      likelyNeedTeams: rivals, evidence: samples.length >= 5 ? "Position-level historical reference, not a probability of winning. Individual players differ." : "Too little league bid history; conservative value-based estimate only." };
    const key = r.drop?.playerId || `open-${r.add.position}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
    return item;
  });
  // One actionable chain only: alternatives share a drop or compete for an open spot.
  // Other chains require a fresh roster/budget calculation after the first resolves.
  const first = [...groups.values()][0] || [];
  const chain = first.filter((r) => r.recommended !== null).map((r, i) => ({ ...r, order: i + 1, condition: i ? "Only if every earlier claim fails; cancel after one success." : "First choice; cancel this chain after one success." }));
  return { recordedBids: bids.length, winningBids: bids.filter((b) => b.outcome === "WON").length,
    losingBids: bids.filter((b) => b.outcome === "LOST").length, budget: fab.budget ?? null, reserve: fab.plannedReserve ?? null,
    spendable, pricing: priced, chain, maximumChainSpend: chain.length ? Math.max(...chain.map((r) => r.maximum)) : 0,
    note: "Fallbacks are mutually exclusive, not simultaneous adds. Other ideas require re-analysis after success. Losing bids are only known when explicitly captured; manager demand is not proof of a bid. Keep the existing CBS tie-break order authoritative." };
}

export function rosterFit(roster, players, week) {
  const rows = roster.map((r) => players.get(r.playerId)).filter(Boolean);
  const weeks = Array.from({ length: Math.max(0, 18 - week) }, (_, i) => week + i);
  return { injured: rows.filter(unavailable).map((p) => p.name), byeGaps: weeks.flatMap((w) => Object.entries(SLOTS).flatMap(([pos, needed]) => {
    const available = rows.filter((p) => p.position === pos && p.bye !== w && !(w === week && unavailable(p))).length;
    return available < needed ? [{ week: w, position: pos, missing: needed - available }] : [];
  })), starterDepth: Object.fromEntries(Object.keys(SLOTS).map((pos) => [pos, rows.filter((p) => p.position === pos).length - SLOTS[pos]])) };
}

export function stashComparison(plan, records) {
  const facts = records.filter((r) => r.kind === "stash");
  const slot = records.filter((r) => r.kind === "ir-slot").at(-1);
  const slotFresh = slot && Date.parse(plan.managementAsOf || plan.generatedAt) - Date.parse(slot.observedAt) <= 24 * HOUR;
  const current = slotFresh ? slot.playerId || null : null;
  const candidates = (plan.watch.irTargets || []).filter((p) => p.leagueStatus === "AVAILABLE" || p.playerId === current).map((p) => {
    const f = facts.filter((r) => r.playerId === p.playerId).at(-1);
    const fresh = f && Date.parse(plan.managementAsOf || plan.generatedAt) - Date.parse(f.observedAt) <= 7 * 24 * HOUR;
    const qualified = Boolean(slotFresh && fresh && f.eligible && f.returnEvidence && finite(f.keeperCost) && finite(f.nextYearValue));
    return { playerId: p.playerId, name: p.name, position: p.position, nflTeam: p.nflTeam, bye: p.bye, currentSlot: p.playerId === current,
      eligible: fresh ? f.eligible : null, returnEvidence: fresh ? f.returnEvidence : null,
      keeperCost: fresh ? f.keeperCost : null, nextYearValue: fresh ? f.nextYearValue : null,
      estimatedSurplus: qualified ? round(f.nextYearValue - f.keeperCost) : null, sourceUrl: f?.sourceUrl || null,
      verdict: qualified ? "COMPARE" : "VERIFY", note: "Next-year value is a recorded estimate, not guaranteed trade proceeds. Confirm CBS eligibility, contract rules, activation cost and occupied-slot opportunity cost before bidding." };
  }).sort((a, b) => (b.estimatedSurplus ?? -Infinity) - (a.estimatedSurplus ?? -Infinity));
  const incumbent = candidates.find((p) => p.currentSlot);
  for (const p of candidates) p.improvementOverOccupant = p.estimatedSurplus !== null && incumbent?.estimatedSurplus != null ? round(p.estimatedSurplus - incumbent.estimatedSurplus) : null;
  return { freeSlots: 1, occupancy: !slotFresh ? "VERIFY_CBS" : current ? "OCCUPIED" : "EMPTY", occupantId: current, candidates,
    note: "One free IR slot is reserved for long-term value. Missing eligibility, return evidence or keeper-cost evidence blocks a buy recommendation; an NFL IR tag alone is not CBS eligibility." };
}

export function decisionCheckpoint(plan, capturedAt, checkpointType = "AUTO") {
  if (plan.viewing?.mode === "FORECAST" || plan.lineup.teamId !== plan.league.userTeamId) return null;
  const roster = [...plan.lineup.starters, ...plan.lineup.bench];
  const kicks = roster.map((p) => kickoffAt(p.gameTime, plan.week, plan.season));
  if (!roster.length || kicks.some((k) => !k)) return null;
  const firstKickoff = kicks.slice().sort()[0];
  const sundayKickoffs = kicks.filter((kick) => denverDay(kick) === "Sun").sort();
  const finalKickoff = sundayKickoffs[0] || firstKickoff;
  const finalWindowOpens = new Date(Date.parse(finalKickoff) - 18 * HOUR).toISOString();
  const type = checkpointType === "AUTO"
    ? Date.parse(capturedAt) >= Date.parse(finalWindowOpens) ? "FINAL" : "EARLY"
    : checkpointType;
  if (!['EARLY', 'FINAL'].includes(type)) return null;
  if (type === "EARLY" && Date.parse(capturedAt) >= Date.parse(firstKickoff)) return null;
  if (type === "FINAL" && (Date.parse(capturedAt) < Date.parse(finalWindowOpens) || Date.parse(capturedAt) >= Date.parse(finalKickoff))) return null;
  return { schemaVersion: 2, checkpointType: type, season: plan.season, week: plan.week, capturedAt, firstKickoff, finalKickoff, finalWindowOpens, sourceFingerprint: plan.sourceFingerprint,
    roster: roster.map((p) => ({ playerId: p.playerId, name: p.name, position: p.position, points: p.points, sources: p.sources,
      floor: p.floor ?? null, ceiling: p.ceiling ?? null, rangeKind: p.rangeKind || "UNAVAILABLE", confidence: p.confidence ?? null,
      nflTeam: p.nflTeam || null, opponent: p.opponent || null, gameTime: p.gameTime || null,
      kickoffAt: kickoffAt(p.gameTime, plan.week, plan.season), injury: p.injury ? structuredClone(p.injury) : null,
      lockedAtCapture: Date.parse(kickoffAt(p.gameTime, plan.week, plan.season)) <= Date.parse(capturedAt),
      starter: plan.lineup.starters.some((s) => s.playerId === p.playerId) })),
    waivers: plan.waivers.recommendations.map((r) => ({ add: r.add, drop: r.drop, bid: r.fab?.recommended })),
    trades: plan.trades.recommendations.map((r) => ({ sends: r.sends, receives: r.receives, verdict: r.verdict })) };
}

export function weeklyProjectionArchive(plan, capturedAt) {
  if (plan.viewing?.mode === "FORECAST") return null;
  const players = (plan.playerStats || []).filter((player) => finite(player.points)).map((player) => ({
    playerId: player.playerId,
    name: player.name,
    position: player.position,
    nflTeam: player.nflTeam || null,
    ownerTeamId: player.ownerTeamId || null,
    ownerTeamName: player.ownerTeamName || null,
    leagueStatus: player.leagueStatus || null,
    points: player.points,
    floor: player.floor ?? null,
    ceiling: player.ceiling ?? null,
    rangeKind: player.rangeKind || "UNAVAILABLE",
    confidence: player.confidence ?? null,
    opponent: player.opponent || null,
    gameTime: player.gameTime || null,
    kickoffAt: player.kickoffAt || kickoffAt(player.gameTime, plan.week, plan.season),
    injury: player.injury ? structuredClone(player.injury) : null,
    sources: (player.sources || []).filter((source) => finite(source.points)).map((source) => ({
      source: source.source,
      points: source.points,
      basis: source.basis,
      asOf: source.asOf || null,
    })),
  }));
  for (const player of players) player.auditEligible = Number.isFinite(Date.parse(player.kickoffAt)) && Date.parse(capturedAt) < Date.parse(player.kickoffAt);
  const kickoffs = players.map((player) => player.kickoffAt).filter((value) => Number.isFinite(Date.parse(value))).sort();
  if (!players.length || !kickoffs.length) return null;
  const firstKickoff = kickoffs[0];
  return {
    schemaVersion: 2,
    season: plan.season,
    week: plan.week,
    capturedAt,
    firstKickoff,
    auditEligible: Date.parse(capturedAt) < Date.parse(firstKickoff),
    auditEligiblePlayers: players.filter((player) => player.auditEligible).length,
    sourceFingerprint: plan.sourceFingerprint,
    players,
  };
}

export function buildProjectionCalibration(projectionArchives = [], records = [], targetWeek = 1) {
  const baseline = projectionSourceWeights(PREMIUM_PROJECTION_SOURCES);
  const minimumSamples = 30;
  const minimumWeeks = 2;
  const priorStrength = 30;
  const recencyDecay = 0.8;
  const maxAbsoluteShift = 0.05;
  const positions = {};
  const eligibleArchives = projectionArchives.filter((archive) => archive.week < targetWeek
    && (archive.auditEligible || (archive.players || []).some((player) => player.auditEligible === true)));
  const actualByWeek = new Map();
  for (const row of records) {
    if (row.kind !== "result" || row.final !== true || row.week >= targetWeek || !finite(row.points)) continue;
    if (!actualByWeek.has(row.week)) actualByWeek.set(row.week, new Map());
    actualByWeek.get(row.week).set(row.playerId, row.points);
  }
  for (const position of Object.keys(SLOTS)) {
    const samplesBySource = new Map(PREMIUM_PROJECTION_SOURCES.map((source) => [source, []]));
    const blendSamples = [];
    for (const archive of eligibleArchives) {
      const actual = actualByWeek.get(archive.week);
      if (!actual) continue;
      const recencyWeight = recencyDecay ** Math.max(0, targetWeek - archive.week - 1);
      for (const player of archive.players || []) {
        if (player.auditEligible === false) continue;
        if (player.position !== position || !actual.has(player.playerId)) continue;
        if (finite(player.points)) blendSamples.push({ week: archive.week, value: Math.abs(player.points - actual.get(player.playerId)), weight: recencyWeight });
        for (const source of player.sources || []) {
          if (source.basis !== "DIRECT_WEEKLY" || !samplesBySource.has(source.source) || !finite(source.points)) continue;
          samplesBySource.get(source.source).push({ week: archive.week, error: source.points - actual.get(player.playerId), weight: recencyWeight });
        }
      }
    }
    const sourceMetrics = Object.fromEntries(PREMIUM_PROJECTION_SOURCES.map((source) => {
      const samples = samplesBySource.get(source);
      const weightTotal = samples.reduce((sum, sample) => sum + sample.weight, 0);
      const weighted = (selector) => weightTotal ? samples.reduce((sum, sample) => sum + selector(sample) * sample.weight, 0) / weightTotal : null;
      return [source, { source, sampleCount: samples.length, weekCount: new Set(samples.map((sample) => sample.week)).size,
        meanAbsoluteError: round(weighted((sample) => Math.abs(sample.error))), meanError: round(weighted((sample) => sample.error)),
        rootMeanSquaredError: round(weightTotal ? Math.sqrt(weighted((sample) => sample.error ** 2)) : null) }];
    }));
    const observedMae = Object.values(sourceMetrics).map((row) => row.meanAbsoluteError).filter(finite);
    const pooledMae = mean(observedMae);
    const eligible = Object.values(sourceMetrics).filter((row) => row.sampleCount >= minimumSamples && row.weekCount >= minimumWeeks && finite(row.meanAbsoluteError));
    const raw = Object.fromEntries(PREMIUM_PROJECTION_SOURCES.map((source) => {
      const metric = sourceMetrics[source];
      if (!eligible.includes(metric) || !finite(pooledMae)) return [source, baseline[source]];
      const shrunkMae = (metric.meanAbsoluteError * metric.sampleCount + pooledMae * priorStrength) / (metric.sampleCount + priorStrength);
      return [source, baseline[source] * pooledMae / Math.max(0.25, shrunkMae)];
    }));
    const rawTotal = Object.values(raw).reduce((sum, value) => sum + value, 0);
    const canAdapt = eligible.length >= 2;
    const evidenceConfidence = canAdapt ? Math.min(0.75, Math.min(...eligible.map((row) => row.sampleCount / 120), ...eligible.map((row) => row.weekCount / 4))) : 0;
    const provisional = Object.fromEntries(PREMIUM_PROJECTION_SOURCES.map((source) => {
      const target = raw[source] / rawTotal;
      const moved = baseline[source] + (target - baseline[source]) * evidenceConfidence;
      return [source, Math.max(baseline[source] - maxAbsoluteShift, Math.min(baseline[source] + maxAbsoluteShift, moved))];
    }));
    const bounded = { ...provisional };
    for (let iteration = 0; iteration < 8; iteration++) {
      const residual = 1 - Object.values(bounded).reduce((sum, value) => sum + value, 0);
      if (Math.abs(residual) < 1e-10) break;
      const candidates = PREMIUM_PROJECTION_SOURCES.filter((source) => residual > 0
        ? bounded[source] < baseline[source] + maxAbsoluteShift - 1e-10
        : bounded[source] > baseline[source] - maxAbsoluteShift + 1e-10);
      if (!candidates.length) break;
      const share = residual / candidates.length;
      for (const source of candidates) bounded[source] = Math.max(baseline[source] - maxAbsoluteShift, Math.min(baseline[source] + maxAbsoluteShift, bounded[source] + share));
    }
    const weights = Object.fromEntries(PREMIUM_PROJECTION_SOURCES.map((source) => [source, round4(bounded[source])]));
    const uncertaintyWeekCount = new Set(blendSamples.map((sample) => sample.week)).size;
    const uncertaintyActive = blendSamples.length >= minimumSamples && uncertaintyWeekCount >= minimumWeeks;
    const uncertainty = { active: uncertaintyActive, percentile: 0.8, halfWidth: uncertaintyActive ? round(weightedQuantile(blendSamples, 0.8)) : null,
      sampleCount: blendSamples.length, weekCount: uncertaintyWeekCount };
    positions[position] = { active: canAdapt, pooledMae: round(pooledMae), evidenceConfidence: round(evidenceConfidence), weights, uncertainty,
      sources: PREMIUM_PROJECTION_SOURCES.map((source) => ({ ...sourceMetrics[source], baselineWeight: round4(baseline[source]), weight: weights[source], change: round4(weights[source] - baseline[source]), eligible: eligible.includes(sourceMetrics[source]) })) };
  }
  return { schemaVersion: 1, model: "position-specific-walk-forward-v1", targetWeek, trainingCutoffWeek: targetWeek - 1,
    active: Object.values(positions).some((position) => position.active), eligibleArchiveWeeks: eligibleArchives.map((archive) => archive.week).sort((a, b) => a - b),
    safeguards: { minimumSamples, minimumWeeks, priorStrength, recencyDecay, maxAbsoluteShift, maximumEvidenceInfluence: 0.75 }, positions,
    note: "Only finalized actuals from earlier weeks and write-once pregame archives are eligible. Recent weeks receive more weight; estimates are shrunk toward the governed baseline and source movement is capped. Position ranges become empirical 80% absolute-error bands only after the same 30-player, two-week minimum; until then the UI shows the provider envelope, not a claimed prediction interval." };
}

export function checkpointSchedule(plan, checkpoints = [], now = new Date().toISOString()) {
  const roster = [...(plan.lineup?.starters || []), ...(plan.lineup?.bench || [])];
  const kickoffs = roster.map((player) => kickoffAt(player.gameTime, plan.week, plan.season)).filter((value) => Number.isFinite(Date.parse(value))).sort();
  if (!kickoffs.length) return { status: "VERIFY_TIMES", early: null, final: null, note: "Complete kickoff times are required before decision checkpoints can be scheduled." };
  const firstKickoff = kickoffs[0];
  const finalKickoff = kickoffs.filter((kick) => denverDay(kick) === "Sun").sort()[0] || firstKickoff;
  const finalWindowOpens = new Date(Date.parse(finalKickoff) - 18 * HOUR).toISOString();
  const weekRows = checkpoints.filter((row) => row.season === plan.season && row.week === plan.week);
  const earlyCapture = weekRows.find((row) => (row.checkpointType || "EARLY") === "EARLY");
  const finalCapture = weekRows.find((row) => row.checkpointType === "FINAL");
  const statusFor = (capture, opens, deadline) => capture ? "CAPTURED" : Date.parse(now) >= Date.parse(deadline) ? "MISSED" : Date.parse(now) >= Date.parse(opens) ? "DUE" : "UPCOMING";
  return { status: "SCHEDULED", early: { status: statusFor(earlyCapture, "1970-01-01T00:00:00.000Z", firstKickoff), deadline: firstKickoff, capturedAt: earlyCapture?.capturedAt || null },
    final: { status: statusFor(finalCapture, finalWindowOpens, finalKickoff), opensAt: finalWindowOpens, deadline: finalKickoff, capturedAt: finalCapture?.capturedAt || null },
    note: "Update everything once before the first weekly kickoff and again Saturday evening or Sunday morning. Each checkpoint freezes projections, lineup choice, injuries, matchup and game time as they existed then." };
}

export function outcomeReport(checkpoints, records, projectionArchives = []) {
  const chosen = new Map();
  for (const c of checkpoints.slice().sort((a, b) => a.capturedAt.localeCompare(b.capturedAt))) {
    if ((c.checkpointType || "EARLY") === "EARLY" && Date.parse(c.capturedAt) < Date.parse(c.firstKickoff)) chosen.set(`${c.season}|${c.week}`, c);
  }
  const provider = new Map();
  const providerBucket = (source) => {
    if (!provider.has(source)) provider.set(source, { signedErrors: [], decisions: [] });
    return provider.get(source);
  };
  const addPairwise = (players, actual, source) => {
    const groups = new Map();
    for (const player of players) {
      if (player.auditEligible === false || !actual.has(player.playerId)) continue;
      const projected = (player.sources || []).find((row) => row.source === source && row.basis === "DIRECT_WEEKLY")?.points;
      if (!finite(projected)) continue;
      const key = `${player.ownerTeamId || "unowned"}|${player.position}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push({ player, projected, actual: actual.get(player.playerId) });
    }
    for (const rows of groups.values()) for (let left = 0; left < rows.length; left++) for (let right = left + 1; right < rows.length; right++) {
      const a = rows[left], b = rows[right];
      if (a.projected === b.projected || a.actual === b.actual) continue;
      const chosenRow = a.projected > b.projected ? a : b;
      const otherRow = chosenRow === a ? b : a;
      providerBucket(source).decisions.push({ correct: chosenRow.actual > otherRow.actual,
        regret: Math.max(0, otherRow.actual - chosenRow.actual), material: Math.abs(a.projected - b.projected) >= 2 });
    }
  };
  const weeks = [...chosen.values()].map((c) => {
    const actual = new Map(records.filter((r) => r.kind === "result" && r.week === c.week && r.final === true).map((r) => [r.playerId, r.points]));
    const scored = c.roster.filter((p) => actual.has(p.playerId));
    const errors = scored.filter((p) => finite(p.points)).map((p) => Math.abs(p.points - actual.get(p.playerId)));
    const complete = scored.length === c.roster.length;
    const starters = c.roster.filter((p) => p.starter);
    const legal = Object.entries(SLOTS).every(([pos, n]) => starters.filter((p) => p.position === pos).length === n);
    const selected = complete && legal ? starters.reduce((n, p) => n + actual.get(p.playerId), 0) : null;
    const best = complete && legal ? Object.entries(SLOTS).reduce((n, [pos, count]) => n + c.roster.filter((p) => p.position === pos).map((p) => actual.get(p.playerId)).sort((a, b) => b - a).slice(0, count).reduce((a, b) => a + b, 0), 0) : null;
    const lineupRegrets = complete && legal ? Object.entries(SLOTS).flatMap(([position, count]) => {
      const positionRows = c.roster.filter((player) => player.position === position).sort((a, b) => actual.get(b.playerId) - actual.get(a.playerId));
      const bestIds = new Set(positionRows.slice(0, count).map((player) => player.playerId));
      const selectedIds = new Set(starters.filter((player) => player.position === position).map((player) => player.playerId));
      const outgoing = positionRows.filter((player) => selectedIds.has(player.playerId) && !bestIds.has(player.playerId)).sort((a, b) => actual.get(a.playerId) - actual.get(b.playerId));
      const incoming = positionRows.filter((player) => bestIds.has(player.playerId) && !selectedIds.has(player.playerId)).sort((a, b) => actual.get(b.playerId) - actual.get(a.playerId));
      return incoming.map((player, index) => ({ position, start: player.name, sit: outgoing[index]?.name || "Unknown starter",
        startActual: actual.get(player.playerId), sitActual: outgoing[index] ? actual.get(outgoing[index].playerId) : null,
        pointsGained: outgoing[index] ? round(actual.get(player.playerId) - actual.get(outgoing[index].playerId)) : null }));
    }).filter((row) => finite(row.pointsGained) && row.pointsGained > 0) : [];
    return { week: c.week, capturedAt: c.capturedAt, observedPlayers: scored.length, rosterPlayers: c.roster.length, meanAbsoluteError: round(mean(errors)), recommendedActualTotal: round(selected), hindsightGap: best === null ? null : round(best - selected), lineupRegrets };
  });
  const playerAudits = [];
  const projectionWeeks = projectionArchives.slice().sort((a, b) => a.week - b.week).map((archive) => {
    const actual = new Map(records.filter((row) => row.kind === "result" && row.season === archive.season && row.week === archive.week && row.final === true).map((row) => [row.playerId, row.points]));
    const scored = archive.players.filter((player) => actual.has(player.playerId));
    const eligibleScored = scored.filter((player) => player.auditEligible === true || archive.auditEligible && player.auditEligible !== false);
    const eligiblePlayerCount = (archive.players || []).filter((player) => player.auditEligible === true || archive.auditEligible && player.auditEligible !== false).length;
    if (eligibleScored.length) for (const player of eligibleScored) playerAudits.push({
      week: archive.week, playerId: player.playerId, name: player.name, position: player.position,
      projected: player.points, actual: actual.get(player.playerId), absoluteError: round(Math.abs(player.points - actual.get(player.playerId))),
      providers: (player.sources || []).filter((source) => source.basis === "DIRECT_WEEKLY").map((source) => ({ source: source.source, projected: source.points, absoluteError: round(Math.abs(source.points - actual.get(player.playerId))) })),
    });
    if (eligibleScored.length) for (const player of eligibleScored) for (const source of player.sources || []) {
      if (source.basis !== "DIRECT_WEEKLY" || !finite(source.points)) continue;
      providerBucket(source.source).signedErrors.push(source.points - actual.get(player.playerId));
    }
    if (eligibleScored.length) for (const source of PREMIUM_PROJECTION_SOURCES) addPairwise(eligibleScored, actual, source);
    const blendErrors = eligibleScored.map((player) => Math.abs(player.points - actual.get(player.playerId)));
    return { week: archive.week, capturedAt: archive.capturedAt, firstKickoff: archive.firstKickoff, auditEligible: archive.auditEligible,
      auditEligiblePlayers: eligiblePlayerCount, projectedPlayers: archive.players.length, observedPlayers: eligibleScored.length, meanAbsoluteError: round(mean(blendErrors)) };
  });
  // Older installations can still calculate provider error from their roster-only checkpoints.
  if (!projectionArchives.some((archive) => archive.auditEligible || (archive.players || []).some((player) => player.auditEligible === true))) for (const c of chosen.values()) {
    const actual = new Map(records.filter((row) => row.kind === "result" && row.week === c.week && row.final === true).map((row) => [row.playerId, row.points]));
    for (const player of c.roster.filter((row) => actual.has(row.playerId))) for (const source of player.sources || []) {
      if (source.basis !== "DIRECT_WEEKLY" || !finite(source.points)) continue;
      providerBucket(source.source).signedErrors.push(source.points - actual.get(player.playerId));
    }
    for (const source of PREMIUM_PROJECTION_SOURCES) addPairwise(c.roster, actual, source);
  }
  const providers = [...provider].map(([source, metrics]) => ({
    source,
    sampleCount: metrics.signedErrors.length,
    meanAbsoluteError: round(mean(metrics.signedErrors.map(Math.abs))),
    meanError: round(mean(metrics.signedErrors)),
    rootMeanSquaredError: round(Math.sqrt(mean(metrics.signedErrors.map((error) => error ** 2)))),
    decisionCount: metrics.decisions.length,
    decisionAccuracy: round(mean(metrics.decisions.map((row) => Number(row.correct)))),
    materialDecisionCount: metrics.decisions.filter((row) => row.material).length,
    materialDecisionAccuracy: round(mean(metrics.decisions.filter((row) => row.material).map((row) => Number(row.correct)))),
    meanDecisionRegret: round(mean(metrics.decisions.map((row) => row.regret))),
    calibrationReady: metrics.signedErrors.length >= 30,
  })).sort((a, b) => a.meanAbsoluteError - b.meanAbsoluteError || a.source.localeCompare(b.source)).map((row, index) => ({ ...row, rank: index + 1 }));
  return { weeks: weeks.sort((a, b) => b.week - a.week), projectionWeeks: projectionWeeks.sort((a, b) => b.week - a.week), providers,
    lineupRegrets: weeks.flatMap((week) => week.lineupRegrets.map((row) => ({ week: week.week, ...row }))),
    playerAudits: playerAudits.sort((a, b) => b.week - a.week || b.absoluteError - a.absoluteError || a.name.localeCompare(b.name)),
    note: "Weekly player and provider projections, matchup, kickoff and injury state are frozen before games and never rewritten. Accuracy uses finalized Thunder Bowl actuals only; missing scores never count as zero, and post-kickoff player rows are excluded. Provider rank is descriptive until the governed sample threshold is met. Pairwise accuracy asks whether a provider ranked same-position roster alternatives correctly; regret measures points lost by following that ranking. Hindsight gap is not a claim you could have known the best lineup." };
}

export function buildManagement(plan, { records = [], checkpoints = [], projectionArchives = [], now = new Date().toISOString() } = {}) {
  const gameDay = buildGameDay(plan, now);
  const market = waiverMarket(plan, records);
  const checkpointsDue = checkpointSchedule(plan, checkpoints, now);
  const actions = [];
  const audit = (plan.sourceAudit || []).map((s) => ({ ...s, status: s.retrievedAt && Date.parse(now) - Date.parse(s.retrievedAt) > 48 * HOUR && s.status === "RECENT_CAPTURE" ? "STALE" : s.status }));
  const gaps = audit.filter((s) => s.status !== "RECENT_CAPTURE");
  if (gaps.length) actions.push({ priority: 1, title: "Refresh incomplete projection evidence", detail: gaps.map((s) => `${s.source}: ${s.status.replaceAll("_", " ").toLowerCase()}`).join("; "), tab: "admin" });
  if (checkpointsDue.early?.status === "DUE") actions.push({ priority: 1, title: "Freeze the early-game checkpoint", detail: `Run Update everything before ${checkpointsDue.early.deadline}.`, tab: "admin" });
  if (checkpointsDue.final?.status === "DUE") actions.push({ priority: 1, title: "Freeze the Sunday-morning checkpoint", detail: `Run Update everything before ${checkpointsDue.final.deadline}.`, tab: "admin" });
  if (checkpointsDue.early?.status === "MISSED" || checkpointsDue.final?.status === "MISSED") actions.push({ priority: 2, title: "A weekly decision checkpoint was missed", detail: "Post-kickoff data will not be relabeled as pregame evidence. Complete both update checkpoints next week.", tab: "admin" });
  if (!gameDay.submittedKnown) actions.push({ priority: 2, title: "Verify the submitted CBS lineup", detail: "Recommended starters are not confirmation of the lineup saved at CBS.", tab: "scoring-preview" });
  for (const change of gameDay.changes) if (change.status !== "OPTIONAL") actions.push({ priority: 2, title: `${change.incoming} / ${change.outgoing}`, detail: change.reason, tab: "start-sit" });
  for (const p of gameDay.rows.filter((p) => p.injury?.status && !/^(active|healthy)$/i.test(p.injury.status))) actions.push({ priority: 3, title: `Check ${p.name}: ${p.injury.status}`, detail: `${p.status === "LOCKED" ? "Kickoff has passed; do not assume a swap remains legal." : "Recheck official status before the earlier of starter and backup kickoffs."}`, tab: "start-sit" });
  const nextLock = gameDay.rows.filter((p) => p.kickoffAt && p.status === "OPEN").sort((a, b) => a.kickoffAt.localeCompare(b.kickoffAt))[0];
  if (nextLock && Date.parse(nextLock.kickoffAt) - Date.parse(now) <= 24 * HOUR) actions.push({ priority: 3, title: `${nextLock.name}: next starter kickoff`, detail: `Kickoff ${nextLock.kickoffAt}. Check the game-day backup plan and CBS lock state before then.`, tab: "start-sit" });
  const players = new Map(plan.playerStats.map((p) => [p.playerId, p]));
  const user = plan.league.teams.find((t) => t.teamId === plan.league.userTeamId);
  const selectedTeam = plan.league.teams.find((t) => t.teamId === plan.lineup.teamId);
  const fit = rosterFit(user?.roster || [], players, plan.week);
  const selectedFit = rosterFit(selectedTeam?.roster || [], players, plan.week);
  if (gameDay.verdict === "INCOMPLETE") actions.push({ priority: 1, title: "A complete recommended lineup is unavailable", detail: "One or more required starters are missing or ineligible. Do not treat this as a keep-lineup recommendation.", tab: "start-sit" });
  for (const gap of selectedFit.byeGaps.filter((r) => r.week <= plan.week + 2)) actions.push({ priority: 4, title: `${plan.lineup.teamName} Week ${gap.week}: ${gap.position} coverage gap`, detail: `${gap.missing} starting slot(s) lack healthy/non-bye coverage. Plan ahead without sacrificing useful depth.`, tab: "waivers" });
  if (market.chain.length && plan.lineup.teamId === plan.league.userTeamId) actions.push({ priority: 5, title: `Review ${market.chain[0].name} waiver claim`, detail: `Suggested $${market.chain[0].recommended}; hard ceiling $${market.chain[0].maximum}. Use the conditional fallback chain, not all claims together.`, tab: "waivers" });
  if (!actions.length) actions.push({ priority: 9, title: "No material changes recommended", detail: "Keep the current lineup and preserve FAB/depth. Recheck status before kickoff; this is not a guarantee against later news.", tab: "start-sit" });
  const tradeFit = (plan.trades.recommendations || []).map((idea) => {
    const rival = plan.league.teams.find((t) => t.teamId === idea.rival.teamId);
    const sent = new Set(idea.sends.map((p) => p.playerId));
    const received = new Set(idea.receives.map((p) => p.playerId));
    const afterDogs = (user?.roster || []).filter((p) => !sent.has(p.playerId)).concat(idea.receives);
    const afterRival = (rival?.roster || []).filter((p) => !received.has(p.playerId)).concat(idea.sends);
    return { rival: idea.rival.teamName, sends: idea.sends.map((p) => p.name), receives: idea.receives.map((p) => p.name),
      dogsBefore: fit, dogsAfter: rosterFit(afterDogs, players, plan.week),
      rivalBefore: rosterFit(rival?.roster || [], players, plan.week), rivalAfter: rosterFit(afterRival, players, plan.week) };
  });
  return { schemaVersion: 1, asOf: now, sourceAudit: audit, actions: actions.sort((a, b) => a.priority - b.priority), gameDay, waiverMarket: market, tradeFit,
    workload: workloadTrends(records, plan.playerStats, plan.week),
    teamFit: plan.league.teams.map((t) => ({ teamId: t.teamId, teamName: t.teamName, ...rosterFit(t.roster, players, plan.week) })),
    stash: stashComparison({ ...plan, managementAsOf: now }, records), checkpoints: checkpointsDue, outcomes: outcomeReport(checkpoints, records, projectionArchives),
    confidenceNote: "Source agreement is a heuristic, not a success probability. Ranges are empirical position error bands only after 30 completed player-games across two weeks; before then they are provider envelopes, not prediction intervals." };
}
