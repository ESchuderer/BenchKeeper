import { canonicalJson, JsonValue, type Profile } from "@cedarloom/contracts";
import { LEVELS, partsOf } from "./resolve.ts";

/** How a profile differs from another by one of its fields or parts. */
export type ProfileChange = { change: "added" | "removed" | "changed"; key: string };

const levels: readonly string[] = LEVELS;
// Each field of a profile and each of its parts as `level.id`, by canonical JSON, so the order of keys does not count.
const flat = (profile: Profile): Map<string, string> =>
  new Map(
    [...Object.entries(profile).filter(([key]) => !levels.includes(key)), ...partsOf(profile)].map(([key, value]) => [
      key,
      canonicalJson(JsonValue.parse(value)),
    ]),
  );

/** What `mine` adds to `theirs`, removes from it or changes, by field and by part, in `theirs`' order first. */
export const profileChanges = (mine: Profile, theirs: Profile): ProfileChange[] => {
  const [a, b] = [flat(mine), flat(theirs)];
  return [...new Set([...b.keys(), ...a.keys()])].flatMap((key): ProfileChange[] => {
    if (!b.has(key)) return [{ change: "added", key }];
    if (!a.has(key)) return [{ change: "removed", key }];
    return a.get(key) === b.get(key) ? [] : [{ change: "changed", key }];
  });
};
