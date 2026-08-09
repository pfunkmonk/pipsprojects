export const FBG_AUCTION_VALUE_CONFIGURATION = Object.freeze({
  status: "incompatible_with_thunder_bowl",
  auditedAt: "2026-08-08T21:00:00-06:00",
  source: "2026 DD.ddf",
  modelEffect: "none",
  issueCount: 23,
  issues: Object.freeze([
    Object.freeze({ setting: "Roster rounds", thunderBowl: 14, suppliedDdf: 18 }),
    Object.freeze({ setting: "Starting WR", thunderBowl: 2, suppliedDdf: 3 }),
    Object.freeze({ setting: "Passing yards per point", thunderBowl: 25, suppliedDdf: 20 }),
    Object.freeze({ setting: "Passing TD points", thunderBowl: 6, suppliedDdf: 4 }),
    Object.freeze({ setting: "Passing interception", thunderBowl: -2, suppliedDdf: -1 }),
    Object.freeze({ setting: "RB reception points", thunderBowl: 1, suppliedDdf: 0 }),
    Object.freeze({ setting: "WR reception points", thunderBowl: 1, suppliedDdf: 0 }),
    Object.freeze({ setting: "TE reception points", thunderBowl: 1, suppliedDdf: 0 }),
    Object.freeze({ setting: "QB fumble lost", thunderBowl: -2, suppliedDdf: 0 }),
    Object.freeze({ setting: "RB fumble lost", thunderBowl: -2, suppliedDdf: 0 }),
    Object.freeze({ setting: "WR fumble lost", thunderBowl: -2, suppliedDdf: 0 }),
    Object.freeze({ setting: "TE fumble lost", thunderBowl: -2, suppliedDdf: 0 }),
    Object.freeze({ setting: "DST sack points", thunderBowl: 2, suppliedDdf: 1 }),
    Object.freeze({ setting: "DST interception points", thunderBowl: 2, suppliedDdf: 1 }),
    Object.freeze({ setting: "DST forced fumble points", thunderBowl: 0, suppliedDdf: 1 }),
    Object.freeze({ setting: "40-49 yard FG", thunderBowl: 3, suppliedDdf: 4 }),
    Object.freeze({ setting: "DST points allowed: 0", thunderBowl: 10, suppliedDdf: 5 }),
    Object.freeze({ setting: "DST points allowed: 1-6", thunderBowl: 8, suppliedDdf: 4 }),
    Object.freeze({ setting: "DST points allowed: 7-13", thunderBowl: 6, suppliedDdf: 3 }),
    Object.freeze({ setting: "DST points allowed: 14-20", thunderBowl: 4, suppliedDdf: 2 }),
    Object.freeze({ setting: "DST points allowed: 21-34", thunderBowl: 0, suppliedDdf: 1 }),
    Object.freeze({ setting: "DST points allowed: 35-44", thunderBowl: -4, suppliedDdf: 0 }),
    Object.freeze({ setting: "DST points allowed: 45+", thunderBowl: -6, suppliedDdf: 0 }),
  ]),
});

export function fbgAuctionValueCompatibilityText(audit = FBG_AUCTION_VALUE_CONFIGURATION) {
  if (audit.status === "compatible") return "FBG setup matches Thunder Bowl.";
  return `Caution: the supplied FBG PDF differs from Thunder Bowl in ${audit.issueCount || audit.issues.length} roster/scoring fields (including non-PPR, 4-point passing TDs, one-point sacks, 18 rounds, and three starting WRs). Its ranks are directional; its raw dollars are not Thunder Bowl-compatible.`;
}
