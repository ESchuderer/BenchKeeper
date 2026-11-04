import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

// Mount types whose locking or write ordering SQLite's WAL mode cannot rely on.
const NETWORK = new Set([
  "9p",
  "afpfs",
  "afs",
  "ceph",
  "cifs",
  "coda",
  "davfs",
  "fuse.rclone",
  "fuse.s3fs",
  "fuse.sshfs",
  "glusterfs",
  "gpfs",
  "lustre",
  "ncpfs",
  "nfs",
  "nfs4",
  "smb",
  "smb2",
  "smb3",
  "smbfs",
  "sshfs",
  "webdav",
]);

export const isNetworkFilesystem = (fsType: string): boolean => NETWORK.has(fsType);

/** A macOS `mount` line, `<device> on <mount point> (<type>, <options>)`, by plain slicing (no backtracking regex). */
const macMount = (line: string): [string, string] | undefined => {
  const on = line.indexOf(" on ");
  const options = line.lastIndexOf(" (");
  if (on === -1 || options < on || !line.endsWith(")")) return undefined;
  const inside = line.slice(options + 2, -1);
  const comma = inside.indexOf(",");
  return [line.slice(on + 4, options), comma === -1 ? inside : inside.slice(0, comma)];
};

/** `[mount point, type]` pairs from Linux `/proc/self/mounts` (space, tab, newline and backslash as octal escapes) or macOS `mount` output. */
export const parseMounts = (text: string): [string, string][] =>
  text.split("\n").flatMap((line): [string, string][] => {
    const mac = macMount(line);
    if (mac) return [mac];
    const [, point, type] = line.split(" ");
    const unescaped = point?.replace(/\\([0-7]{3})/g, (_, octal: string) =>
      String.fromCharCode(Number.parseInt(octal, 8)),
    );
    return unescaped && type ? [[unescaped, type]] : [];
  });

/** The type of the mount that holds `dir` (the longest mount point that contains it). */
export const mountType = (dir: string, mounts: [string, string][]): string | undefined => {
  const inside = mounts.filter(([point]) => dir === point || dir.startsWith(point === "/" ? "/" : `${point}/`));
  return inside.toSorted(([a], [b]) => b.length - a.length)[0]?.[1];
};

// shortcut: Windows detects UNC paths only, not a mapped network drive letter; add GetDriveType through a probe if one shows up.
export const filesystemType = (dir: string): string | undefined => {
  if (dir.startsWith("\\\\")) return "smb";
  return mountType(dir, parseMounts(mountTable()));
};

const mountTable = (): string => {
  /* v8 ignore start -- each branch runs on its own platform only */
  if (process.platform === "linux") return readFileSync("/proc/self/mounts", "utf8");
  if (process.platform === "darwin") return execFileSync("/sbin/mount", { encoding: "utf8" });
  return "";
  /* v8 ignore stop */
};
