"""Import a Footballguys Draft Dominator value-table PDF into the protected draft pack."""

from __future__ import annotations

import argparse
import configparser
import json
import re
import unicodedata
from pathlib import Path

import pdfplumber


POSITION_ALIASES = {"PK": "K", "DEF": "DST"}
NFL_TEAM_ALIASES = {"JAC": "JAX"}
PLAYER_NAME_ALIASES = {
    "kennethwalker": "kenwalker",
    "eddypiaeiro": "eddypineiro",
}


def normalize_name(value: str) -> str:
    value = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode().lower()
    value = re.sub(r"\b(?:jr|sr|ii|iii|iv)\b", " ", value)
    return re.sub(r"[^a-z0-9]+", "", value)


def parse_rows(pdf_path: Path) -> list[dict]:
    with pdfplumber.open(pdf_path) as pdf:
        page_tables = [page.extract_tables() for page in pdf.pages]
    rows = []
    for page_number, tables in enumerate(page_tables, start=1):
        if len(tables) != 1 or len(tables[0]) < 2:
            raise ValueError(f"Could not locate the Footballguys value table on page {page_number}.")
        header = tables[0][0]
        if header[:7] != ["Rank", "Pos", "Player", "Team", "$$$", "ADP", "Act"] or header[8:15] != header[:7]:
            raise ValueError(f"Unexpected Footballguys table header on page {page_number}.")
        for table_row in tables[0][1:]:
            for offset in (0, 8):
                rank = int(table_row[offset])
                source_position = re.sub(r"[0-9]+$", "", table_row[offset + 1])
                position = POSITION_ALIASES.get(source_position, source_position)
                source_team = table_row[offset + 3].split("/", 1)[0].upper()
                rows.append({
                    "rank": rank,
                    "position": position,
                    "name": table_row[offset + 2],
                    "nflTeam": NFL_TEAM_ALIASES.get(source_team, source_team),
                    "value": int(table_row[offset + 4]),
                })
    rows.sort(key=lambda row: row["rank"])
    ranks = [row["rank"] for row in rows]
    expected_ranks = list(range(ranks[0], ranks[-1] + 1))
    if ranks != expected_ranks:
        raise ValueError("Footballguys ranks must be unique, ordered, and contiguous across every supplied page.")
    return rows


def audit_ddf_configuration(ddf_path: Path, pack: dict) -> list[dict]:
    parser = configparser.ConfigParser(interpolation=None)
    parser.optionxform = str
    with ddf_path.open("r", encoding="utf-8-sig") as source:
        parser.read_file(source)
    setup = parser["Setup"]
    expected = {
        "NumTeams": str(len(pack["leagueConfig"]["teams"])),
        "NumRounds": str(pack["leagueConfig"]["rosterSize"]),
        "StartersQB": str(pack["leagueConfig"]["starterRequirements"]["QB"]),
        "StartersRB": str(pack["leagueConfig"]["starterRequirements"]["RB"]),
        "StartersWR": str(pack["leagueConfig"]["starterRequirements"]["WR"]),
        "StartersTE": str(pack["leagueConfig"]["starterRequirements"]["TE"]),
        "StartersPK": str(pack["leagueConfig"]["starterRequirements"]["K"]),
        "StartersDef": str(pack["leagueConfig"]["starterRequirements"]["DST"]),
        "QBPassYard": "0.04",
        "QBPassInt": "-2",
        "QBPassTD1": "6",
        "RBRecRec": "1",
        "WRRecRec": "1",
        "TERecRec": "1",
        "QBFumbles": "-2",
        "RBFumbles": "-2",
        "WRFumbles": "-2",
        "TEFumbles": "-2",
        "DEFSack": "2",
        "DEFInt": "2",
        "DEFForcedFumble": "0",
        "FGMade3": "3",
        "DefPoints1": "10",
        "DefPoints2": "8",
        "DefPoints3": "6",
        "DefPoints4": "4",
        "DefPoints5": "0",
        "DefPoints6": "-4",
        "DefPoints7": "-6",
    }
    return [
        {"setting": key, "expected": value, "actual": setup.get(key, "missing")}
        for key, value in expected.items()
        if setup.get(key) != value
    ]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--pdf", required=True, type=Path)
    parser.add_argument("--ddf", required=True, type=Path)
    parser.add_argument("--pack", required=True, type=Path)
    parser.add_argument("--pack-id", required=True)
    parser.add_argument("--pack-as-of", required=True)
    parser.add_argument("--source-as-of", required=True)
    parser.add_argument("--write", action="store_true")
    parser.add_argument("--allow-config-mismatch", action="store_true")
    args = parser.parse_args()

    pack = json.loads(args.pack.read_text(encoding="utf-8"))
    configuration_issues = audit_ddf_configuration(args.ddf, pack)
    if configuration_issues and not args.allow_config_mismatch:
        raise ValueError(
            "Footballguys auction values were generated with settings that do not match Thunder Bowl: "
            + json.dumps(configuration_issues)
        )
    rows = parse_rows(args.pdf)
    players = {(normalize_name(player["name"]), player["position"]): player for player in pack["players"]}
    players_by_position = {}
    for player in pack["players"]:
        players_by_position.setdefault(player["position"], []).append(player)
    defenses = {player["nflTeam"]: player for player in pack["players"] if player["position"] == "DST"}
    matched = []
    missing = []
    for row in rows:
        normalized_name = normalize_name(row["name"])
        normalized_name = PLAYER_NAME_ALIASES.get(normalized_name, normalized_name)
        player = defenses.get(row["nflTeam"]) if row["position"] == "DST" else players.get((normalized_name, row["position"]))
        if not player and row["position"] != "DST":
            prefix_matches = [
                candidate
                for candidate in players_by_position.get(row["position"], [])
                if abs(len(normalized_name) - len(normalize_name(candidate["name"]))) <= 2
                and (
                    normalized_name.startswith(normalize_name(candidate["name"]))
                    or normalize_name(candidate["name"]).startswith(normalized_name)
                )
            ]
            if len(prefix_matches) == 1:
                player = prefix_matches[0]
        if not player:
            missing.append(row)
            continue
        matched.append({"playerId": player["id"], "rank": row["rank"], "value": row["value"]})
    if missing:
        raise ValueError(f"{len(missing)} PDF rows did not match the protected player pool: {missing[:10]}")
    if len({row["playerId"] for row in matched}) != len(matched):
        raise ValueError("Footballguys rows resolved to duplicate protected players.")

    rank_start = min(row["rank"] for row in rows)
    rank_end = max(row["rank"] for row in rows)
    source_name = "Footballguys 2026 Draft Dominator auction values"
    scoring_fingerprint = pack["sources"][0]["scoringFingerprint"]
    pack["sources"] = [source for source in pack["sources"] if source["name"] != source_name]
    compatibility = "configuration matches Thunder Bowl" if not configuration_issues else "configuration mismatch; comparison only"
    pack["sources"].append({
        "name": source_name,
        "asOf": args.source_as_of,
        "authority": f"comparison only; {compatibility}; ranks {rank_start}-{rank_end}",
        "scoringFingerprint": scoring_fingerprint,
    })
    coverage = (
        f"Supplied PDF contains complete ranks {rank_start}-{rank_end}."
        if rank_start == 1
        else f"Supplied PDF contains ranks {rank_start}-{rank_end} only; ranks 1-{rank_start - 1} were not supplied."
    )
    if configuration_issues:
        coverage += " Source DDF does not match Thunder Bowl scoring/roster settings; raw dollars are incompatible."
    pack["fbgAuctionValues"] = {
        "source": source_name,
        "asOf": args.source_as_of,
        "modelEffect": "none",
        "coverage": coverage,
        "rankStart": rank_start,
        "rankEnd": rank_end,
        "reportedRows": len(rows),
        "matchedRows": len(matched),
        "values": matched,
    }
    pack["packId"] = args.pack_id
    pack["asOf"] = args.pack_as_of

    summary = {
        "pdfRows": len(rows),
        "matchedRows": len(matched),
        "rankStart": rank_start,
        "rankEnd": rank_end,
        "minimumValue": min(row["value"] for row in rows),
        "maximumValue": max(row["value"] for row in rows),
        "packId": pack["packId"],
        "configurationIssues": configuration_issues,
        "written": args.write,
    }
    if args.write:
        args.pack.write_text(json.dumps(pack, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
