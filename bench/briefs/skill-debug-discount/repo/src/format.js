// Cents as a price for display: 1234 -> '12.34 EUR'.
export const formatCents = (cents) => `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')} EUR`;
