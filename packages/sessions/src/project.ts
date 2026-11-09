import { basename, dirname } from "node:path";
import { repositoryOf } from "@cedarloom/git";

/**
 * The project a session's folder belongs to: its repository's main worktree (a bare repository's own folder), else the
 * folder itself, as outside a repository or once the folder is gone.
 */
export const projectOf = (folder: string): string => {
  const repository = repositoryOf(folder);
  if (repository === null) return folder;
  const { root, gitDir, common } = repository;
  if (gitDir === common) return root;
  return basename(common) === ".git" ? dirname(common) : common;
};
