export function snakeTeamId(order, step) {
  if (!Array.isArray(order) || !order.length) throw new Error("Nomination order is required.");
  if (!Number.isInteger(step) || step < 0) throw new Error("Nomination step must be a non-negative whole number.");
  const leg = Math.floor(step / order.length);
  const offset = step % order.length;
  return leg % 2 === 0 ? order[offset] : order[order.length - 1 - offset];
}

export function snakeNominationSequence(order, count) {
  return Array.from({ length: count }, (_, step) => snakeTeamId(order, step));
}
