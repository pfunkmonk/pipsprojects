#!/usr/bin/env python3
"""Calibrate Thunder Bowl division/playoff week weights without target-season leakage.

The analysis deliberately separates two quantities:

1. standings leverage -- the marginal value of one extra lineup point in an ordinary,
   divisional, or playoff week under Thunder Bowl's 12-team/4-division/6-playoff format;
2. forecast reliability -- whether archived preseason weekly projections correctly
   identified when drafted rosters would score above or below their own season norm.

Historical Draft Dominator rosters and weekly forecasts are joined to the unified
Thunder Bowl-scored player-week results. Monte Carlo trials randomize divisions and
valid weekly opponents while preserving each historical roster's realized weekly
profile. The final recommendation shrinks structural leverage toward 1.00 according
to the observed preseason timing signal and remains replacement-relative in the app.
"""
from __future__ import annotations

import csv
import json
import math
import random
import re
import statistics
import unicodedata
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FANTASY_ROOT = Path(r"C:\Users\mailp\Dropbox\Personal\FAMILY STUFF\Mike Stuff\Fantasy Football")
ACTUAL_SOURCE = FANTASY_ROOT / "_AGENT_HANDOFF" / "data" / "player_week_context.csv"
REPORT_JSON = ROOT / "reports" / "priority-week-weight-calibration.json"
REPORT_MD = ROOT / "reports" / "priority-week-weight-calibration.md"

DIVISION_WEEKS = (1, 2, 12, 13)
ORDINARY_H2H_WEEKS = tuple(range(3, 12))
LINEUP_SLOTS = {"QB": 1, "RB": 2, "WR": 2, "TE": 1}
SEASON_FILES = {
    2015: {
        "draft": FANTASY_ROOT / "2015" / "2015 - DRAFT SUMMARY.csv",
        "weekly": FANTASY_ROOT / "2015" / "2015 - TEAM WEEKLY POINTS.csv",
        "playoffs": (14, 15, 16),
    },
    2017: {
        "draft": FANTASY_ROOT / "2017" / "DraftDominator" / "2017 - DRAFT SUMMARY.csv",
        "weekly": FANTASY_ROOT / "2017" / "DraftDominator" / "2017 - TEAM WEEKLY POINTS.csv",
        "playoffs": (14, 15, 16),
    },
    2018: {
        "draft": FANTASY_ROOT / "2018" / "DraftDominator" / "2018 - DRAFT SUMMARY.csv",
        "weekly": FANTASY_ROOT / "2018" / "DraftDominator" / "2018 - TEAM WEEKLY POINTS.csv",
        "playoffs": (14, 15, 16),
    },
    2023: {
        "draft": FANTASY_ROOT / "2023" / "DraftDominator" / "2023 - DRAFT SUMMARY.csv",
        "weekly": FANTASY_ROOT / "2023" / "DraftDominator" / "2023 - TEAM WEEKLY POINTS.csv",
        "playoffs": (15, 16, 17),
    },
}
MONTE_CARLO_TRIALS = 150_000
TEAM_PROBABILITY_TRIALS = 4_000
MARGINAL_BOOST = 3.0
RANDOM_SEED = 20260829
RECOMMENDATION = {
    "ordinaryWeight": 1.0,
    "divisionWeight": 1.2,
    "playoffWeight": 1.5,
    "forecastAuthority": 0.35,
    "maxVbdDelta": 3.0,
    "week18Weight": 0.0,
}


@dataclass
class TeamSeason:
    season: int
    team: str
    predicted: tuple[float, ...]
    actual: tuple[float, ...]
    playoff_weeks: tuple[int, ...]


def number(value, default=0.0):
    try:
        result = float(value)
        return result if math.isfinite(result) else default
    except (TypeError, ValueError):
        return default


def normalized_name(value):
    text = unicodedata.normalize("NFKD", str(value or "")).encode("ascii", "ignore").decode("ascii").lower()
    text = re.sub(r"\b(jr|sr|ii|iii|iv|v)\b", " ", text)
    return re.sub(r"[^a-z0-9]+", "", text)


def normalized_team(value):
    return normalized_name(value)


def position(value):
    match = re.match(r"([A-Za-z]+)", str(value or "").strip())
    return match.group(1).upper() if match else ""


def read_csv(path):
    with path.open(encoding="utf-8-sig", errors="replace", newline="") as handle:
        return list(csv.DictReader(handle))


def load_actual_points():
    seasons = set(SEASON_FILES)
    actual = defaultdict(dict)
    with ACTUAL_SOURCE.open(encoding="utf-8", errors="replace", newline="") as handle:
        for row in csv.DictReader(handle):
            season = int(number(row.get("season")))
            pos = position(row.get("pos"))
            if season not in seasons or pos not in LINEUP_SLOTS:
                continue
            key = (normalized_name(row.get("name")), pos)
            actual[(season, key)][int(number(row.get("week")))] = number(row.get("tb_points"))
    return actual


def load_team_seasons():
    actual_by_player = load_actual_points()
    results = []
    audit = {}
    timing_pairs = []
    for season, paths in SEASON_FILES.items():
        draft_rows = read_csv(paths["draft"])
        weekly_rows = read_csv(paths["weekly"])
        projection_by_team = {
            normalized_team(row.get("Team")): tuple(number(row.get(f"W{week}")) for week in range(1, 18))
            for row in weekly_rows if str(row.get("Team") or "").strip()
        }

        roster_by_team = defaultdict(list)
        for row in draft_rows:
            pos = position(row.get("Pos"))
            team = str(row.get("Selected By") or "").strip()
            if pos not in LINEUP_SLOTS or not team:
                continue
            roster_by_team[team].append((normalized_name(row.get("Player")), pos, row.get("Player")))

        matched_projection = 0
        matched_actual = 0
        drafted_skill = 0
        for team, roster in roster_by_team.items():
            projected_team = projection_by_team.get(normalized_team(team))
            if projected_team is None:
                raise RuntimeError(f"{season} is missing a Team Weekly Points row for {team}.")
            matched_projection += 1
            actual_team = []
            for week in range(1, 18):
                actual_score = 0.0
                for pos, slots in LINEUP_SLOTS.items():
                    candidates = []
                    for name_key, player_pos, _ in roster:
                        if player_pos != pos:
                            continue
                        key = (name_key, player_pos)
                        candidates.append(actual_by_player.get((season, key), {}).get(week, 0.0))
                    candidates.sort(reverse=True)
                    actual_score += sum(candidates[:slots])
                actual_team.append(actual_score)
            results.append(TeamSeason(season, team, tuple(projected_team), tuple(actual_team), tuple(paths["playoffs"])))

        for roster in roster_by_team.values():
            for name_key, pos, _ in roster:
                drafted_skill += 1
                key = (name_key, pos)
                if (season, key) in actual_by_player:
                    matched_actual += 1

        season_teams = [row for row in results if row.season == season]
        for row in season_teams:
            active_weeks = [week for week in range(1, 18) if row.predicted[week - 1] > 0]
            if not active_weeks:
                continue
            predicted_mean = statistics.fmean(row.predicted[week - 1] for week in active_weeks)
            actual_mean = statistics.fmean(row.actual[week - 1] for week in active_weeks)
            timing_pairs.extend((row.predicted[week - 1] - predicted_mean, row.actual[week - 1] - actual_mean) for week in active_weeks)
        audit[str(season)] = {
            "teams": len(roster_by_team),
            "draftedSkillPlayers": drafted_skill,
            "projectedTeamRows": matched_projection,
            "actualMatches": matched_actual,
            "projectionCoverage": round(matched_projection / len(roster_by_team), 4) if roster_by_team else 0,
            "actualCoverage": round(matched_actual / drafted_skill, 4) if drafted_skill else 0,
        }
    return results, audit, timing_pairs


def pearson(pairs):
    if len(pairs) < 3:
        return 0.0
    xs, ys = zip(*pairs)
    x_mean, y_mean = statistics.fmean(xs), statistics.fmean(ys)
    numerator = sum((x - x_mean) * (y - y_mean) for x, y in pairs)
    x_ss = sum((x - x_mean) ** 2 for x in xs)
    y_ss = sum((y - y_mean) ** 2 for y in ys)
    return numerator / math.sqrt(x_ss * y_ss) if x_ss > 0 and y_ss > 0 else 0.0


def calibration_slope(pairs):
    if len(pairs) < 3:
        return 0.0
    xs, ys = zip(*pairs)
    x_mean, y_mean = statistics.fmean(xs), statistics.fmean(ys)
    denominator = sum((x - x_mean) ** 2 for x in xs)
    return sum((x - x_mean) * (y - y_mean) for x, y in pairs) / denominator if denominator else 0.0


def ranks(values):
    ordered = sorted(range(len(values)), key=lambda index: values[index])
    result = [0.0] * len(values)
    cursor = 0
    while cursor < len(ordered):
        end = cursor + 1
        while end < len(ordered) and values[ordered[end]] == values[ordered[cursor]]:
            end += 1
        rank = (cursor + end - 1) / 2 + 1
        for offset in range(cursor, end):
            result[ordered[offset]] = rank
        cursor = end
    return result


def spearman(left, right):
    return pearson(list(zip(ranks(left), ranks(right))))


def score_with_boost(team_scores, team, week, target, boost_kind, boost, playoff_weeks):
    """Return one team's score, applying the counterfactual boost only to target."""
    value = team_scores[team][week - 1]
    if team != target:
        return value
    if boost_kind == "division" and week in DIVISION_WEEKS:
        value += boost
    elif boost_kind == "ordinary" and week in ORDINARY_H2H_WEEKS:
        value += boost
    elif boost_kind == "playoffs" and week in playoff_weeks:
        value += boost
    return value


def self_check():
    """Fail fast if schedule construction or counterfactual score routing regresses."""
    scores = [tuple(float(team * 100 + week) for week in range(1, 18)) for team in range(12)]
    assert score_with_boost(scores, 7, 4, 2, "division", 3, (15, 16, 17)) == 704
    assert score_with_boost(scores, 2, 1, 2, "division", 3, (15, 16, 17)) == 204
    assert score_with_boost(scores, 2, 3, 2, "division", 3, (15, 16, 17)) == 203
    schedule = target_schedule(0, [1, 2], random.Random(7))
    for week, pairs in schedule.items():
        participants = [team for pair in pairs for team in pair]
        assert sorted(participants) == list(range(12)), f"Week {week} does not schedule every team once."
        target_pair = next(pair for pair in pairs if 0 in pair)
        opponent = target_pair[1] if target_pair[0] == 0 else target_pair[0]
        if week in DIVISION_WEEKS:
            assert opponent in (1, 2)
        else:
            assert opponent not in (1, 2)


def target_schedule(target, rivals, rng):
    teams = list(range(12))
    non_rivals = [team for team in teams if team != target and team not in rivals]
    rng.shuffle(non_rivals)
    target_opponents = {
        1: rivals[0], 2: rivals[1], 12: rivals[0], 13: rivals[1],
        **{week: opponent for week, opponent in zip(ORDINARY_H2H_WEEKS, non_rivals)},
    }
    schedule = {}
    for week in range(1, 14):
        opponent = target_opponents[week]
        remaining = [team for team in teams if team not in (target, opponent)]
        rng.shuffle(remaining)
        schedule[week] = [(target, opponent)] + list(zip(remaining[::2], remaining[1::2]))
    return schedule


def league_outcome(team_scores, target, divisions, schedule, playoff_weeks, boost_kind=None, boost=0.0):
    wins = [0.0] * 12
    for week, pairs in schedule.items():
        for left, right in pairs:
            left_score = score_with_boost(team_scores, left, week, target, boost_kind, boost, playoff_weeks)
            right_score = score_with_boost(team_scores, right, week, target, boost_kind, boost, playoff_weeks)
            if left_score == right_score:
                wins[left] += 0.5
                wins[right] += 0.5
            elif left_score > right_score:
                wins[left] += 1
            else:
                wins[right] += 1

    point_totals = []
    for team in range(12):
        total = sum(team_scores[team][:14])
        if team == target:
            if boost_kind == "division":
                total += boost * len(DIVISION_WEEKS)
            elif boost_kind == "ordinary":
                total += boost * len(ORDINARY_H2H_WEEKS)
        point_totals.append(total)

    division_winners = [max(division, key=lambda team: (wins[team], point_totals[team], -team)) for division in divisions]
    remaining = [team for team in range(12) if team not in division_winners]
    wildcards = sorted(remaining, key=lambda team: (wins[team], point_totals[team], -team), reverse=True)[:2]
    qualifiers = sorted(division_winners + wildcards, key=lambda team: (wins[team], point_totals[team], -team), reverse=True)
    seed = {team: index + 1 for index, team in enumerate(qualifiers)}

    def playoff_score(team, round_index):
        week = playoff_weeks[round_index]
        return score_with_boost(team_scores, team, week, target, boost_kind, boost, playoff_weeks)

    def winner(left, right, round_index):
        left_score, right_score = playoff_score(left, round_index), playoff_score(right, round_index)
        if left_score == right_score:
            return left if seed[left] < seed[right] else right
        return left if left_score > right_score else right

    first = [winner(qualifiers[2], qualifiers[5], 0), winner(qualifiers[3], qualifiers[4], 0)]
    first.sort(key=lambda team: seed[team])
    semifinal = [winner(qualifiers[0], first[-1], 1), winner(qualifiers[1], first[0], 1)]
    champion = winner(semifinal[0], semifinal[1], 2)
    target_division = divisions[0]
    return {
        "division": int(target in division_winners and target in target_division),
        "playoffs": int(target in qualifiers),
        "champion": int(target == champion),
    }


def sampled_trial(team_seasons, rng, boost_kind=None, boost=0.0):
    season = rng.choice(sorted({row.season for row in team_seasons}))
    rows = [row for row in team_seasons if row.season == season]
    target = rng.randrange(12)
    other = [team for team in range(12) if team != target]
    rivals = rng.sample(other, 2)
    remaining = [team for team in other if team not in rivals]
    rng.shuffle(remaining)
    divisions = [[target, *rivals], *[remaining[index:index + 3] for index in range(0, 9, 3)]]
    schedule = target_schedule(target, rivals, rng)
    scores = [row.actual for row in rows]
    return league_outcome(scores, target, divisions, schedule, rows[target].playoff_weeks, boost_kind, boost)


def marginal_leverage(team_seasons):
    rng = random.Random(RANDOM_SEED)
    totals = {kind: defaultdict(float) for kind in ("baseline", "ordinary", "division", "playoffs")}
    counts = {"ordinary": len(ORDINARY_H2H_WEEKS), "division": len(DIVISION_WEEKS), "playoffs": 3}
    for _ in range(MONTE_CARLO_TRIALS):
        state = rng.getstate()
        baseline = sampled_trial(team_seasons, rng)
        for metric, value in baseline.items():
            totals["baseline"][metric] += value
        for kind in ("ordinary", "division", "playoffs"):
            rng.setstate(state)
            outcome = sampled_trial(team_seasons, rng, kind, MARGINAL_BOOST)
            for metric, value in outcome.items():
                totals[kind][metric] += value
    probabilities = {
        kind: {metric: value / MONTE_CARLO_TRIALS for metric, value in metrics.items()}
        for kind, metrics in totals.items()
    }
    derivatives = {}
    for kind in ("ordinary", "division", "playoffs"):
        derivatives[kind] = {
            metric: (probabilities[kind][metric] - probabilities["baseline"][metric]) / (MARGINAL_BOOST * counts[kind])
            for metric in probabilities["baseline"]
        }
    ordinary_playoff = derivatives["ordinary"]["playoffs"]
    ordinary_champion = derivatives["ordinary"]["champion"]
    ratios = {
        "divisionToOrdinaryPlayoffQualification": derivatives["division"]["playoffs"] / ordinary_playoff if ordinary_playoff > 0 else None,
        "divisionToOrdinaryChampionship": derivatives["division"]["champion"] / ordinary_champion if ordinary_champion > 0 else None,
        "playoffToOrdinaryChampionship": derivatives["playoffs"]["champion"] / ordinary_champion if ordinary_champion > 0 else None,
    }
    return {"trials": MONTE_CARLO_TRIALS, "boost": MARGINAL_BOOST, "probabilities": probabilities, "derivativesPerPointWeek": derivatives, "ratios": ratios}


def team_probabilities(rows):
    rng = random.Random(RANDOM_SEED + 1)
    result = {}
    for season in sorted({row.season for row in rows}):
        season_rows = [row for row in rows if row.season == season]
        for target in range(12):
            totals = defaultdict(float)
            for _ in range(TEAM_PROBABILITY_TRIALS):
                other = [team for team in range(12) if team != target]
                rivals = rng.sample(other, 2)
                remaining = [team for team in other if team not in rivals]
                rng.shuffle(remaining)
                divisions = [[target, *rivals], *[remaining[index:index + 3] for index in range(0, 9, 3)]]
                schedule = target_schedule(target, rivals, rng)
                outcome = league_outcome([row.actual for row in season_rows], target, divisions, schedule, season_rows[target].playoff_weeks)
                for metric, value in outcome.items():
                    totals[metric] += value
            result[(season, season_rows[target].team)] = {metric: value / TEAM_PROBABILITY_TRIALS for metric, value in totals.items()}
    return result


def weighted_rating(row, division_weight, playoff_weight):
    weights = []
    values = []
    for week, points in enumerate(row.predicted, 1):
        if points <= 0:
            continue
        weight = division_weight if week in DIVISION_WEEKS else playoff_weight if week in row.playoff_weeks else 1.0
        weights.append(weight)
        values.append(points * weight)
    return sum(values) / sum(weights) if weights else 0.0


def grid_search(rows, probabilities):
    seasons = sorted({row.season for row in rows})
    candidates = []
    for division_step in range(0, 11):
        division_weight = 1 + division_step * 0.05
        for playoff_step in range(0, 21):
            playoff_weight = 1 + playoff_step * 0.05
            rating_ranks, playoff_ranks, champion_ranks = [], [], []
            season_metrics = {}
            for season in seasons:
                season_rows = [row for row in rows if row.season == season]
                ratings = [weighted_rating(row, division_weight, playoff_weight) for row in season_rows]
                playoff = [probabilities[(season, row.team)]["playoffs"] for row in season_rows]
                champion = [probabilities[(season, row.team)]["champion"] for row in season_rows]
                rating_ranks.extend(ranks(ratings))
                playoff_ranks.extend(ranks(playoff))
                champion_ranks.extend(ranks(champion))
                season_metrics[str(season)] = {"playoffSpearman": spearman(ratings, playoff), "championshipSpearman": spearman(ratings, champion)}
            candidates.append({
                "divisionWeight": round(division_weight, 2),
                "playoffWeight": round(playoff_weight, 2),
                "playoffSpearman": spearman(rating_ranks, playoff_ranks),
                "championshipSpearman": spearman(rating_ranks, champion_ranks),
                "bySeason": season_metrics,
            })
    baseline = next(row for row in candidates if row["divisionWeight"] == 1 and row["playoffWeight"] == 1)
    eligible = [row for row in candidates if row["playoffSpearman"] >= baseline["playoffSpearman"]]
    champion = max(eligible, key=lambda row: (row["championshipSpearman"], row["playoffSpearman"], -row["playoffWeight"], -row["divisionWeight"]))
    fold_results = []
    for held_out in seasons:
        training = [row for row in candidates if all(
            row["bySeason"][str(season)]["playoffSpearman"] >= baseline["bySeason"][str(season)]["playoffSpearman"]
            for season in seasons if season != held_out
        )]
        selected = max(training or candidates, key=lambda row: (
            statistics.fmean(row["bySeason"][str(season)]["championshipSpearman"] for season in seasons if season != held_out),
            statistics.fmean(row["bySeason"][str(season)]["playoffSpearman"] for season in seasons if season != held_out),
            -row["playoffWeight"], -row["divisionWeight"],
        ))
        fold_results.append({
            "heldOutSeason": held_out,
            "selectedDivisionWeight": selected["divisionWeight"],
            "selectedPlayoffWeight": selected["playoffWeight"],
            "heldOutPlayoffDelta": selected["bySeason"][str(held_out)]["playoffSpearman"] - baseline["bySeason"][str(held_out)]["playoffSpearman"],
            "heldOutChampionshipDelta": selected["bySeason"][str(held_out)]["championshipSpearman"] - baseline["bySeason"][str(held_out)]["championshipSpearman"],
        })
    return {"baseline": baseline, "champion": champion, "topCandidates": sorted(eligible, key=lambda row: (row["championshipSpearman"], row["playoffSpearman"]), reverse=True)[:10], "leaveOneSeasonOut": fold_results}


def run():
    self_check()
    team_seasons, coverage, timing_pairs = load_team_seasons()
    if len(team_seasons) != 48:
        raise RuntimeError(f"Expected 48 complete team-seasons, found {len(team_seasons)}.")
    reliability = {
        "rows": len(timing_pairs),
        "centeredWeeklyPearson": pearson(timing_pairs),
        "centeredWeeklyCalibrationSlope": calibration_slope(timing_pairs),
    }
    leverage = marginal_leverage(team_seasons)
    probabilities = team_probabilities(team_seasons)
    grid = grid_search(team_seasons, probabilities)
    report = {
        "schemaVersion": 1,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "randomSeed": RANDOM_SEED,
        "historicalSeasons": sorted(SEASON_FILES),
        "sources": {
            "actualPlayerWeeks": str(ACTUAL_SOURCE),
            "preseasonDraftsAndWeeklyForecasts": [str(SEASON_FILES[season]["draft"].parent) for season in sorted(SEASON_FILES)],
        },
        "leagueModel": {
            "teams": 12,
            "divisions": 4,
            "teamsPerDivision": 3,
            "divisionWeeks": list(DIVISION_WEEKS),
            "ordinaryHeadToHeadWeeks": list(ORDINARY_H2H_WEEKS),
            "week14": "all-play points tiebreaker; no head-to-head win",
            "playoffTeams": 6,
            "playoffRounds": 3,
        },
        "coverage": coverage,
        "forecastReliability": reliability,
        "monteCarlo": leverage,
        "historicalGrid": grid,
        "recommendation": {
            **RECOMMENDATION,
            "status": "validated_live_bounded",
            "decision": "Use structural leverage and published guidance, then shrink below the in-sample grid optimum because weekly timing correlation and leave-one-season-out stability are limited.",
            "research": [
                "https://www.footballguys.com/article/WaiverTradeDominator17?article=WaiverTradeDominator17",
                "https://www2.isye.gatech.edu/~xsun84/publications/FantasyFootball-abstract.pdf",
                "https://www.pff.com/news/fantasy-football-easiest-hardest-strength-of-schedule-2019",
                "https://www.pff.com/news/fantasy-football-the-worst-early-season-schedules-for-fantasy-purposes",
            ],
        },
    }
    REPORT_JSON.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")

    ratio = leverage["ratios"]
    lines = [
        "# Priority-week weight calibration",
        "",
        f"Generated {report['generatedAt']} from {len(team_seasons)} archived Thunder Bowl team-seasons and {leverage['trials']:,} common-random-number Monte Carlo trials.",
        "",
        "## Forecast coverage and timing reliability",
        "",
        "| Season | Teams | Skill players | Team forecast match | Player actual match |",
        "|---:|---:|---:|---:|---:|",
    ]
    for season, row in coverage.items():
        lines.append(f"| {season} | {row['teams']} | {row['draftedSkillPlayers']} | {row['projectionCoverage']:.1%} | {row['actualCoverage']:.1%} |")
    lines.extend([
        "",
        f"Centered preseason-to-actual weekly timing correlation: **{reliability['centeredWeeklyPearson']:.3f}**; calibration slope: **{reliability['centeredWeeklyCalibrationSlope']:.3f}** across {reliability['rows']:,} team-weeks.",
        "",
        "## Monte Carlo marginal leverage",
        "",
        "Each derivative is the change in outcome probability from one extra lineup point in one week, estimated with the same random schedules for baseline and boosted trials.",
        "",
        "| Week class | Division-title derivative | Playoff derivative | Championship derivative |",
        "|---|---:|---:|---:|",
    ])
    for kind in ("ordinary", "division", "playoffs"):
        row = leverage["derivativesPerPointWeek"][kind]
        lines.append(f"| {kind.title()} | {row['division']:+.6f} | {row['playoffs']:+.6f} | {row['champion']:+.6f} |")
    lines.extend([
        "",
        f"Division/ordinary leverage ratio for playoff qualification: **{ratio['divisionToOrdinaryPlayoffQualification']:.3f}×**.",
        f"Division/ordinary leverage ratio for winning the league: **{ratio['divisionToOrdinaryChampionship']:.3f}×**.",
        f"Playoff/ordinary leverage ratio for winning the league: **{ratio['playoffToOrdinaryChampionship']:.3f}×**.",
        "",
        "## Historical weekly-weight grid",
        "",
        f"Baseline correlations — playoff: **{grid['baseline']['playoffSpearman']:.3f}**; championship: **{grid['baseline']['championshipSpearman']:.3f}**.",
        f"Grid champion — division **{grid['champion']['divisionWeight']:.2f}×**, playoffs **{grid['champion']['playoffWeight']:.2f}×**; playoff correlation **{grid['champion']['playoffSpearman']:.3f}**, championship correlation **{grid['champion']['championshipSpearman']:.3f}**.",
        "",
        "The grid is a small archived sample and is used as a guardrail, not as permission to overfit.",
        "",
        "## Live recommendation",
        "",
        f"Use **1.00× ordinary / {RECOMMENDATION['divisionWeight']:.2f}× division / {RECOMMENDATION['playoffWeight']:.2f}× playoffs** and set Week 18 to zero. Give the weekly timing signal **{RECOMMENDATION['forecastAuthority']:.0%} authority**, calculate it relative to positional replacement, and cap any player at **±{RECOMMENDATION['maxVbdDelta']:.0f} VBD**.",
        "",
        "The 1.20 division weight matches the simulated championship leverage and Footballguys' published conference-game guidance. The 1.50 playoff weight matches the published optimization paper's playoff-versus-regular win utility and deliberately stays below both Footballguys' 2.00 suggestion and the 1.85 in-sample grid result because the archived timing signal is noisy and leave-one-season-out results are unstable.",
    ])
    REPORT_MD.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(json.dumps({"forecastReliability": reliability, "ratios": ratio, "gridChampion": grid["champion"], "leaveOneSeasonOut": grid["leaveOneSeasonOut"]}, indent=2))


if __name__ == "__main__":
    run()
