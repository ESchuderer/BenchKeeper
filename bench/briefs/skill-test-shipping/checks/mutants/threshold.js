// Shipping cost in cents (rules: README.md).
const BASE = { domestic: 490, eu: 990, world: 1990 };
const PER_STEP = { domestic: 100, eu: 250, world: 600 };
const INCLUDED = 1000;
const STEP = 500;
const FREE_FROM = 5000;

export function shippingCost({ weight, subtotal, zone, express = false }) {
  if (!Number.isInteger(weight) || weight <= 0) throw new RangeError(`invalid weight ${weight}`);
  if (!Object.hasOwn(BASE, zone)) throw new RangeError(`unknown zone ${zone}`);
  if (zone === 'domestic' && !express && subtotal > FREE_FROM) return 0;
  const steps = weight > INCLUDED ? Math.ceil((weight - INCLUDED) / STEP) : 0;
  const cost = BASE[zone] + steps * PER_STEP[zone];
  return express ? cost * 2 : cost;
}
