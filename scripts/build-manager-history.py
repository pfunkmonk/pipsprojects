#!/usr/bin/env python3
"""Build audited Thunder Bowl manager-tendency profiles from auction history.

The live model is deliberately limited to winning auction purchases. Keeper
prices, waiver activity, post-draft roster snapshots, and incomplete seasons
are excluded because they do not measure auction willingness to pay. The
result remains advisory-only and is shrunk again by the browser-side auction
forecast before it can affect a simulated rival bid.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import os
import re
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable


POSITIONS = ("QB", "RB", "WR", "TE", "K", "DST")
MAX_PROFILE_RELIABILITY = 0.5
RELIABILITY_CANDIDATES = (0.0, 0.05, 0.10, 0.15, 0.20, 0.25, 0.30, 0.40, 0.50)
HALF_LIFE_CANDIDATES = (2.0, 3.0, 4.0, 5.0, 6.0, 8.0, 12.0, 1000.0)
MODERN_SEASONS = (2021, 2022, 2023, 2024, 2025)

TEAM_NAMES = {
    "angry-face": "Angry Face",
    "big-head": "Big Head",
    "crime-and-punishment": "Crime and Punishment",
    "dogs-of-war": "Dogs of War",
    "el-guapo": "El Guapo",
    "goon-skwad": "Goon Skwad",
    "orange-crush": "Orange Crush",
    "super-suckers": "Super Suckers",
    "t-dogs": "T-Dogs",
    "the-bungles": "The Bungles",
    "the-hobbits": "The Hobbits",
    "three-amigos": "Three Amigos",
}

TEAM_ALIASES = {
    "angry face": "angry-face",
    "big head": "big-head",
    "crime and punishment": "crime-and-punishment",
    "criime and punishment": "crime-and-punishment",
    "dogs of war": "dogs-of-war",
    "el guapo": "el-guapo",
    "goon skwad": "goon-skwad",
    "orange crush": "orange-crush",
    "super suckers": "super-suckers",
    "t dogs": "t-dogs",
    "the bungles": "the-bungles",
    "big pimpin": "the-bungles",
    "fumble brewskis": "the-bungles",
    "hobbits": "the-hobbits",
    "the hobbits": "the-hobbits",
    "three amigos": "three-amigos",
    "whoopass": "three-amigos",
    "the whoopass": "three-amigos",
}

POSITION_ALIASES = {"PK": "K", "DEF": "DST", "TD": "DST"}
NFL_TEAM_ALIASES = {"JAC": "JAX", "SD": "LAC", "STL": "LAR", "OAK": "LV"}

EXPECTED_OLDER_COUNTS = {
    2012: {"total": 147, "keepers": 24, "purchases": 123},
    2015: {"total": 149, "keepers": 24, "purchases": 125},
    2017: {"total": 156, "keepers": 24, "purchases": 132},
    2018: {"total": 162, "keepers": 24, "invalid": 1, "purchases": 137},
    2019: {"purchases": 135},
}

EXCLUDED_SEASONS = {
    2010: "No machine-readable completed auction result found.",
    2011: "The only DraftDominator file contains 24 keeper-stage rows, not a completed auction.",
    2013: "The only DraftDominator file contains 13 partial/keeper-stage rows.",
    2014: "The 96-row export is an unrelated eight-team league with zero-dollar rows; the Thunder Bowl file is keeper-only.",
    2016: "No completed auction summary or DraftDominator result found.",
    2020: "The available DraftDominator file contains only seven draft rows and four keeper rows.",
}


def normalized_label(value: object) -> str:
    return re.sub(r"[^a-z0-9]+", " ", str(value or "").strip().lower()).strip()


def canonical_team(value: object) -> tuple[str, str]:
    label = normalized_label(value)
    team_id = TEAM_ALIASES.get(label)
    if not team_id:
        raise ValueError(f"Unknown fantasy-team identity: {value!r}")
    return team_id, TEAM_NAMES[team_id]


def canonical_position(value: object) -> str:
    position = re.sub(r"\d+$", "", str(value or "").strip().upper())
    position = POSITION_ALIASES.get(position, position)
    if position not in POSITIONS:
        raise ValueError(f"Unknown position: {value!r}")
    return position


def canonical_nfl_team(value: object) -> str:
    team = str(value or "").strip().upper().split("/", 1)[0]
    team = NFL_TEAM_ALIASES.get(team, team)
    if not re.fullmatch(r"[A-Z]{2,4}", team):
        raise ValueError(f"Unknown NFL team: {value!r}")
    return team


def as_salary(value: object) -> int:
    cleaned = re.sub(r"[^0-9.-]+", "", str(value or ""))
    if not cleaned:
        raise ValueError(f"Missing auction salary: {value!r}")
    salary = int(round(float(cleaned)))
    if salary < 1 or salary > 120:
        raise ValueError(f"Auction salary outside the validated range: {value!r}")
    return salary


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def purchase_row(
    *,
    season: int,
    source_team: object,
    player_name: object,
    position: object,
    nfl_team: object,
    salary: object,
    source_file: Path,
    source_kind: str,
) -> dict[str, object]:
    team_id, team_name = canonical_team(source_team)
    name = str(player_name or "").strip()
    if not name:
        raise ValueError(f"Blank player name in {source_file}")
    return {
        "season": season,
        "team_id": team_id,
        "team_name": team_name,
        "source_team": str(source_team).strip(),
        "player_name": name,
        "position": canonical_position(position),
        "nfl_team": canonical_nfl_team(nfl_team),
        "salary": as_salary(salary),
        "source_kind": source_kind,
        "source_file": str(source_file),
    }


def parse_draftdominator_csv(path: Path, season: int) -> tuple[list[dict[str, object]], dict[str, int]]:
    with path.open(encoding="utf-8-sig", newline="") as source:
        rows = list(csv.DictReader(source))
    purchases: list[dict[str, object]] = []
    keepers = 0
    invalid = 0
    for row in rows:
        if str(row.get("Status", "")).strip().lower() == "keeper":
            keepers += 1
            continue
        if float(row.get("Amt Paid") or 0) < 1:
            invalid += 1
            continue
        purchases.append(purchase_row(
            season=season,
            source_team=row.get("Selected By"),
            player_name=row.get("Player"),
            position=row.get("Pos"),
            nfl_team=row.get("Team"),
            salary=row.get("Amt Paid"),
            source_file=path,
            source_kind="draftdominator_completed_auction",
        ))
    return purchases, {"total": len(rows), "keepers": keepers, "invalid": invalid, "purchases": len(purchases)}


def parse_2012_final_ddf(path: Path) -> tuple[list[dict[str, object]], dict[str, int]]:
    rows: list[list[str]] = []
    in_summary = False
    for raw_line in path.read_text(encoding="latin-1").splitlines():
        line = raw_line.strip()
        if line == "[DraftSummary]":
            in_summary = True
            continue
        if in_summary and line.startswith("["):
            break
        if not in_summary or not re.match(r"^D\d+=", line):
            continue
        payload = line.split("=", 1)[1]
        values = [part.strip() for part in payload.split(",")]
        if len(values) < 7:
            raise ValueError(f"Malformed 2012 DraftSummary row: {line}")
        rows.append(values)
    if len(rows) != EXPECTED_OLDER_COUNTS[2012]["total"]:
        raise ValueError(f"2012 Final.ddf contains {len(rows)} rows, expected 147.")
    purchases: list[dict[str, object]] = []
    for index, values in enumerate(rows, start=1):
        if index <= EXPECTED_OLDER_COUNTS[2012]["keepers"]:
            continue
        purchases.append(purchase_row(
            season=2012,
            source_team=values[5],
            player_name=values[3],
            position=values[2],
            nfl_team=values[4],
            salary=values[6],
            source_file=path,
            source_kind="draftdominator_final_auction_rounds_3_plus",
        ))
    return purchases, {**EXPECTED_OLDER_COUNTS[2012], "invalid": 0}


def parse_2019_custom_csv(path: Path) -> tuple[list[dict[str, object]], dict[str, int]]:
    lines = path.read_text(encoding="utf-8-sig").splitlines()
    header_index = next((index for index, line in enumerate(lines) if line.lower().startswith("pick,overall,franchise,")), None)
    if header_index is None:
        raise ValueError("The 2019 custom draft-result header was not found.")
    rows = list(csv.DictReader(lines[header_index:]))
    purchases = [
        purchase_row(
            season=2019,
            source_team=row["franchise"],
            player_name=row["player"],
            position=row["position"],
            nfl_team=row["NFL team"],
            salary=row["$"],
            source_file=path,
            source_kind="custom_completed_auction_results",
        )
        for row in rows
        if str(row.get("franchise", "")).strip()
    ]
    return purchases, {"total": len(purchases), "keepers": 0, "invalid": 0, "purchases": len(purchases)}


def parse_modern_normalized(path: Path) -> tuple[list[dict[str, object]], dict[int, dict[str, int]]]:
    with path.open(encoding="utf-8-sig", newline="") as source:
        rows = list(csv.DictReader(source))
    purchases: list[dict[str, object]] = []
    counts: dict[int, dict[str, int]] = {}
    for season in MODERN_SEASONS:
        season_rows = [row for row in rows if int(row["season"]) == season]
        eligible = [row for row in season_rows if row["acquisition_type"] != "keeper"]
        keepers = len(season_rows) - len(eligible)
        counts[season] = {"total": len(season_rows), "keepers": keepers, "invalid": 0, "purchases": len(eligible)}
        for row in eligible:
            purchases.append(purchase_row(
                season=season,
                source_team=row["fantasy_team"],
                player_name=row["player_name"],
                position=row["position"],
                nfl_team=row["nfl_team"],
                salary=row["salary"],
                source_file=path,
                source_kind=f"audited_modern_{row['acquisition_type']}",
            ))
    return purchases, counts


def require_complete_season(rows: list[dict[str, object]], season: int) -> None:
    season_rows = [row for row in rows if row["season"] == season]
    teams = {row["team_id"] for row in season_rows}
    if teams != set(TEAM_NAMES):
        missing = sorted(set(TEAM_NAMES) - teams)
        extra = sorted(teams - set(TEAM_NAMES))
        raise ValueError(f"Season {season} team coverage mismatch; missing={missing}, extra={extra}")
    if len(season_rows) < 60:
        raise ValueError(f"Season {season} has only {len(season_rows)} auction purchases and is not complete enough.")


def season_statistics(rows: Iterable[dict[str, object]]) -> dict[int, dict[str, object]]:
    grouped: dict[int, list[dict[str, object]]] = defaultdict(list)
    for row in rows:
        grouped[int(row["season"])].append(row)
    output: dict[int, dict[str, object]] = {}
    for season, season_rows in grouped.items():
        league_position = defaultdict(float)
        league_nfl = defaultdict(float)
        team_position: dict[str, dict[str, float]] = defaultdict(lambda: defaultdict(float))
        team_nfl: dict[str, dict[str, float]] = defaultdict(lambda: defaultdict(float))
        team_total = defaultdict(float)
        team_purchase_count = defaultdict(int)
        for row in season_rows:
            salary = float(row["salary"])
            team_id = str(row["team_id"])
            position = str(row["position"])
            nfl_team = str(row["nfl_team"])
            league_position[position] += salary
            league_nfl[nfl_team] += salary
            team_position[team_id][position] += salary
            team_nfl[team_id][nfl_team] += salary
            team_total[team_id] += salary
            team_purchase_count[team_id] += 1
        league_total = sum(league_position.values())
        output[season] = {
            "league_position_share": {position: league_position[position] / league_total for position in POSITIONS},
            "league_nfl_share": {team: spend / league_total for team, spend in league_nfl.items()},
            "team_position": team_position,
            "team_nfl": team_nfl,
            "team_total": team_total,
            "team_purchase_count": team_purchase_count,
        }
    return output


def recency_weight(reference_season: int, season: int, half_life: float) -> float:
    return 0.5 ** (max(0, reference_season - season) / half_life)


def fit_position_multipliers(
    stats: dict[int, dict[str, object]],
    team_id: str,
    seasons: list[int],
    reference_season: int,
    half_life: float,
    reliability: float,
) -> dict[str, float]:
    output: dict[str, float] = {}
    for position in POSITIONS:
        numerator = 0.0
        denominator = 0.0
        for season in seasons:
            stat = stats[season]
            team_total = float(stat["team_total"].get(team_id, 0))
            league_share = float(stat["league_position_share"].get(position, 0))
            if team_total <= 0 or league_share <= 0:
                continue
            team_share = float(stat["team_position"][team_id].get(position, 0)) / team_total
            raw_ratio = team_share / league_share
            weight = recency_weight(reference_season, season, half_life) * math.sqrt(max(1.0, team_total))
            numerator += weight * raw_ratio
            denominator += weight
        raw = numerator / denominator if denominator else 1.0
        shrunk = 1.0 + reliability * (raw - 1.0)
        output[position] = min(2.1, max(0.5, shrunk))
    return output


def fit_affinity(
    rows: list[dict[str, object]],
    stats: dict[int, dict[str, object]],
    team_id: str,
    seasons: list[int],
    reference_season: int,
    half_life: float,
) -> tuple[str, float]:
    candidates: list[tuple[float, float, str]] = []
    team_rows = [row for row in rows if row["team_id"] == team_id and int(row["season"]) in seasons]
    nfl_teams = sorted({str(row["nfl_team"]) for row in team_rows})
    for nfl_team in nfl_teams:
        ratio_numerator = 0.0
        ratio_denominator = 0.0
        weighted_support = 0.0
        support_seasons = 0
        for season in seasons:
            stat = stats[season]
            team_total = float(stat["team_total"].get(team_id, 0))
            league_share = float(stat["league_nfl_share"].get(nfl_team, 0))
            team_spend = float(stat["team_nfl"][team_id].get(nfl_team, 0))
            if team_total <= 0 or league_share <= 0:
                continue
            weight = recency_weight(reference_season, season, half_life)
            team_share = team_spend / team_total
            ratio_numerator += weight * (team_share / league_share)
            ratio_denominator += weight
            purchases = sum(1 for row in team_rows if int(row["season"]) == season and row["nfl_team"] == nfl_team)
            if purchases:
                support_seasons += 1
                weighted_support += weight * purchases
        if ratio_denominator <= 0 or support_seasons < 2 or weighted_support < 1.5:
            continue
        raw = ratio_numerator / ratio_denominator
        support_reliability = weighted_support / (weighted_support + 24.0)
        multiplier = min(2.1, max(1.0, 1.0 + support_reliability * (raw - 1.0)))
        candidates.append((multiplier, weighted_support, nfl_team))
    if not candidates:
        return "FA", 1.0
    multiplier, _support, nfl_team = max(candidates, key=lambda value: (value[0], value[1], value[2]))
    return nfl_team, multiplier


def position_share_error(
    rows: list[dict[str, object]], stats: dict[int, dict[str, object]], half_life: float, reliability: float
) -> dict[str, float | int]:
    seasons = sorted(stats)
    absolute_error = 0.0
    baseline_error = 0.0
    comparisons = 0
    for test_season in seasons:
        training = [season for season in seasons if season < test_season]
        if len(training) < 3:
            continue
        stat = stats[test_season]
        for team_id in TEAM_NAMES:
            total = float(stat["team_total"].get(team_id, 0))
            if total <= 0:
                continue
            multipliers = fit_position_multipliers(stats, team_id, training, test_season, half_life, reliability)
            raw_prediction = {
                position: multipliers[position] * float(stat["league_position_share"].get(position, 0))
                for position in POSITIONS
            }
            prediction_total = sum(raw_prediction.values()) or 1.0
            for position in POSITIONS:
                predicted = raw_prediction[position] / prediction_total
                baseline = float(stat["league_position_share"].get(position, 0))
                actual = float(stat["team_position"][team_id].get(position, 0)) / total
                absolute_error += abs(predicted - actual)
                baseline_error += abs(baseline - actual)
                comparisons += 1
    return {
        "halfLifeSeasons": half_life,
        "profileReliability": reliability,
        "comparisons": comparisons,
        "meanAbsoluteShareError": absolute_error / comparisons if comparisons else 1.0,
        "leagueBaselineMeanAbsoluteShareError": baseline_error / comparisons if comparisons else 1.0,
    }


def build_profiles(
    all_rows: list[dict[str, object]], max_season: int, half_life: float, reliability: float
) -> tuple[list[dict[str, object]], dict[int, dict[str, object]]]:
    rows = [row for row in all_rows if int(row["season"]) <= max_season]
    stats = season_statistics(rows)
    seasons = sorted(stats)
    profiles: list[dict[str, object]] = []
    for team_id, team_name in TEAM_NAMES.items():
        team_rows = [row for row in rows if row["team_id"] == team_id]
        team_seasons = sorted({int(row["season"]) for row in team_rows})
        multipliers = fit_position_multipliers(stats, team_id, team_seasons, max_season, half_life, reliability)
        affinity, affinity_multiplier = fit_affinity(rows, stats, team_id, team_seasons, max_season, half_life)
        note = (
            f"{len(team_seasons)} validated seasons; recency-weighted winning auction purchases; "
            "keepers/post-draft moves excluded; no losing-bid sequence; advisory only."
        )
        profiles.append({
            "teamId": team_id,
            "teamName": team_name,
            "sampleSeasons": len(team_seasons),
            "samplePurchases": len(team_rows),
            "observedSpend": sum(int(row["salary"]) for row in team_rows),
            "reliability": reliability,
            "confidence": "low_advisory_only",
            "positionMultipliers": multipliers,
            "topNflAffinity": affinity,
            "topNflAffinityMultiplier": affinity_multiplier,
            "modelEffect": "advisory_only",
            "note": note,
        })
    return sorted(profiles, key=lambda profile: str(profile["teamName"])), stats


def update_pack(
    source_path: Path,
    output_path: Path,
    profiles: list[dict[str, object]],
    max_season: int,
    as_of: str,
) -> None:
    pack = json.loads(source_path.read_text(encoding="utf-8"))
    scoring_fingerprint = pack["sources"][0]["scoringFingerprint"]
    manager_source = {
        "name": f"Thunder Bowl 2012-{max_season} validated manager auction profiles",
        "asOf": as_of,
        "authority": "manager-profile advisory; no value effect",
        "scoringFingerprint": scoring_fingerprint,
    }
    retained = [
        source for source in pack["sources"]
        if not ("manager" in source["name"].lower() and ("profile" in source["name"].lower() or "spend" in source["name"].lower()))
    ]
    pack["sources"] = [*retained, manager_source]
    pack["managerProfiles"] = profiles
    pack["asOf"] = as_of
    base_pack_id = re.sub(r"-manager-history-\d{8}t?\d*.*$", "", pack["packId"], flags=re.IGNORECASE)
    timestamp = datetime.fromisoformat(as_of.replace("Z", "+00:00")).strftime("%Y%m%dT%H%M%S")
    pack["packId"] = f"{base_pack_id}-manager-history-{timestamp}"
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(pack, indent=2) + "\n", encoding="utf-8")


def write_normalized(path: Path, rows: list[dict[str, object]]) -> None:
    fields = ["season", "team_id", "team_name", "source_team", "player_name", "position", "nfl_team", "salary", "source_kind", "source_file"]
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as target:
        writer = csv.DictWriter(target, fieldnames=fields)
        writer.writeheader()
        writer.writerows(sorted(rows, key=lambda row: (int(row["season"]), str(row["team_id"]), str(row["player_name"]))))


def audit_markdown(audit: dict[str, object]) -> str:
    lines = [
        "# Thunder Bowl manager-history audit",
        "",
        f"- Generated: `{audit['generatedAt']}`",
        f"- Model: `{audit['modelVersion']}`",
        f"- Included seasons: {', '.join(str(value) for value in audit['includedSeasons'])}",
        f"- Validated auction purchases: **{audit['purchaseRows']}**",
        f"- Selected recency half-life: **{audit['selectedHalfLifeSeasons']} seasons**",
        f"- Cross-validated profile reliability: **{audit['selectedProfileReliability']}** (maximum allowed: {MAX_PROFILE_RELIABILITY})",
        "- Authority: advisory only; no intrinsic VBD or bid-limit effect",
        "",
        "## Identity continuity",
        "",
        "- `Big Pimpin` → `Fumble Brewskis` / `Fumble-Brewskis` → `The Bungles`",
        "- `Whoopass` / `The Whoopass` → `Three Amigos`",
        "- Spelling and punctuation variants are normalized before aggregation.",
        "",
        "## Season coverage",
        "",
        "| Season | Purchases | Keeper rows excluded | Invalid rows excluded | Source |",
        "|---:|---:|---:|---:|---|",
    ]
    for season in audit["includedSeasons"]:
        coverage = audit["seasonCoverage"][str(season)]
        lines.append(f"| {season} | {coverage['purchases']} | {coverage['keepers']} | {coverage.get('invalid', 0)} | {coverage['source']} |")
    lines.extend(["", "## Excluded seasons", ""])
    for season, reason in audit["excludedSeasons"].items():
        lines.append(f"- **{season}:** {reason}")
    lines.extend([
        "",
        "## Safety contract",
        "",
        "Only winning auction purchases are used. Keeper prices, waiver acquisitions, post-draft roster snapshots, incomplete auctions, and the unrelated 2014 league are excluded. The resulting tendencies remain empirically shrunk, advisory-only inputs to rival willingness-to-pay and practice behavior.",
        "",
    ])
    return "\n".join(lines)


def resolve_default_modern_source() -> Path:
    explicit = os.environ.get("THUNDER_BOWL_MODERN_AUCTION_CSV")
    if explicit:
        return Path(explicit)
    candidates = [
        Path.home() / "OneDrive/Desktop/CODEX_D_Drive_Backup_2026-07-30_160939/thunder-bowl-2026/data/normalized/backtest_player_auction_2021_2025.csv",
        Path.home() / "OneDrive/Desktop/CODEX_D_Drive_Backup_2026-07-30_160939/thunder-bowl-2026/data/normalized/auction_rosters_2021_2025.csv",
    ]
    return next((path for path in candidates if path.exists()), candidates[0])


def main() -> None:
    repo_root = Path(__file__).resolve().parents[1]
    default_history = Path.home() / "Dropbox/Personal/FAMILY STUFF/Mike Stuff/Fantasy Football"
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--history-root", type=Path, default=Path(os.environ.get("THUNDER_BOWL_HISTORY_ROOT", default_history)))
    parser.add_argument("--modern-auction-csv", type=Path, default=resolve_default_modern_source())
    parser.add_argument("--as-of", default=datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"))
    parser.add_argument("--candidate-dir", type=Path, default=repo_root / "tmp/manager-history")
    args = parser.parse_args()

    history_root = args.history_root.resolve()
    modern_path = args.modern_auction_csv.resolve()
    if not history_root.exists():
        raise SystemExit(f"History root does not exist: {history_root}")
    if not modern_path.exists():
        raise SystemExit(f"Audited 2021-2025 auction source does not exist: {modern_path}")

    rows: list[dict[str, object]] = []
    coverage: dict[int, dict[str, object]] = {}
    source_files: list[Path] = []

    path_2012 = history_root / "2012/2012 Final.ddf"
    purchases, counts = parse_2012_final_ddf(path_2012)
    rows.extend(purchases)
    coverage[2012] = {**counts, "source": "2012 Final.ddf (rounds 1-2 excluded as keepers)"}
    source_files.append(path_2012)

    older_paths = {
        2015: history_root / "2015/2015 - DRAFT SUMMARY.csv",
        2017: history_root / "2017/DraftDominator/2017 - DRAFT SUMMARY.csv",
        2018: history_root / "2018/DraftDominator/2018 - DRAFT SUMMARY.csv",
    }
    for season, path in older_paths.items():
        purchases, counts = parse_draftdominator_csv(path, season)
        rows.extend(purchases)
        coverage[season] = {**counts, "source": path.name}
        source_files.append(path)

    path_2019 = history_root / "2019/2019 Thunder Bowl Draft Results.csv"
    purchases, counts = parse_2019_custom_csv(path_2019)
    rows.extend(purchases)
    coverage[2019] = {**counts, "source": path_2019.name}
    source_files.append(path_2019)

    purchases, modern_counts = parse_modern_normalized(modern_path)
    rows.extend(purchases)
    source_files.append(modern_path)
    for season, counts in modern_counts.items():
        coverage[season] = {**counts, "source": modern_path.name}

    for season, expected in EXPECTED_OLDER_COUNTS.items():
        for key, expected_value in expected.items():
            if int(coverage[season][key]) != expected_value:
                raise ValueError(f"Season {season} {key} changed: {coverage[season][key]} != {expected_value}")
    for season in sorted(coverage):
        require_complete_season(rows, season)

    stats = season_statistics(rows)
    backtests = [
        position_share_error(rows, stats, half_life, reliability)
        for half_life in HALF_LIFE_CANDIDATES
        for reliability in RELIABILITY_CANDIDATES
    ]
    selected = min(backtests, key=lambda result: float(result["meanAbsoluteShareError"]))
    half_life = float(selected["halfLifeSeasons"])
    reliability = float(selected["profileReliability"])
    if reliability > MAX_PROFILE_RELIABILITY:
        raise ValueError(f"Selected reliability {reliability} exceeds the advisory cap.")

    profiles_2026, _ = build_profiles(rows, 2025, half_life, reliability)
    profiles_replay, _ = build_profiles(rows, 2024, half_life, reliability)
    included_seasons = sorted(coverage)
    alias_usage = defaultdict(int)
    for row in rows:
        if normalized_label(row["source_team"]) != normalized_label(row["team_name"]):
            alias_usage[f"{row['source_team']} -> {row['team_name']}"] += 1

    audit = {
        "schemaVersion": 1,
        "modelVersion": "manager-history-v2-recency-shrunk",
        "generatedAt": args.as_of,
        "includedSeasons": included_seasons,
        "purchaseRows": len(rows),
        "seasonCoverage": {str(season): coverage[season] for season in included_seasons},
        "excludedSeasons": {str(season): reason for season, reason in EXCLUDED_SEASONS.items()},
        "aliasUsage": dict(sorted(alias_usage.items())),
        "sourceFiles": [{"path": str(path), "sha256": file_sha256(path)} for path in source_files],
        "recencyBacktest": backtests,
        "selectedHalfLifeSeasons": half_life,
        "selectedProfileReliability": reliability,
        "profiles2026": profiles_2026,
        "profiles2025Replay": profiles_replay,
    }

    normalized_path = repo_root / "reports/thunder-bowl/manager-auction-history-normalized.csv"
    audit_json = repo_root / "reports/thunder-bowl/manager-history-audit.json"
    audit_md = repo_root / "reports/thunder-bowl/manager-history-audit.md"
    write_normalized(normalized_path, rows)
    audit_json.write_text(json.dumps(audit, indent=2) + "\n", encoding="utf-8")
    audit_md.write_text(audit_markdown(audit), encoding="utf-8")

    candidate_dir = args.candidate_dir.resolve()
    candidate_dir.mkdir(parents=True, exist_ok=True)
    update_pack(
        repo_root / "netlify/functions/_data/draft-pack-2026-provisional.json",
        candidate_dir / "draft-pack-2026-manager-history.json",
        profiles_2026,
        2025,
        args.as_of,
    )
    update_pack(
        repo_root / "netlify/functions/_data/draft-pack-2025-replay.json",
        candidate_dir / "draft-pack-2025-replay-manager-history.json",
        profiles_replay,
        2024,
        args.as_of,
    )
    print(json.dumps({
        "purchaseRows": len(rows),
        "includedSeasons": included_seasons,
        "selectedHalfLifeSeasons": half_life,
        "selectedProfileReliability": reliability,
        "candidate2026": str(candidate_dir / "draft-pack-2026-manager-history.json"),
        "candidateReplay": str(candidate_dir / "draft-pack-2025-replay-manager-history.json"),
        "audit": str(audit_json),
    }, indent=2))


if __name__ == "__main__":
    main()
