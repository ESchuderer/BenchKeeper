import { fetchTreeOver } from "./git.ts";

// The tests fetch local fixtures over file:// with fetchTreeOver; every other source goes through fetchTree.
export {
  type FetchOptions,
  fetchTreeOver,
  LIMITS,
  type Limits,
  type Source,
  type Tree,
  type TreeFile,
} from "./git.ts";
export { type Repository, repositoryOf } from "./repository.ts";
export { type Commit, openStore, type Store } from "./store.ts";

/** Fetches a tree over https and ssh only; see `fetchTreeOver`. */
export const fetchTree = fetchTreeOver(["https", "ssh"]);
