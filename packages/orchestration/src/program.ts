import { accessSync, constants, statSync } from "node:fs";
import { basename, delimiter, isAbsolute, join } from "node:path";

/** Whether this user may run the file; on Windows an .exe or .com, since a .cmd or .bat would run through a shell. */
export const runnable = (path: string): boolean => {
  try {
    if (!statSync(path).isFile()) return false;
    if (process.platform === "win32") return /\.(?:exe|com)$/i.test(path);
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
};

/** Why a program is not run: it is in no absolute folder of PATH. */
export const missing = (program: string): string => `ENOENT: no ${program} program in the absolute folders of PATH`;

/**
 * Where the program `name` is: a file in an absolute folder of the environment's PATH. A bare name is never spawned,
 * since Windows looks in the working folder, a project, before PATH (libuv's search_path:
 * https://github.com/libuv/libuv/blob/v1.x/src/win/process.c), and a relative or empty PATH entry follows it too. A
 * name with a folder in it stays as it is.
 */
export const programPath = (name: string, env: Readonly<Record<string, string | undefined>>): string | undefined => {
  if (basename(name) !== name) return name;
  const windows = process.platform === "win32";
  const names = !windows || /\.(?:exe|com)$/i.test(name) ? [name] : [`${name}.exe`, `${name}.com`];
  // On Windows the variable's name has any case, and a desktop spells it Path.
  const path = windows ? Object.entries(env).find(([key]) => key.toUpperCase() === "PATH")?.[1] : env["PATH"];
  const folders = (path ?? "").split(delimiter).filter((folder) => isAbsolute(folder));
  return folders.flatMap((folder) => names.map((each) => join(folder, each))).find(runnable);
};
