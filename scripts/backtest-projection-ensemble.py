#!/usr/bin/env python3
"""Leakage-aware projection ensemble and residual-sauce challenger.

This is deliberately a challenger audit, not a pack writer.  It uses the
historical Sleeper/ESPN snapshots that are actually archived on this machine as
a surrogate for the unavailable historical FBG/CBS/FantasyPros trio.  Every
fold trains only on earlier seasons and reports rejected as well as accepted
ablation steps.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd


POSITIONS = ("QB", "RB", "WR", "TE")
STARTERS = {"QB": 12, "RB": 24, "WR": 24, "TE": 12}
TOP_K = {"QB": 24, "RB": 48, "WR": 60, "TE": 24}
SOURCE_NAMES = ("Sleeper", "ESPN")
FEATURE_CONTEXT = ("sos_season", "prev1_fp_over_expected")
FEATURE_DURABILITY = ("career_gm_rate", "prev1_games")
FEATURE_FULL = (
    "source_spread",
    "prev1_tb_ppg",
    "ppg_trend",
    "team_implied_total",
    "age",
    "team_qb_changed",
    "prev1_total_xfp",
)


def norm_name(value: object) -> str:
    text = str(value or "").lower()
    text = re.sub(r"[.'`’]", "", text)
    text = re.sub(r"\b(jr|sr|ii|iii|iv|v)\b", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def finite(value: object) -> float | None:
    try:
        number = float(value)
        return number if math.isfinite(number) else None
    except (TypeError, ValueError):
        return None


def mae(pred: np.ndarray, actual: np.ndarray) -> float:
    return float(np.mean(np.abs(pred - actual)))


def rmse(pred: np.ndarray, actual: np.ndarray) -> float:
    return float(np.sqrt(np.mean((pred - actual) ** 2)))


def safe_corr(left: pd.Series, right: pd.Series) -> float | None:
    if len(left) < 3 or left.nunique() < 2 or right.nunique() < 2:
        return None
    value = left.rank(method="average").corr(right.rank(method="average"))
    return None if pd.isna(value) else float(value)


def projection_metrics(frame: pd.DataFrame, column: str) -> dict:
    pred = frame[column].to_numpy(dtype=float)
    actual = frame["actual"].to_numpy(dtype=float)
    by_group = []
    for _, group in frame.groupby(["season", "pos"]):
        corr = safe_corr(group[column], group["actual"])
        if corr is not None:
            by_group.append((len(group), corr))
    rank_corr = sum(weight * corr for weight, corr in by_group) / sum(weight for weight, _ in by_group) if by_group else None

    top_rows = []
    for (_, pos), group in frame.groupby(["season", "pos"]):
        count = min(STARTERS[pos], len(group))
        selected = group.nlargest(count, column)
        actual_top_ids = set(group.nlargest(count, "actual").index)
        for row_index, row in selected.iterrows():
            top_rows.append({
                "hit": row_index in actual_top_ids,
                "bust": row["actual"] < 0.5 * max(1.0, row[column]),
            })

    return {
        "n": int(len(frame)),
        "mae": round(mae(pred, actual), 3),
        "rmse": round(rmse(pred, actual), 3),
        "bias": round(float(np.mean(pred - actual)), 3),
        "within_position_spearman": None if rank_corr is None else round(rank_corr, 4),
        "top_tier_hit_rate": round(float(np.mean([row["hit"] for row in top_rows])), 4) if top_rows else None,
        "catastrophic_bust_rate": round(float(np.mean([row["bust"] for row in top_rows])), 4) if top_rows else None,
    }


def prepare_matrix(train: pd.DataFrame, test: pd.DataFrame, features: tuple[str, ...]) -> tuple[np.ndarray, np.ndarray]:
    train_values = []
    test_values = []
    for feature in features:
        train_col = pd.to_numeric(train[feature], errors="coerce")
        test_col = pd.to_numeric(test[feature], errors="coerce")
        median = float(train_col.median()) if train_col.notna().any() else 0.0
        train_col = train_col.fillna(median)
        test_col = test_col.fillna(median)
        scale = float(train_col.std(ddof=0))
        if not math.isfinite(scale) or scale < 1e-9:
            scale = 1.0
        train_values.append(((train_col - float(train_col.mean())) / scale).to_numpy(dtype=float))
        test_values.append(((test_col - float(train_col.mean())) / scale).to_numpy(dtype=float))
    return np.column_stack(train_values), np.column_stack(test_values)


def ridge_residual(train: pd.DataFrame, test: pd.DataFrame, base: str, features: tuple[str, ...], *, ridge: float, cap: float) -> np.ndarray:
    if len(train) < max(30, len(features) * 8):
        return test[base].to_numpy(dtype=float)
    x_train, x_test = prepare_matrix(train, test, features)
    x_train = np.column_stack([np.ones(len(x_train)), x_train])
    x_test = np.column_stack([np.ones(len(x_test)), x_test])
    penalty = np.eye(x_train.shape[1]) * ridge
    penalty[0, 0] = 0
    residual = train["actual"].to_numpy(dtype=float) - train[base].to_numpy(dtype=float)
    try:
        beta = np.linalg.solve(x_train.T @ x_train + penalty, x_train.T @ residual)
    except np.linalg.LinAlgError:
        beta = np.linalg.pinv(x_train.T @ x_train + penalty) @ x_train.T @ residual
    correction = x_test @ beta
    base_values = test[base].to_numpy(dtype=float)
    correction = np.clip(correction, -cap * np.maximum(1, base_values), cap * np.maximum(1, base_values))
    return np.maximum(0, base_values + correction)


def linear_calibration(train: pd.DataFrame, test: pd.DataFrame, base: str) -> np.ndarray:
    if len(train) < 30 or train[base].nunique() < 2:
        return test[base].to_numpy(dtype=float)
    x = train[base].to_numpy(dtype=float)
    y = train["actual"].to_numpy(dtype=float)
    design = np.column_stack([np.ones(len(x)), x])
    beta = np.linalg.lstsq(design, y, rcond=None)[0]
    # Broad but finite constraints prevent a tiny fold from inventing a reversed model.
    intercept = float(np.clip(beta[0], -80, 80))
    slope = float(np.clip(beta[1], 0.45, 1.20))
    return np.maximum(0, intercept + slope * test[base].to_numpy(dtype=float))


def within_position_shrink(frame: pd.DataFrame, column: str, alpha: float = 0.08) -> np.ndarray:
    result = pd.Series(index=frame.index, dtype=float)
    for (_, pos), group in frame.groupby(["season", "pos"]):
        top = group.nlargest(min(TOP_K[pos], len(group)), column)[column]
        target = float(top.mean()) if len(top) else float(group[column].mean())
        result.loc[group.index] = (1 - alpha) * group[column] + alpha * target
    return result.loc[frame.index].to_numpy(dtype=float)


def inverse_mae_weights(train: pd.DataFrame, pos: str) -> dict[str, float]:
    group = train[train["pos"] == pos]
    inverse = {}
    for source in SOURCE_NAMES:
        score = mae(group[source].to_numpy(dtype=float), group["actual"].to_numpy(dtype=float)) if len(group) else math.inf
        inverse[source] = 0 if not math.isfinite(score) or score <= 0 else 1 / score
    total = sum(inverse.values())
    return {source: (inverse[source] / total if total else 0.5) for source in SOURCE_NAMES}


def add_fold_predictions(history: pd.DataFrame, train_years: list[int], test_year: int) -> pd.DataFrame:
    train = history[history["season"].isin(train_years)].copy()
    test = history[history["season"] == test_year].copy()
    if test.empty:
        return test
    test["raw_primary"] = test["Sleeper"]
    test["raw_equal_blend"] = (test["Sleeper"] + test["ESPN"]) / 2
    weighted_parts = []
    for pos, group in test.groupby("pos"):
        weights = inverse_mae_weights(train, pos)
        values = group["Sleeper"] * weights["Sleeper"] + group["ESPN"] * weights["ESPN"]
        weighted_parts.append(pd.Series(values.to_numpy(), index=group.index))
    test["weighted_blend"] = pd.concat(weighted_parts).loc[test.index]
    test["within_position"] = within_position_shrink(test, "weighted_blend")

    outputs = []
    for pos, test_pos in test.groupby("pos"):
        train_pos = train[train["pos"] == pos].copy()
        # Recreate the preceding steps on training rows without using test outcomes.
        weights = inverse_mae_weights(train, pos)
        train_pos["raw_equal_blend"] = (train_pos["Sleeper"] + train_pos["ESPN"]) / 2
        train_pos["weighted_blend"] = train_pos["Sleeper"] * weights["Sleeper"] + train_pos["ESPN"] * weights["ESPN"]
        train_pos["within_position"] = within_position_shrink(train_pos, "weighted_blend")
        test_pos = test_pos.copy()
        test_pos["lean_mean_reversion"] = linear_calibration(train_pos, test_pos, "raw_equal_blend")
        test_pos["mean_reversion"] = linear_calibration(train_pos, test_pos, "within_position")
        train_pos["mean_reversion"] = linear_calibration(train_pos, train_pos, "within_position")
        test_pos["context_only"] = ridge_residual(
            train_pos, test_pos, "mean_reversion", FEATURE_CONTEXT, ridge=20, cap=0.15,
        )
        train_pos["context_only"] = ridge_residual(
            train_pos, train_pos, "mean_reversion", FEATURE_CONTEXT, ridge=20, cap=0.15,
        )
        test_pos["durability"] = ridge_residual(
            train_pos, test_pos, "context_only", FEATURE_DURABILITY, ridge=25, cap=0.18,
        )
        train_pos["durability"] = ridge_residual(
            train_pos, train_pos, "context_only", FEATURE_DURABILITY, ridge=25, cap=0.18,
        )
        test_pos["full_model"] = ridge_residual(
            train_pos, test_pos, "durability", FEATURE_FULL, ridge=35, cap=0.20,
        )
        outputs.append(test_pos)
    return pd.concat(outputs).sort_index()


def auction_values(frame: pd.DataFrame, projection_column: str) -> pd.Series:
    values = pd.Series(1.0, index=frame.index)
    vbd = pd.Series(0.0, index=frame.index)
    for pos, group in frame.groupby("pos"):
        ranked = group.sort_values([projection_column, "norm_name"], ascending=[False, True])
        baseline = float(ranked.iloc[min(len(ranked), STARTERS[pos]) - 1][projection_column])
        vbd.loc[group.index] = np.maximum(0, group[projection_column] - baseline)
    purchasable = vbd.nlargest(min(168, len(vbd)))
    total = float(purchasable.sum())
    if total <= 0:
        return values
    discretionary = 1212 - 168
    exact = 1 + discretionary * purchasable / total
    floors = np.floor(exact).astype(int)
    remainder = 1212 - int(floors.sum()) - (168 - len(purchasable))
    fractional = (exact - floors).sort_values(ascending=False)
    rounded = floors.copy()
    if remainder > 0:
        rounded.loc[fractional.index[:remainder]] += 1
    values.loc[rounded.index] = rounded
    return values


def auction_metrics(frame: pd.DataFrame, column: str) -> dict | None:
    rows = []
    for _, year in frame.groupby("season"):
        predicted = auction_values(year, column)
        priced = year[year["auction_paid"].notna()].copy()
        if priced.empty:
            continue
        priced["predicted_auction"] = predicted.loc[priced.index]
        rows.append(priced)
    if not rows:
        return None
    result = pd.concat(rows)
    return {
        "n": int(len(result)),
        "mae": round(mae(result["predicted_auction"].to_numpy(), result["auction_paid"].to_numpy()), 3),
        "bias": round(float(np.mean(result["predicted_auction"] - result["auction_paid"])), 3),
        "note": "Projection-only theoretical dollars versus actual Thunder Bowl price; the separate room-demand layer is intentionally absent.",
    }


def load_history(model_path: Path, history_path: Path) -> pd.DataFrame:
    model = pd.read_csv(model_path, low_memory=False)
    required_model_columns = {
        "name", "pos", "season", "tb_points", "tb_ppg", "games",
        "fp_over_expected", "total_xfp",
    }
    missing_model_columns = sorted(required_model_columns - set(model.columns))
    if missing_model_columns:
        raise SystemExit(f"Historical model is missing required columns: {', '.join(missing_model_columns)}")
    model = model[model["pos"].isin(POSITIONS)].copy()
    model["norm_name"] = model["name"].map(norm_name)
    model["season"] = pd.to_numeric(model["season"], errors="coerce")
    model["actual"] = pd.to_numeric(model["tb_points"], errors="coerce")
    model["auction_paid"] = pd.to_numeric(model.get("auction_paid"), errors="coerce")

    # The unified model intentionally stores raw season facts. Rebuild every
    # lag feature here so a schema refresh cannot silently drop time-forward
    # inputs or tempt the challenger to read same-season outcomes.
    if "gsis_id" in model.columns:
        stable_id = model["gsis_id"].fillna("").astype(str).str.strip()
        model["player_key"] = stable_id.where(stable_id.ne(""), model["norm_name"])
    else:
        model["player_key"] = model["norm_name"]
    model = model.sort_values(["player_key", "season"], kind="stable")
    grouped = model.groupby("player_key", sort=False)
    model["prev1_fp_over_expected"] = grouped["fp_over_expected"].shift(1)
    model["prev1_games"] = grouped["games"].shift(1)
    model["prev1_tb_ppg"] = grouped["tb_ppg"].shift(1)
    model["prev2_tb_ppg"] = grouped["tb_ppg"].shift(2)
    model["ppg_trend"] = model["prev1_tb_ppg"] - model["prev2_tb_ppg"]
    model["prev1_total_xfp"] = grouped["total_xfp"].shift(1)

    raw_history = json.loads(history_path.read_text(encoding="utf-8"))
    for source in SOURCE_NAMES:
        lookup = {
            (int(season), norm_name(name)): finite(points)
            for season, rows in raw_history.get(source, {}).items()
            for name, points in rows.items()
        }
        model[source] = [lookup.get((int(season), name)) if pd.notna(season) else None for season, name in zip(model["season"], model["norm_name"])]

    model["source_spread"] = np.abs(pd.to_numeric(model["Sleeper"], errors="coerce") - pd.to_numeric(model["ESPN"], errors="coerce"))
    required = ["season", "pos", "norm_name", "actual", *SOURCE_NAMES]
    history = model.dropna(subset=required).copy()
    history["season"] = history["season"].astype(int)
    return history[(history["season"] >= 2021) & (history["season"] <= 2025)]


def build_report(history: pd.DataFrame) -> dict:
    fold_frames = []
    fold_details = []
    for test_year in (2022, 2023, 2024, 2025):
        train_years = sorted(int(year) for year in history["season"].unique() if year < test_year)
        fold = add_fold_predictions(history, train_years, test_year)
        if fold.empty:
            continue
        fold_frames.append(fold)
        fold_details.append({"test_year": test_year, "train_years": train_years, "rows": int(len(fold))})
    scored = pd.concat(fold_frames).sort_values(["season", "pos", "norm_name"])
    variants = (
        "raw_primary", "raw_equal_blend", "weighted_blend", "within_position",
        "lean_mean_reversion", "mean_reversion", "context_only", "durability", "full_model",
    )
    metrics = {}
    for variant in variants:
        metrics[variant] = {
            "overall": projection_metrics(scored, variant),
            "by_position": {
                pos: projection_metrics(group, variant)
                for pos, group in scored.groupby("pos")
            },
            "auction": auction_metrics(scored, variant),
        }

    champion = "raw_primary"
    best = min(variants, key=lambda variant: metrics[variant]["overall"]["mae"])
    per_position_regressions = {
        pos: round(metrics[best]["by_position"][pos]["mae"] - metrics[champion]["by_position"][pos]["mae"], 3)
        for pos in POSITIONS
    }
    surrogate_gate_passed = (
        metrics[best]["overall"]["mae"] < metrics[champion]["overall"]["mae"]
        and all(delta <= 1.0 for delta in per_position_regressions.values())
        and best != "raw_primary"
    )
    candidate_formula = {}
    for pos, group in history.groupby("pos"):
        blend = ((group["Sleeper"] + group["ESPN"]) / 2).to_numpy(dtype=float)
        actual = group["actual"].to_numpy(dtype=float)
        design = np.column_stack([np.ones(len(blend)), blend])
        beta = np.linalg.lstsq(design, actual, rcond=None)[0]
        candidate_formula[pos] = {
            "n": int(len(group)),
            "intercept": round(float(np.clip(beta[0], -80, 80)), 6),
            "slope": round(float(np.clip(beta[1], 0.45, 1.20)), 6),
            "authority": "surrogate_candidate_only",
        }
    residual_intervals = {}
    for pos, group in scored.groupby("pos"):
        residual = group["actual"] - group[best]
        residual_intervals[pos] = {
            "n": int(len(group)),
            "p10": round(float(residual.quantile(0.10)), 3),
            "p90": round(float(residual.quantile(0.90)), 3),
            "coverage": round(float(((residual >= residual.quantile(0.10)) & (residual <= residual.quantile(0.90))).mean()), 4),
        }
    return {
        "schemaVersion": 1,
        "kind": "thunder-bowl-projection-ensemble-surrogate-backtest",
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "authority": "challenger_only",
        "scope": {
            "sources": list(SOURCE_NAMES),
            "seasons": sorted(int(year) for year in scored["season"].unique()),
            "rows": int(len(scored)),
            "method": "strict time-forward folds; each test season trains only on earlier seasons",
            "warning": "Historical premium FBG/CBS/FantasyPros snapshots are unavailable. This validates ensemble/sauce mechanics on archived Sleeper/ESPN projections, not the exact 2026 premium trio.",
        },
        "folds": fold_details,
        "metrics": metrics,
        "candidateFormula": {
            "form": "max(0, intercept[position] + slope[position] * equal_source_consensus)",
            "coefficients": candidate_formula,
            "warning": "Coefficients were learned on Sleeper/ESPN history and may not transfer unchanged to the FBG/CBS/FantasyPros trio.",
        },
        "candidateUncertainty": {
            "method": "time-forward out-of-fold residual deciles for the lowest-MAE surrogate challenger",
            "byPosition": residual_intervals,
            "authority": "surrogate_candidate_only",
        },
        "decision": {
            "reference": champion,
            "lowest_mae_variant": best,
            "position_mae_delta_vs_reference": per_position_regressions,
            "surrogateGatePassed": surrogate_gate_passed,
            "livePromotionEligible": False,
            "rule": "The surrogate must beat the reference overall with no position MAE regression greater than 1 point. Live premium-source promotion remains blocked until exact archived outcomes exist.",
        },
    }


def markdown(report: dict) -> str:
    lines = [
        "# Thunder Bowl projection ensemble surrogate backtest",
        "",
        f"Generated: {report['generatedAt']}",
        "",
        f"Decision: **{'SURROGATE GATE PASSED — LIVE PROMOTION STILL BLOCKED' if report['decision']['surrogateGatePassed'] else 'HOLD — CHALLENGER ONLY'}**",
        "",
        report["scope"]["warning"],
        "",
        "| Variant | N | MAE | RMSE | Bias | Spearman | Top-tier hit | Bust rate |",
        "|---|---:|---:|---:|---:|---:|---:|---:|",
    ]
    for name, detail in report["metrics"].items():
        row = detail["overall"]
        lines.append(
            f"| {name} | {row['n']} | {row['mae']:.3f} | {row['rmse']:.3f} | {row['bias']:.3f} | "
            f"{row['within_position_spearman'] or 0:.4f} | {row['top_tier_hit_rate'] or 0:.4f} | {row['catastrophic_bust_rate'] or 0:.4f} |"
        )
    lines.extend(["", "## Position MAE for lowest-error variant", ""])
    best = report["decision"]["lowest_mae_variant"]
    for pos in POSITIONS:
        value = report["metrics"][best]["by_position"][pos]["mae"]
        delta = report["decision"]["position_mae_delta_vs_reference"][pos]
        lines.append(f"- {pos}: {value:.3f} ({delta:+.3f} versus raw primary)")
    lines.extend([
        "",
        "## Authority",
        "",
        "This report cannot promote a live projection. Exact 2026 FBG/CBS/FantasyPros forecasts must remain candidate-only until their timestamped snapshots can be scored without retrospective leakage.",
    ])
    return "\n".join(lines) + "\n"


def parse_args() -> argparse.Namespace:
    repository_root = Path(__file__).resolve().parents[1]
    fantasy_root = Path(os.environ.get(
        "THUNDER_BOWL_FANTASY_ROOT",
        Path.home() / "Dropbox" / "Personal" / "FAMILY STUFF" / "Mike Stuff" / "Fantasy Football",
    ))
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--model",
        type=Path,
        default=fantasy_root / "_AGENT_HANDOFF" / "data" / "player_season_vbd.csv",
        help="Unified historical player-season model CSV.",
    )
    parser.add_argument(
        "--history",
        type=Path,
        default=fantasy_root / "_draft_app" / "cache" / "hist_projections.json",
        help="Archived Sleeper/ESPN preseason projection snapshots.",
    )
    parser.add_argument(
        "--json",
        type=Path,
        default=repository_root / "reports" / "thunder-bowl" / "projection-ensemble-surrogate-backtest-20260809.json",
        help="Machine-readable challenger report destination.",
    )
    parser.add_argument(
        "--markdown",
        type=Path,
        default=repository_root / "reports" / "thunder-bowl" / "projection-ensemble-surrogate-backtest-20260809.md",
        help="Human-readable challenger report destination.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    for label, path in (("model", args.model), ("history", args.history)):
        if not path.is_file():
            raise SystemExit(f"Missing {label} input: {path}")
    history = load_history(args.model, args.history)
    report = build_report(history)
    args.json.parent.mkdir(parents=True, exist_ok=True)
    args.markdown.parent.mkdir(parents=True, exist_ok=True)
    args.json.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    args.markdown.write_text(markdown(report), encoding="utf-8")
    print(json.dumps({
        "rows": report["scope"]["rows"],
        "best": report["decision"]["lowest_mae_variant"],
        "surrogateGatePassed": report["decision"]["surrogateGatePassed"],
        "livePromotionEligible": report["decision"]["livePromotionEligible"],
        "mae": {name: detail["overall"]["mae"] for name, detail in report["metrics"].items()},
    }, indent=2))


if __name__ == "__main__":
    main()
