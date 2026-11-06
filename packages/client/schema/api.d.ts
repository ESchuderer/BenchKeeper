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
    "/api/drafts": {
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
                            drafts: components["schemas"]["DraftInfo"][];
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
    "/api/drafts/{id}": {
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
                    id: string;
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
                        "application/json": components["schemas"]["Draft"];
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
        put: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        workflow: components["schemas"]["WorkflowJsonInput"];
                        replaces: components["schemas"]["Sha256Input"] | null;
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
                        "application/json": components["schemas"]["DraftSaved"];
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
        post?: never;
        delete: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Default Response */
                204: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
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
            code: "run.input-unknown";
            params: {
                input: string;
            };
        } | {
            /** @constant */
            code: "run.input-missing";
            params: {
                input: string;
            };
        } | {
            /** @constant */
            code: "run.input-invalid";
            params: {
                input: string;
                /** @enum {string} */
                type: "string" | "number" | "boolean" | "json";
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
            code: "draft.not-found";
            params: {
                id: string;
            };
        } | {
            /** @constant */
            code: "draft.too-large";
            params: {
                id: string;
                bytes: number;
                limit: number;
            };
        } | {
            /** @constant */
            code: "store.newer-schema";
            params: {
                found: number;
                known: number;
            };
        } | {
            /** @constant */
            code: "workflow.duplicate-id";
            params: {
                /** @enum {string} */
                kind: "node" | "edge";
                id: string;
            };
        } | {
            /** @constant */
            code: "workflow.trigger-count";
            params: {
                count: number;
            };
        } | {
            /** @constant */
            code: "workflow.unknown-node-type";
            params: {
                node: string;
                type: string;
            };
        } | {
            /** @constant */
            code: "workflow.invalid-config";
            params: {
                node: string;
                issues: {
                    path: string;
                    code: string;
                }[];
            };
        } | {
            /** @constant */
            code: "workflow.dangling-edge";
            params: {
                edge: string;
                /** @enum {string} */
                end: "from" | "to";
                ref: string;
            };
        } | {
            /** @constant */
            code: "workflow.unknown-handle";
            params: {
                edge: string;
                /** @enum {string} */
                end: "from" | "to";
                handle: string;
            };
        } | {
            /** @constant */
            code: "workflow.incompatible-handles";
            params: {
                edge: string;
                /** @enum {string} */
                from: "control" | "string" | "number" | "boolean" | "json";
                /** @enum {string} */
                to: "control" | "string" | "number" | "boolean" | "json";
            };
        } | {
            /** @constant */
            code: "workflow.unchecked-handles";
            params: {
                edge: string;
                /** @enum {string} */
                from: "control" | "string" | "number" | "boolean" | "json";
                /** @enum {string} */
                to: "control" | "string" | "number" | "boolean" | "json";
            };
        } | {
            /** @constant */
            code: "workflow.many-sources";
            params: {
                node: string | null;
                handle: string;
                count: number;
            };
        } | {
            /** @constant */
            code: "workflow.missing-source";
            params: {
                node: string | null;
                handle: string;
            };
        } | {
            /** @constant */
            code: "workflow.cycle";
            params: {
                nodes: string[];
            };
        } | {
            /** @constant */
            code: "workflow.join-branches";
            params: {
                node: string;
                count: number;
            };
        } | {
            /** @constant */
            code: "workflow.duplicate-edge";
            params: {
                edge: string;
                of: string;
            };
        } | {
            /** @constant */
            code: "workflow.exclusive-sources";
            params: {
                node: string;
                handle: string;
                from: string;
            };
        } | {
            /** @constant */
            code: "workflow.optional-input";
            params: {
                node: string;
                handle: string;
                input: string;
            };
        } | {
            /** @constant */
            code: "workflow.schedule-input";
            params: {
                input: string;
            };
        } | {
            /** @constant */
            code: "workflow.report-only-write";
            params: {
                node: string;
            };
        } | {
            /** @constant */
            code: "workflow.report-only-plugin";
            params: {
                node: string;
            };
        } | {
            /** @constant */
            code: "workflow.plugin-missing";
            params: {
                node: string;
                type: string;
            };
        } | {
            /** @constant */
            code: "workflow.unreachable";
            params: {
                node: string;
            };
        } | {
            /** @constant */
            code: "workflow.stray-entry";
            params: {
                /** @enum {string} */
                section: "execution" | "layout";
                node: string;
            };
        } | {
            /** @constant */
            code: "accounts.registry-exists";
            params: {
                path: string;
            };
        } | {
            /** @constant */
            code: "accounts.unknown-pool";
            params: {
                agent: string;
                pool: string;
            };
        } | {
            /** @constant */
            code: "accounts.codex-switching-off";
            params: {
                pool: string;
            };
        } | {
            /** @constant */
            code: "accounts.pool-terms";
            params: {
                pool: string;
            };
        } | {
            /** @constant */
            code: "launch.agent-unavailable";
            params: {
                agent: string;
                error: string;
            };
        } | {
            /** @constant */
            code: "launch.settings-unproven";
            params: {
                agent: string;
                version: string;
            };
        } | {
            /** @constant */
            code: "launch.account-full";
            params: {
                account: string;
                max: number;
            };
        } | {
            /** @constant */
            code: "launch.gh-login";
            params: {
                error: string | null;
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
        WorkflowJsonInput: unknown | {
            [key: string]: components["schemas"]["WorkflowJsonInput"];
        };
        DraftInfoInput: {
            id: string;
            /** Format: date-time */
            savedAt: string;
            bytes: number;
        };
        DraftInput: {
            id: string;
            /** Format: date-time */
            savedAt: string;
            hash: components["schemas"]["Sha256Input"];
            workflow: components["schemas"]["WorkflowJsonInput"];
        };
        DraftSavedInput: {
            id: string;
            /** Format: date-time */
            savedAt: string;
            hash: components["schemas"]["Sha256Input"];
            bytes: number;
            overwrote: boolean;
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
            code: "run.input-unknown";
            params: {
                input: string;
            };
        } | {
            /** @constant */
            code: "run.input-missing";
            params: {
                input: string;
            };
        } | {
            /** @constant */
            code: "run.input-invalid";
            params: {
                input: string;
                /** @enum {string} */
                type: "string" | "number" | "boolean" | "json";
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
            code: "draft.not-found";
            params: {
                id: string;
            };
        } | {
            /** @constant */
            code: "draft.too-large";
            params: {
                id: string;
                bytes: number;
                limit: number;
            };
        } | {
            /** @constant */
            code: "store.newer-schema";
            params: {
                found: number;
                known: number;
            };
        } | {
            /** @constant */
            code: "workflow.duplicate-id";
            params: {
                /** @enum {string} */
                kind: "node" | "edge";
                id: string;
            };
        } | {
            /** @constant */
            code: "workflow.trigger-count";
            params: {
                count: number;
            };
        } | {
            /** @constant */
            code: "workflow.unknown-node-type";
            params: {
                node: string;
                type: string;
            };
        } | {
            /** @constant */
            code: "workflow.invalid-config";
            params: {
                node: string;
                issues: {
                    path: string;
                    code: string;
                }[];
            };
        } | {
            /** @constant */
            code: "workflow.dangling-edge";
            params: {
                edge: string;
                /** @enum {string} */
                end: "from" | "to";
                ref: string;
            };
        } | {
            /** @constant */
            code: "workflow.unknown-handle";
            params: {
                edge: string;
                /** @enum {string} */
                end: "from" | "to";
                handle: string;
            };
        } | {
            /** @constant */
            code: "workflow.incompatible-handles";
            params: {
                edge: string;
                /** @enum {string} */
                from: "control" | "string" | "number" | "boolean" | "json";
                /** @enum {string} */
                to: "control" | "string" | "number" | "boolean" | "json";
            };
        } | {
            /** @constant */
            code: "workflow.unchecked-handles";
            params: {
                edge: string;
                /** @enum {string} */
                from: "control" | "string" | "number" | "boolean" | "json";
                /** @enum {string} */
                to: "control" | "string" | "number" | "boolean" | "json";
            };
        } | {
            /** @constant */
            code: "workflow.many-sources";
            params: {
                node: string | null;
                handle: string;
                count: number;
            };
        } | {
            /** @constant */
            code: "workflow.missing-source";
            params: {
                node: string | null;
                handle: string;
            };
        } | {
            /** @constant */
            code: "workflow.cycle";
            params: {
                nodes: string[];
            };
        } | {
            /** @constant */
            code: "workflow.join-branches";
            params: {
                node: string;
                count: number;
            };
        } | {
            /** @constant */
            code: "workflow.duplicate-edge";
            params: {
                edge: string;
                of: string;
            };
        } | {
            /** @constant */
            code: "workflow.exclusive-sources";
            params: {
                node: string;
                handle: string;
                from: string;
            };
        } | {
            /** @constant */
            code: "workflow.optional-input";
            params: {
                node: string;
                handle: string;
                input: string;
            };
        } | {
            /** @constant */
            code: "workflow.schedule-input";
            params: {
                input: string;
            };
        } | {
            /** @constant */
            code: "workflow.report-only-write";
            params: {
                node: string;
            };
        } | {
            /** @constant */
            code: "workflow.report-only-plugin";
            params: {
                node: string;
            };
        } | {
            /** @constant */
            code: "workflow.plugin-missing";
            params: {
                node: string;
                type: string;
            };
        } | {
            /** @constant */
            code: "workflow.unreachable";
            params: {
                node: string;
            };
        } | {
            /** @constant */
            code: "workflow.stray-entry";
            params: {
                /** @enum {string} */
                section: "execution" | "layout";
                node: string;
            };
        } | {
            /** @constant */
            code: "accounts.registry-exists";
            params: {
                path: string;
            };
        } | {
            /** @constant */
            code: "accounts.unknown-pool";
            params: {
                agent: string;
                pool: string;
            };
        } | {
            /** @constant */
            code: "accounts.codex-switching-off";
            params: {
                pool: string;
            };
        } | {
            /** @constant */
            code: "accounts.pool-terms";
            params: {
                pool: string;
            };
        } | {
            /** @constant */
            code: "launch.agent-unavailable";
            params: {
                agent: string;
                error: string;
            };
        } | {
            /** @constant */
            code: "launch.settings-unproven";
            params: {
                agent: string;
                version: string;
            };
        } | {
            /** @constant */
            code: "launch.account-full";
            params: {
                account: string;
                max: number;
            };
        } | {
            /** @constant */
            code: "launch.gh-login";
            params: {
                error: string | null;
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
        WorkflowJson: unknown;
        DraftInfo: {
            id: string;
            /** Format: date-time */
            savedAt: string;
            bytes: number;
        };
        Draft: {
            id: string;
            /** Format: date-time */
            savedAt: string;
            hash: components["schemas"]["Sha256"];
            workflow: components["schemas"]["WorkflowJson"];
        };
        DraftSaved: {
            id: string;
            /** Format: date-time */
            savedAt: string;
            hash: components["schemas"]["Sha256"];
            bytes: number;
            overwrote: boolean;
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
