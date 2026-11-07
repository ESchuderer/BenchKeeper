import { fetchTreeOver } from "./git.ts";

// fetchTreeOver takes the transports git may use: the tests fetch local fixtures over file:// with it, every source
// from elsewhere goes through fetchTree.
export {
  type FetchOptions,
  fetchTreeOver,
  LIMITS,
  type Limits,
  type Source,
  type Tree,
  type TreeFile,
  worktreeOf,
} from "./git.ts";
export { type Commit, openStore, type Store } from "./store.ts";

/** Fetches a tree over https and ssh only; see `fetchTreeOver`. */
export const fetchTree = fetchTreeOver(["https", "ssh"]);
