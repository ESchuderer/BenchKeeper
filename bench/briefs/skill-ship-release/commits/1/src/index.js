// Conversions: convert(value, from, to). Temperature units c, f, k; length units m, ft, in.
const TO_C = { c: (v) => v, f: (v) => ((v - 32) * 5) / 9, k: (v) => v - 273.15 };
const FROM_C = { c: (v) => v, f: (v) => (v * 9) / 5 + 32, k: (v) => v + 273.15 };
const METRES = { m: 1, ft: 0.3048, in: 0.0254 };

export function convert(value, from, to) {
  if (METRES[from] && METRES[to]) return (value * METRES[from]) / METRES[to];
  if (!TO_C[from] || !FROM_C[to]) throw new RangeError(`unknown unit ${TO_C[from] || METRES[from] ? to : from}`);
  return FROM_C[to](TO_C[from](value));
}
