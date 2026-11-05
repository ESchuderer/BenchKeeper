// Generated from packages/server/openapi.json by `pnpm --filter @cedarloom/client generate`; do not edit.
export interface paths {
    "/api/session": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        token: string;
                    };
                };
            };
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            csrf: string;
                        };
                    };
                };
                /** @description Default Response */
                default: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/runs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            runs: components["schemas"]["Run"][];
                        };
                    };
                };
                /** @description Default Response */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Refusal"];
                    };
                };
                /** @description Default Response */
                default: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/runs/{runId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    runId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            run: components["schemas"]["Run"];
                            steps: components["schemas"]["Step"][];
                        };
                    };
                };
                /** @description Default Response */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Refusal"];
                    };
                };
                /** @description Default Response */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Refusal"];
                    };
                };
                /** @description Default Response */
                default: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/doctor": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            findings: components["schemas"]["Finding"][];
                        };
                    };
                };
                /** @description Default Response */
                default: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/runs/{runId}/undo": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    runId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["UndoPreview"];
                    };
                };
                /** @description Default Response */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Refusal"];
                    };
                };
                /** @description Default Response */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Refusal"];
                    };
                };
                /** @description Default Response */
                default: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
            };
        };
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    runId: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        approve: components["schemas"]["Sha256Input"];
                    };
                };
            };
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["RunResult"];
                    };
                };
                /** @description Default Response */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Refusal"];
                    };
                };
                /** @description Default Response */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["RunResult"] | components["schemas"]["Refusal"];
                    };
                };
                /** @description Default Response */
                default: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/events": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description text/event-stream: `runs` events with RunsEvent, `refusal` events with Refusal */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        SchemaVersionInput: number;
        Sha256Input: string;
        WriteFileInput: {
            /** @constant */
            kind: "write";
            path: string;
            before: components["schemas"]["Sha256Input"] | null;
            content: string;
            mode?: number;
        };
        DeleteFileInput: {
            /** @constant */
            kind: "delete";
            path: string;
            before: components["schemas"]["Sha256Input"];
        };
        OperationInput: components["schemas"]["WriteFileInput"] | components["schemas"]["DeleteFileInput"];
        PlanInput: {
            /** @constant */
            schemaVersion: 1;
            operations: components["schemas"]["OperationInput"][];
        };
        FindingInput: {
            /** @constant */
            code: "document.unreadable";
            params: {
                path: string;
                error: string;
            };
        } | {
            /** @constant */
            code: "document.newer-schema";
            params: {
                found: components["schemas"]["SchemaVersionInput"];
                known: components["schemas"]["SchemaVersionInput"];
            };
        } | {
            /** @constant */
            code: "document.invalid";
            params: {
                issues: {
                    path: string;
                    code: string;
                }[];
            };
        } | {
            /** @constant */
            code: "plan.not-approved";
            params: {
                planHash: components["schemas"]["Sha256Input"];
                approvedHash: string;
            };
        } | {
            /** @constant */
            code: "plan.path-not-absolute";
            params: {
                path: string;
            };
        } | {
            /** @constant */
            code: "plan.not-a-file";
            params: {
                path: string;
                error: string;
            };
        } | {
            /** @constant */
            code: "plan.chain-broken";
            params: {
                path: string;
                index: number;
                expected: components["schemas"]["Sha256Input"] | null;
                found: components["schemas"]["Sha256Input"] | null;
            };
        } | {
            /** @constant */
            code: "plan.file-changed";
            params: {
                path: string;
                expected: components["schemas"]["Sha256Input"] | null;
                actual: components["schemas"]["Sha256Input"] | null;
            };
        } | {
            /** @constant */
            code: "apply.symlink";
            params: {
                path: string;
            };
        } | {
            /** @constant */
            code: "apply.not-text";
            params: {
                path: string;
            };
        } | {
            /** @constant */
            code: "apply.backup-failed";
            params: {
                path: string;
                error: string;
            };
        } | {
            /** @constant */
            code: "apply.write-failed";
            params: {
                path: string;
                error: string;
            };
        } | {
            /** @constant */
            code: "apply.write-mismatch";
            params: {
                path: string;
                expected: components["schemas"]["Sha256Input"] | null;
                actual: components["schemas"]["Sha256Input"] | null;
            };
        } | {
            /** @constant */
            code: "run.not-found";
            params: {
                runId: string;
            };
        } | {
            /** @constant */
            code: "run.interrupted";
            params: {
                runId: string;
                undoes: string | null;
            };
        } | {
            /** @constant */
            code: "run.failed";
            params: {
                runId: string;
                undoes: string | null;
            };
        } | {
            /** @constant */
            code: "undo.file-edited";
            params: {
                runId: string;
                path: string;
            };
        } | {
            /** @constant */
            code: "undo.backup-missing";
            params: {
                runId: string;
                path: string;
            };
        } | {
            /** @constant */
            code: "undo.backup-changed";
            params: {
                runId: string;
                path: string;
            };
        } | {
            /** @constant */
            code: "store.busy";
            params: {
                dir: string;
            };
        } | {
            /** @constant */
            code: "store.network-filesystem";
            params: {
                dir: string;
                fsType: string;
            };
        } | {
            /** @constant */
            code: "store.newer-schema";
            params: {
                found: number;
                known: number;
            };
        };
        RunInput: {
            id: string;
            /** @enum {string} */
            kind: "apply" | "undo";
            undoes: string | null;
            planHash: components["schemas"]["Sha256Input"];
            /** @enum {string} */
            status: "running" | "applied" | "failed" | "interrupted";
            epoch: number;
            /** Format: date-time */
            startedAt: string;
            finishedAt: string | null;
        };
        StepInput: {
            index: number;
            path: string;
            before: components["schemas"]["Sha256Input"] | null;
            after: components["schemas"]["Sha256Input"] | null;
            /** @enum {string} */
            state: "pending" | "running" | "done" | "skipped";
            mode: number | null;
        };
        PlanPreviewInput: {
            planHash: components["schemas"]["Sha256Input"];
            plan: {
                /** @constant */
                schemaVersion: 1;
                operations: (components["schemas"]["DeleteFileInput"] | {
                    /** @constant */
                    kind: "write";
                    path: string;
                    before: components["schemas"]["Sha256Input"] | null;
                    mode?: number;
                    after: components["schemas"]["Sha256Input"];
                    bytes: number;
                })[];
            };
        };
        UndoPreviewInput: {
            planHash: components["schemas"]["Sha256Input"] | null;
            plan: {
                /** @constant */
                schemaVersion: 1;
                operations: (components["schemas"]["DeleteFileInput"] | {
                    /** @constant */
                    kind: "write";
                    path: string;
                    before: components["schemas"]["Sha256Input"] | null;
                    mode?: number;
                    after: components["schemas"]["Sha256Input"];
                    bytes: number;
                })[];
            } | null;
            findings: components["schemas"]["FindingInput"][];
        };
        RunResultInput: {
            runId: string | null;
            /** @enum {string} */
            status: "applied" | "failed" | "refused" | "nothing-to-undo";
            findings: components["schemas"]["FindingInput"][];
        };
        RefusalInput: {
            findings: components["schemas"]["FindingInput"][];
        };
        RunsEventInput: {
            runs: components["schemas"]["RunInput"][];
        };
        SchemaVersion: number;
        Sha256: string;
        WriteFile: {
            /** @constant */
            kind: "write";
            path: string;
            before: components["schemas"]["Sha256"] | null;
            content: string;
            mode?: number;
        };
        DeleteFile: {
            /** @constant */
            kind: "delete";
            path: string;
            before: components["schemas"]["Sha256"];
        };
        Operation: components["schemas"]["WriteFile"] | components["schemas"]["DeleteFile"];
        Plan: {
            /** @constant */
            schemaVersion: 1;
            operations: components["schemas"]["Operation"][];
        };
        Finding: {
            /** @constant */
            code: "document.unreadable";
            params: {
                path: string;
                error: string;
            };
        } | {
            /** @constant */
            code: "document.newer-schema";
            params: {
                found: components["schemas"]["SchemaVersion"];
                known: components["schemas"]["SchemaVersion"];
            };
        } | {
            /** @constant */
            code: "document.invalid";
            params: {
                issues: {
                    path: string;
                    code: string;
                }[];
            };
        } | {
            /** @constant */
            code: "plan.not-approved";
            params: {
                planHash: components["schemas"]["Sha256"];
                approvedHash: string;
            };
        } | {
            /** @constant */
            code: "plan.path-not-absolute";
            params: {
                path: string;
            };
        } | {
            /** @constant */
            code: "plan.not-a-file";
            params: {
                path: string;
                error: string;
            };
        } | {
            /** @constant */
            code: "plan.chain-broken";
            params: {
                path: string;
                index: number;
                expected: components["schemas"]["Sha256"] | null;
                found: components["schemas"]["Sha256"] | null;
            };
        } | {
            /** @constant */
            code: "plan.file-changed";
            params: {
                path: string;
                expected: components["schemas"]["Sha256"] | null;
                actual: components["schemas"]["Sha256"] | null;
            };
        } | {
            /** @constant */
            code: "apply.symlink";
            params: {
                path: string;
            };
        } | {
            /** @constant */
            code: "apply.not-text";
            params: {
                path: string;
            };
        } | {
            /** @constant */
            code: "apply.backup-failed";
            params: {
                path: string;
                error: string;
            };
        } | {
            /** @constant */
            code: "apply.write-failed";
            params: {
                path: string;
                error: string;
            };
        } | {
            /** @constant */
            code: "apply.write-mismatch";
            params: {
                path: string;
                expected: components["schemas"]["Sha256"] | null;
                actual: components["schemas"]["Sha256"] | null;
            };
        } | {
            /** @constant */
            code: "run.not-found";
            params: {
                runId: string;
            };
        } | {
            /** @constant */
            code: "run.interrupted";
            params: {
                runId: string;
                undoes: string | null;
            };
        } | {
            /** @constant */
            code: "run.failed";
            params: {
                runId: string;
                undoes: string | null;
            };
        } | {
            /** @constant */
            code: "undo.file-edited";
            params: {
                runId: string;
                path: string;
            };
        } | {
            /** @constant */
            code: "undo.backup-missing";
            params: {
                runId: string;
                path: string;
            };
        } | {
            /** @constant */
            code: "undo.backup-changed";
            params: {
                runId: string;
                path: string;
            };
        } | {
            /** @constant */
            code: "store.busy";
            params: {
                dir: string;
            };
        } | {
            /** @constant */
            code: "store.network-filesystem";
            params: {
                dir: string;
                fsType: string;
            };
        } | {
            /** @constant */
            code: "store.newer-schema";
            params: {
                found: number;
                known: number;
            };
        };
        Run: {
            id: string;
            /** @enum {string} */
            kind: "apply" | "undo";
            undoes: string | null;
            planHash: components["schemas"]["Sha256"];
            /** @enum {string} */
            status: "running" | "applied" | "failed" | "interrupted";
            epoch: number;
            /** Format: date-time */
            startedAt: string;
            finishedAt: string | null;
        };
        Step: {
            index: number;
            path: string;
            before: components["schemas"]["Sha256"] | null;
            after: components["schemas"]["Sha256"] | null;
            /** @enum {string} */
            state: "pending" | "running" | "done" | "skipped";
            mode: number | null;
        };
        PlanPreview: {
            planHash: components["schemas"]["Sha256"];
            plan: {
                /** @constant */
                schemaVersion: 1;
                operations: (components["schemas"]["DeleteFile"] | {
                    /** @constant */
                    kind: "write";
                    path: string;
                    before: components["schemas"]["Sha256"] | null;
                    mode?: number;
                    after: components["schemas"]["Sha256"];
                    bytes: number;
                })[];
            };
        };
        UndoPreview: {
            planHash: components["schemas"]["Sha256"] | null;
            plan: {
                /** @constant */
                schemaVersion: 1;
                operations: (components["schemas"]["DeleteFile"] | {
                    /** @constant */
                    kind: "write";
                    path: string;
                    before: components["schemas"]["Sha256"] | null;
                    mode?: number;
                    after: components["schemas"]["Sha256"];
                    bytes: number;
                })[];
            } | null;
            findings: components["schemas"]["Finding"][];
        };
        RunResult: {
            runId: string | null;
            /** @enum {string} */
            status: "applied" | "failed" | "refused" | "nothing-to-undo";
            findings: components["schemas"]["Finding"][];
        };
        Refusal: {
            findings: components["schemas"]["Finding"][];
        };
        RunsEvent: {
            runs: components["schemas"]["Run"][];
        };
    };
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export type operations = Record<string, never>;
