"""Import a Footballguys Draft Dominator value-table PDF into the protected draft pack."""

from __future__ import annotations

import argparse
import json
import re
import unicodedata
from pathlib import Path

import pdfplumber


def normalize_name(value: str) -> str:
    value = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode().lower()
    value = re.sub(r"\b(?:jr|sr|ii|iii|iv)\b", " ", value)
    return re.sub(r"[^a-z0-9]+", "", value)


def parse_rows(pdf_path: Path) -> list[dict]:
    with pdfplumber.open(pdf_path) as pdf:
        if len(pdf.pages) != 1:
            raise ValueError("Expected a one-page Footballguys value-table export.")
        tables = pdf.pages[0].extract_tables()
    if len(tables) != 1 or len(tables[0]) < 2:
        raise ValueError("Could not locate the Footballguys value table.")
    rows = []
    for table_row in tables[0][1:]:
        for offset in (0, 8):
            rank = int(table_row[offset])
            position = re.sub(r"[0-9]+$", "", table_row[offset + 1]).replace("PK", "K")
            rows.append({
                "rank": rank,
                "position": position,
                "name": table_row[offset + 2],
                "value": int(table_row[offset + 4]),
            })
    return sorted(rows, key=lambda row: row["rank"])


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--pdf", required=True, type=Path)
    parser.add_argument("--pack", required=True, type=Path)
    parser.add_argument("--pack-id", required=True)
    parser.add_argument("--pack-as-of", required=True)
    parser.add_argument("--source-as-of", required=True)
    parser.add_argument("--write", action="store_true")
    args = parser.parse_args()

    pack = json.loads(args.pack.read_text(encoding="utf-8"))
    rows = parse_rows(args.pdf)
    players = {(normalize_name(player["name"]), player["position"]): player for player in pack["players"]}
    matched = []
    missing = []
    for row in rows:
        player = players.get((normalize_name(row["name"]), row["position"]))
        if not player:
            missing.append(row)
            continue
        matched.append({"playerId": player["id"], "rank": row["rank"], "value": row["value"]})
    if missing:
        raise ValueError(f"{len(missing)} PDF rows did not match the protected player pool: {missing[:10]}")

    rank_start = min(row["rank"] for row in rows)
    rank_end = max(row["rank"] for row in rows)
    source_name = "Footballguys 2026 Draft Dominator auction values"
    scoring_fingerprint = pack["sources"][0]["scoringFingerprint"]
    pack["sources"] = [source for source in pack["sources"] if source["name"] != source_name]
    pack["sources"].append({
        "name": source_name,
        "asOf": args.source_as_of,
        "authority": "value-neutral auction comparison; partial ranks",
        "scoringFingerprint": scoring_fingerprint,
    })
    pack["fbgAuctionValues"] = {
        "source": source_name,
        "asOf": args.source_as_of,
        "modelEffect": "none",
        "coverage": f"Supplied PDF contains ranks {rank_start}-{rank_end} only; ranks 1-{rank_start - 1} were not supplied.",
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
        "written": args.write,
    }
    if args.write:
        args.pack.write_text(json.dumps(pack, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
