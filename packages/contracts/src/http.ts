// Constants of the local HTTP API, in a module without schemas, so a browser bundle can import them without zod.

/** The header that carries the session's CSRF token; a page of another origin can neither read the token nor send it. */
export const CSRF_HEADER = "x-cedarloom-csrf";

/** The time zone the sessions board counts days in: the IANA name given, if this runtime knows it, else UTC. */
export const zoneOf = (zone: string | undefined): string => {
  try {
    return zone === undefined
      ? "UTC"
      : (new Intl.DateTimeFormat("en", { timeZone: zone }).resolvedOptions().timeZone ?? "UTC");
  } catch {
    return "UTC";
  }
};

/** The calendar day (YYYY-MM-DD) an instant falls on in a zone `zoneOf` gave; one formatter serves every instant. */
export const dayIn = (zone: string): ((iso: string) => string) => {
  const format = new Intl.DateTimeFormat("en", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" });
  return (iso) => {
    const part = new Map(format.formatToParts(Date.parse(iso)).map(({ type, value }) => [type, value]));
    return `${part.get("year")}-${part.get("month")}-${part.get("day")}`;
  };
};
