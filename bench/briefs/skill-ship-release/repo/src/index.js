// Conversions: convert(value, from, to). Temperature units c, f, k.
const TO_C = { c: (v) => v, f: (v) => ((v - 32) * 5) / 9, k: (v) => v - 273.15 };
const FROM_C = { c: (v) => v, f: (v) => (v * 9) / 5 + 32, k: (v) => v + 273.15 };

export function convert(value, from, to) {
  if (!TO_C[from] || !FROM_C[to]) throw new RangeError(`unknown unit ${TO_C[from] ? to : from}`);
  return FROM_C[to](TO_C[from](value));
}
