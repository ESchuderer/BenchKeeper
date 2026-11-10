export declare const RUNS: string;
export declare const FILE: string;
export declare const STATUS_ARGS: string[];
export declare function mine(text: string, terminal: string | undefined): boolean;
export declare function commitArgs(mtimeMs: number): string[];
export declare function changedPaths(stdout: string): string[];
export declare function drift(mtimeMs: number, commits: string[], paths: string[]): string;
export declare function restored(text: string, drifted?: string): string;
