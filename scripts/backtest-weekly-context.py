#!/usr/bin/env python3
"""Time-forward test of the weekly context redistributor with no target-season leakage.

The test gives both models the same realized season total, then asks only whether the
preseason-available context model distributes those points across weeks more accurately
than a flat per-game baseline. Training rows always precede the scored season.
"""
from __future__ import annotations

import csv
import json
import math
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = Path(r"C:\Users\mailp\Dropbox\Personal\FAMILY STUFF\Mike Stuff\Fantasy Football\_AGENT_HANDOFF\data\player_week_context.csv")
REPORT_JSON = ROOT / "reports" / "weekly-context-time-forward-backtest.json"
REPORT_MD = ROOT / "reports" / "weekly-context-time-forward-backtest.md"
POSITIONS = ("QB", "RB", "WR", "TE")
TARGET_SEASONS = tuple(range(2018, 2026))
SHRINK_K = 10
FACTOR_LOW, FACTOR_HIGH = 0.88, 1.12
PRODUCT_LOW, PRODUCT_HIGH = 0.75, 1.25


def number(value, default=None):
    try:
        result = float(value)
        return result if math.isfinite(result) else default
    except (TypeError, ValueError):
        return default


def integer(value, default=0):
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return default


def clip(value, low, high):
    return max(low, min(high, value))


def load_rows():
    rows = []
    with SOURCE.open(encoding="utf-8", errors="replace") as handle:
        for raw in csv.DictReader(handle):
            season = integer(raw.get("season"))
            points = number(raw.get("tb_points"))
            pos = raw.get("pos")
            player_id = raw.get("gsis_id")
            team = raw.get("team")
            opponent = raw.get("opp")
            if season < 2010 or points is None or pos not in POSITIONS or not player_id or not team or not opponent:
                continue
            home = integer(raw.get("home")) == 1
            home_team = team if home else opponent
            rows.append({
                "season": season,
                "week": integer(raw.get("week")),
                "player_id": player_id,
                "name": raw.get("name") or player_id,
                "pos": pos,
                "team": team,
                "opponent": opponent,
                "points": points,
                "home": home,
                "indoor": integer(raw.get("indoor")) == 1,
                "cold": integer(raw.get("cold")) == 1,
                "thursday": integer(raw.get("is_thu")) == 1,
                "month": integer(raw.get("month")),
                "home_team": home_team,
            })
    return rows


def split_stats(training):
    stats = defaultdict(lambda: defaultdict(lambda: [0.0, 0]))
    for row in training:
        player = stats[row["player_id"]]
        keys = ["all", "home" if row["home"] else "away", "dome" if row["indoor"] else "outdoor"]
        if row["thursday"]:
            keys.append("thu")
        if row["cold"] and not row["indoor"]:
            keys.append("cold")
        for key in keys:
            player[key][0] += row["points"]
            player[key][1] += 1
    return stats


def split_factor(stats, player_id, key):
    player = stats.get(player_id)
    if not player or player["all"][1] < 4 or key not in player or player[key][1] < 3:
        return None
    overall = player["all"][0] / player["all"][1]
    if overall <= 0:
        return None
    sample_sum, sample_n = player[key]
    ratio = (sample_sum / sample_n) / overall
    return clip(1 + sample_n / (sample_n + SHRINK_K) * (ratio - 1), FACTOR_LOW, FACTOR_HIGH)


def defense_factors(training, prior_season):
    totals = defaultdict(float)
    games = defaultdict(set)
    for row in training:
        if row["season"] != prior_season:
            continue
        key = (row["opponent"], row["pos"])
        totals[key] += row["points"]
        games[row["opponent"]].add(row["week"])
    per_game = {key: total / max(1, len(games[key[0]])) for key, total in totals.items()}
    averages = {}
    for pos in POSITIONS:
        values = [value for (team, row_pos), value in per_game.items() if row_pos == pos]
        averages[pos] = sum(values) / len(values) if values else 1.0
    return per_game, averages


def cold_climatology(training):
    games = {}
    for row in training:
        if row["indoor"] or not row["month"]:
            continue
        key = (row["season"], row["week"], row["home_team"])
        games[key] = (row["home_team"], row["month"], row["cold"])
    counts = defaultdict(lambda: [0, 0])
    for home_team, month, cold in games.values():
        counts[(home_team, month)][0] += int(cold)
        counts[(home_team, month)][1] += 1
    return counts


def context_factor(row, stats, defense, league_average, climatology, feature_set):
    factor = 1.0
    if "personal" in feature_set:
        venue = split_factor(stats, row["player_id"], "dome" if row["indoor"] else "outdoor")
        if venue is not None:
            factor *= venue
        home_away = split_factor(stats, row["player_id"], "home" if row["home"] else "away")
        if home_away is not None:
            factor *= home_away
        if row["thursday"]:
            short = split_factor(stats, row["player_id"], "thu")
            if short is not None:
                factor *= short
        if not row["indoor"]:
            cold = split_factor(stats, row["player_id"], "cold")
            count = climatology.get((row["home_team"], row["month"]), [0, 0])
            probability = count[0] / count[1] if count[1] >= 3 else 0.0
            if cold is not None and probability > 0:
                factor *= 1 + probability * (cold - 1)
    if "matchup" in feature_set:
        allowed = defense.get((row["opponent"], row["pos"]))
        average = league_average.get(row["pos"], 0)
        if allowed is not None and average > 0:
            factor *= clip(allowed / average, FACTOR_LOW, FACTOR_HIGH)
    return clip(factor, PRODUCT_LOW, PRODUCT_HIGH)


def score_model(rows, factors):
    actual = [row["points"] for row in rows]
    season_mean = sum(actual) / len(actual)
    normalizer = sum(factors) / len(factors) if factors else 1.0
    flat_errors = [abs(value - season_mean) for value in actual]
    context_errors = [abs(value - season_mean * factor / normalizer) for value, factor in zip(actual, factors)]
    return flat_errors, context_errors


def rounded(value, digits=4):
    return round(value, digits)


def summarize(errors):
    return {
        "rows": len(errors),
        "mae": rounded(sum(errors) / len(errors)) if errors else None,
    }


def run():
    rows = load_rows()
    challengers = {
        "matchup_only": {"matchup"},
        "personal_only": {"personal"},
        "full_context": {"matchup", "personal"},
    }
    result = {name: {"flat": [], "context": [], "bySeason": {}, "byPosition": defaultdict(lambda: {"flat": [], "context": []})} for name in challengers}
    for season in TARGET_SEASONS:
        training = [row for row in rows if row["season"] < season]
        target = [row for row in rows if row["season"] == season]
        stats = split_stats(training)
        defense, league_average = defense_factors(training, season - 1)
        climatology = cold_climatology(training)
        groups = defaultdict(list)
        for row in target:
            groups[(row["player_id"], row["pos"])].append(row)
        for name, feature_set in challengers.items():
            season_flat, season_context = [], []
            for (player_id, pos), player_rows in groups.items():
                if len(player_rows) < 8 or stats.get(player_id, {}).get("all", [0, 0])[1] < 4:
                    continue
                factors = [context_factor(row, stats, defense, league_average, climatology, feature_set) for row in player_rows]
                flat, context = score_model(player_rows, factors)
                season_flat.extend(flat)
                season_context.extend(context)
                result[name]["flat"].extend(flat)
                result[name]["context"].extend(context)
                result[name]["byPosition"][pos]["flat"].extend(flat)
                result[name]["byPosition"][pos]["context"].extend(context)
            flat_summary = summarize(season_flat)
            context_summary = summarize(season_context)
            result[name]["bySeason"][str(season)] = {
                "rows": flat_summary["rows"],
                "flatMae": flat_summary["mae"],
                "contextMae": context_summary["mae"],
                "maeChange": rounded(context_summary["mae"] - flat_summary["mae"]) if season_flat else None,
            }

    models = {}
    for name, rows_by_model in result.items():
        flat = summarize(rows_by_model["flat"])
        context = summarize(rows_by_model["context"])
        by_position = {}
        for pos in POSITIONS:
            pos_flat = summarize(rows_by_model["byPosition"][pos]["flat"])
            pos_context = summarize(rows_by_model["byPosition"][pos]["context"])
            by_position[pos] = {
                "rows": pos_flat["rows"],
                "flatMae": pos_flat["mae"],
                "contextMae": pos_context["mae"],
                "maeChange": rounded(pos_context["mae"] - pos_flat["mae"]) if pos_flat["rows"] else None,
            }
        season_wins = sum(1 for row in rows_by_model["bySeason"].values() if row["maeChange"] is not None and row["maeChange"] < 0)
        position_wins = sum(1 for row in by_position.values() if row["maeChange"] is not None and row["maeChange"] < 0)
        models[name] = {
            "rows": flat["rows"],
            "flatMae": flat["mae"],
            "contextMae": context["mae"],
            "maeChange": rounded(context["mae"] - flat["mae"]),
            "maeChangePercent": rounded((context["mae"] / flat["mae"] - 1) * 100, 3),
            "seasonWins": season_wins,
            "seasonFolds": len(TARGET_SEASONS),
            "positionWins": position_wins,
            "positionFolds": len(POSITIONS),
            "bySeason": rows_by_model["bySeason"],
            "byPosition": by_position,
        }
    champion = min(models, key=lambda name: models[name]["contextMae"])
    champion_row = models[champion]
    promoted = champion_row["maeChange"] < 0 and champion_row["seasonWins"] >= 6 and champion_row["positionWins"] == 4
    report = {
        "schemaVersion": 1,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "source": str(SOURCE),
        "targetSeasons": list(TARGET_SEASONS),
        "method": "Time-forward weekly-shape test. Both models receive the same realized player-season total; only preseason-available prior-season/prior-career context may redistribute it.",
        "models": models,
        "champion": champion,
        "promotionGate": {
            "passed": promoted,
            "rule": "Lower aggregate MAE, wins at least 6/8 seasons, and improves all four positions.",
        },
    }
    REPORT_JSON.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    lines = [
        "# Weekly context time-forward backtest",
        "",
        report["method"],
        "",
        "| Challenger | Rows | Flat MAE | Context MAE | Change | Season wins | Position wins |",
        "|---|---:|---:|---:|---:|---:|---:|",
    ]
    for name, row in models.items():
        lines.append(f"| {name} | {row['rows']:,} | {row['flatMae']:.4f} | {row['contextMae']:.4f} | {row['maeChange']:+.4f} ({row['maeChangePercent']:+.3f}%) | {row['seasonWins']}/8 | {row['positionWins']}/4 |")
    lines.extend([
        "",
        f"Champion: **{champion}**. Promotion gate: **{'PASS' if promoted else 'HOLD'}**.",
        "",
        "The realized season total is used only to isolate weekly-shape accuracy; it does not make this a season-total projection backtest.",
    ])
    REPORT_MD.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(json.dumps({"champion": champion, "promotionGate": report["promotionGate"], "models": models}, indent=2))


if __name__ == "__main__":
    run()
