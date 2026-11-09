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
    "/api/imports": {
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
                        git: string;
                        ref: string;
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
                        "application/json": components["schemas"]["ImportPreview"];
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
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/imports/{importId}/apply": {
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
                path: {
                    importId: string;
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
    "/api/profile": {
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
                        "application/json": components["schemas"]["ProfileView"];
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
    "/api/profile/parts/{part}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    part: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        on: boolean;
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
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/accounts": {
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
                        "application/json": components["schemas"]["SwapAccounts"];
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
    "/api/accounts/switch": {
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
                        account: number;
                        allow: boolean;
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
                        "application/json": components["schemas"]["SwapApproval"] | {
                            switched: boolean;
                            from?: number;
                            to: number;
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
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/accounts/settings": {
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
                        /** @enum {string} */
                        key: "autoswitch.threshold" | "autoswitch.weeklyThreshold";
                        value: number;
                        allow: boolean;
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
                        "application/json": components["schemas"]["SwapApproval"] | {
                            settings: {
                                [key: string]: string | number | boolean;
                            };
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
        /** @description text/event-stream: `runs` events with RunsEvent (the runs), `refusal` events with Refusal */
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
        GitOidInput: string;
        StoreUpdateInput: {
            /** @constant */
            kind: "store.update";
            /** @constant */
            ref: "refs/heads/main";
            before: components["schemas"]["GitOidInput"] | null;
            after: components["schemas"]["GitOidInput"] | null;
        };
        OperationInput: components["schemas"]["WriteFileInput"] | components["schemas"]["DeleteFileInput"] | components["schemas"]["StoreUpdateInput"];
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
                path?: string;
            };
        } | {
            /** @constant */
            code: "document.invalid";
            params: {
                issues: {
                    path: string;
                    code: string;
                    char?: string;
                }[];
                path?: string;
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
            code: "run.node-unsupported";
            params: {
                node: string;
                type: string;
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
            code: "import.not-found";
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
            code: "store.older-schema";
            params: {
                dir: string;
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
                    char?: string;
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
            code: "workflow.skill-name";
            params: {
                node: string;
                name: string;
            };
        } | {
            /** @constant */
            code: "workflow.duplicate-skill";
            params: {
                node: string;
                name: string;
                of: string;
            };
        } | {
            /** @constant */
            code: "workflow.check-source";
            params: {
                node: string;
                from: string;
            };
        } | {
            /** @constant */
            code: "workflow.check-output";
            params: {
                node: string;
                handle: string;
            };
        } | {
            /** @constant */
            code: "package.two-stages";
            params: {
                node: string;
            };
        } | {
            /** @constant */
            code: "package.cross-stage";
            params: {
                edge: string;
            };
        } | {
            /** @constant */
            code: "package.name-taken";
            params: {
                name: string;
                node: string;
            };
        } | {
            /** @constant */
            code: "package.reserved-name";
            params: {
                name: string;
            };
        } | {
            /** @constant */
            code: "package.approval-needed";
            params: {
                id: string;
                plugin: string;
                /** @enum {string} */
                level: "supervised" | "checkpoint" | "auto";
                commands: string[];
            };
        } | {
            /** @constant */
            code: "package.hooks-missing";
            params: {
                path: string;
            };
        } | {
            /** @constant */
            code: "package.not-installed";
            params: {
                id: string;
            };
        } | {
            /** @constant */
            code: "package.plugin-taken";
            params: {
                plugin: string;
                id: string;
            };
        } | {
            /** @constant */
            code: "package.levels-mixed";
            params: {
                id: string;
                /** @enum {string} */
                level: "supervised" | "checkpoint" | "auto";
                other: string;
                /** @enum {string} */
                otherLevel: "supervised" | "checkpoint" | "auto";
            };
        } | {
            /** @constant */
            code: "package.codex-missing";
            params: {
                plugin: string;
                id: string;
            };
        } | {
            /** @constant */
            code: "package.codex-stale";
            params: {
                plugin: string;
                id: string;
            };
        } | {
            /** @constant */
            code: "package.codex-left";
            params: {
                plugin: string;
            };
        } | {
            /** @constant */
            code: "package.node-missing";
            params: {
                plugin: string;
                path: string;
                id: string | null;
                level: ("supervised" | "checkpoint" | "auto") | null;
            };
        } | {
            /** @constant */
            code: "automation.unknown-folder";
            params: {
                path: string;
            };
        } | {
            /** @constant */
            code: "git.failed";
            params: {
                /** @enum {string} */
                step: "start" | "fetch" | "list" | "read" | "commit" | "update";
                error: string;
            };
        } | {
            /** @constant */
            code: "store.conflict";
            params: {
                id: string;
            };
        } | {
            /** @constant */
            code: "store.version-not-higher";
            params: {
                id: string;
                stored: string;
                found: string;
            };
        } | {
            /** @constant */
            code: "store.identity-missing";
            params: {
                /** @enum {string} */
                key: "user.name" | "user.email";
            };
        } | {
            /** @constant */
            code: "store.moved";
            params: {
                ref: string;
                expected: components["schemas"]["GitOidInput"] | null;
                actual: components["schemas"]["GitOidInput"] | null;
            };
        } | {
            /** @constant */
            code: "store.not-found";
            params: {
                id: string;
                commit: string | null;
            };
        } | {
            /** @constant */
            code: "store.draft-exists";
            params: {
                id: string;
            };
        } | {
            /** @constant */
            code: "git.refused-source";
            params: {
                /** @enum {string} */
                field: "url" | "ref" | "path";
            };
        } | {
            /** @constant */
            code: "git.unsafe-entry";
            params: {
                path: string;
                /** @enum {string} */
                kind: "link" | "submodule" | "name" | "case";
            };
        } | {
            /** @constant */
            code: "extension.refused";
            params: {
                extension: string;
                /** @enum {string} */
                reason: "sandbox-unavailable" | "windows" | "protocol" | "actions" | "folder" | "runtime" | "off" | "programs";
            };
        } | {
            /** @constant */
            code: "extension.install-refused";
            params: {
                extension: string | null;
                /** @enum {string} */
                reason: "no-manifest" | "entry" | "protocol" | "installed" | "id" | "reserved" | "programs";
            };
        } | {
            /** @constant */
            code: "extension.unknown";
            params: {
                extension: string;
            };
        } | {
            /** @constant */
            code: "extension.consent-needed";
            params: {
                extension: string;
            };
        } | {
            /** @constant */
            code: "extension.failed";
            params: {
                extension: string;
                /** @enum {string} */
                step: "stage" | "start" | "initialize" | "run" | "doctor";
                error: string;
            };
        } | {
            /** @constant */
            code: "extension.finding";
            params: {
                extension: string;
                check: string;
                /** @enum {string} */
                severity: "error" | "warning" | "info";
                code: string;
                message: string;
            };
        } | {
            /** @constant */
            code: "profile.foreign-kind";
            params: {
                kind: string;
            };
        } | {
            /** @constant */
            code: "profile.secret-like";
            params: {
                path: string;
            };
        } | {
            /** @constant */
            code: "profile.forbidden-setting";
            params: {
                path: string;
            };
        } | {
            /** @constant */
            code: "profile.parent-unknown";
            params: {
                pack: string;
                path: string;
            };
        } | {
            /** @constant */
            code: "profile.parent-cycle";
            params: {
                chain: string[];
            };
        } | {
            /** @constant */
            code: "profile.parent-limit";
            params: {
                chain: string[];
                limit: number;
            };
        } | {
            /** @constant */
            code: "profile.pack-sources";
            params: {
                pack: string;
                files: string[];
            };
        } | {
            /** @constant */
            code: "profile.entry-unknown";
            params: {
                pack: string;
                path: string;
                /** @enum {string} */
                kind: "rules" | "template" | "profile" | "skill";
            };
        } | {
            /** @constant */
            code: "profile.app-too-old";
            params: {
                minApp: string;
                app: string;
            };
        } | {
            /** @constant */
            code: "profile.part-unknown";
            params: {
                part: string;
                by: string;
            };
        } | {
            /** @constant */
            code: "profile.part-requires";
            params: {
                part: string;
                requires: string;
            };
        } | {
            /** @constant */
            code: "profile.owner-changed";
            params: {
                path: string;
            };
        } | {
            /** @constant */
            code: "profile.placeholder-unknown";
            params: {
                at: string;
                placeholder: string;
            };
        } | {
            /** @constant */
            code: "profile.binding-missing";
            params: {
                part: string;
                /** @enum {string} */
                binding: "hub" | "gates";
            };
        } | {
            /** @constant */
            code: "profile.drift";
            params: {
                /** @enum {string} */
                status: "missing" | "outdated" | "deselected-present" | "not-run";
                subject: string;
                remove: string | null;
            };
        } | {
            /** @constant */
            code: "profile.extra";
            params: {
                item: string;
            };
        } | {
            /** @constant */
            code: "profile.remove-unknown";
            params: {
                item: string;
            };
        } | {
            /** @constant */
            code: "profile.copy-exists";
            params: {
                path: string;
            };
        } | {
            /** @constant */
            code: "profile.newer-pack";
            params: {
                path: string;
                recorded: string;
                local: string;
            };
        } | {
            /** @constant */
            code: "profile.binding-waiting";
            params: {
                part: string;
                /** @enum {string} */
                binding: "gates";
            };
        } | {
            /** @constant */
            code: "profile.when-unmet";
            params: {
                part: string;
                /** @enum {string} */
                when: "orca";
            };
        } | {
            /** @constant */
            code: "profile.approval-needed";
            params: {
                part: string;
                plugin: string;
                source: string | null;
                ref: string | null;
                autoUpdate: boolean;
                project: string | null;
            };
        } | {
            /** @constant */
            code: "profile.options-guarded";
            params: {
                part: string;
                path: string;
            };
        } | {
            /** @constant */
            code: "profile.target-approval";
            params: {
                part: string;
                title: string;
                project: string;
                source: string | null;
                programs: string[];
                configs: string[];
            };
        } | {
            /** @constant */
            code: "profile.template-failed";
            params: {
                part: string;
                template: string;
                error: string;
            };
        } | {
            /** @constant */
            code: "profile.target-twice";
            params: {
                part: string;
                target: string;
            };
        } | {
            /** @constant */
            code: "profile.skill-twice";
            params: {
                folder: string;
                skills: string[];
            };
        } | {
            /** @constant */
            code: "profile.skill-plugin";
            params: {
                skill: string;
                path: string;
            };
        } | {
            /** @constant */
            code: "profile.target-linked";
            params: {
                part: string;
                target: string;
                path: string;
            };
        } | {
            /** @constant */
            code: "profile.agents-unread";
            params: {
                path: string;
            };
        } | {
            /** @constant */
            code: "profile.pack-unpinned";
            params: {
                source: string;
                path: string;
            };
        } | {
            /** @constant */
            code: "profile.source-digest";
            params: {
                source: string;
                expected: string;
                found: string;
            };
        } | {
            /** @constant */
            code: "profile.source-waiting";
            params: {
                source: string;
                commit: string;
                offered: string;
            };
        } | {
            /** @constant */
            code: "profile.source-unavailable";
            params: {
                source: string;
                commit: string;
            };
        } | {
            /** @constant */
            code: "git.too-large";
            params: {
                path: string | null;
                found: number;
                limit: number;
                /** @enum {string} */
                unit: "files" | "bytes";
            };
        } | {
            /** @constant */
            code: "outbox.not-approved";
            params: {
                key: string;
                hash: components["schemas"]["Sha256Input"];
                approvedHash: string;
            };
        } | {
            /** @constant */
            code: "outbox.not-found";
            params: {
                id: string;
            };
        } | {
            /** @constant */
            code: "outbox.key-taken";
            params: {
                key: string;
                id: string;
            };
        } | {
            /** @constant */
            code: "outbox.not-hub";
            params: {
                id: string;
                repo: string;
            };
        } | {
            /** @constant */
            code: "outbox.status";
            params: {
                id: string;
                status: string;
            };
        } | {
            /** @constant */
            code: "outbox.not-undoable";
            params: {
                id: string;
                /** @enum {string} */
                reason: "unchanged" | "no-inverse";
            };
        } | {
            /** @constant */
            code: "tracker.unavailable";
            params: {
                error: string;
                retryAfter: string | null;
                rateLimitReset: string | null;
            };
        } | {
            /** @constant */
            code: "tracker.refused";
            params: {
                status: number;
                error: string;
            };
        } | {
            /** @constant */
            code: "tracker.invalid-answer";
            params: {
                error: string;
            };
        } | {
            /** @constant */
            code: "managed.guard-off";
            params: {
                path: string;
                key: string;
            };
        } | {
            /** @constant */
            code: "managed.unreadable";
            params: {
                path: string;
                error: string;
            };
        } | {
            /** @constant */
            code: "work-items.no-hub";
            params: Record<string, never>;
        } | {
            /** @constant */
            code: "work-items.not-hub";
            params: {
                repo: string;
                hub: string;
            };
        } | {
            /** @constant */
            code: "secret.missing";
            params: {
                name: string;
            };
        } | {
            /** @constant */
            code: "secret.unavailable";
            params: {
                name: string;
                error: string;
            };
        } | {
            /** @constant */
            code: "secret.not-fine-grained";
            params: {
                name: string;
            };
        } | {
            /** @constant */
            code: "secret.no-input";
            params: {
                name: string;
            };
        };
        ImportReviewInput: {
            source: {
                folder: string;
            } | {
                git: string;
                ref: string;
                commit: string;
            };
            units: {
                id: string;
                /** @enum {string} */
                status: "new" | "same" | "update" | "conflict";
                version: string;
                stored: string | null;
                license: string | null;
                changes: {
                    added: string[];
                    removed: string[];
                    changed: string[];
                };
            }[];
            risks: {
                workflow: string;
                node: string;
                /** @enum {string} */
                kind: "schedule" | "precheck" | "command" | "agent" | "approval" | "input" | "workflow";
                text: string;
            }[];
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
            before: (components["schemas"]["Sha256Input"] | components["schemas"]["GitOidInput"]) | null;
            after: (components["schemas"]["Sha256Input"] | components["schemas"]["GitOidInput"]) | null;
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
                } | components["schemas"]["StoreUpdateInput"])[];
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
                } | components["schemas"]["StoreUpdateInput"])[];
            } | null;
            findings: components["schemas"]["FindingInput"][];
        };
        ImportPreviewInput: {
            id: string | null;
            review: components["schemas"]["ImportReviewInput"];
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
                } | components["schemas"]["StoreUpdateInput"])[];
            } | null;
        };
        ProfilePartInput: {
            id: string;
            /** @enum {string} */
            level: "machine" | "workspace" | "project";
            title: string;
            description: string | null;
            on: boolean;
            when: ("orca" | "devcontainer" | "no-devcontainer" | "gates") | null;
        };
        ProfileViewInput: {
            parts: components["schemas"]["ProfilePartInput"][];
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
                } | components["schemas"]["StoreUpdateInput"])[];
            } | null;
            findings: components["schemas"]["FindingInput"][];
            held: boolean;
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
        SwapAccountInput: {
            number: number;
            alias?: string;
            active: boolean;
            disabled: boolean;
            held: boolean;
            threshold: number | null;
            windows: {
                window: string;
                usedPercent: number;
                resetsAt: string | null;
                readAt: string | null;
            }[];
        };
        SwapAccountsInput: {
            accounts: components["schemas"]["SwapAccountInput"][];
            settings: {
                [key: string]: string | number | boolean;
            };
        };
        SwapApprovalInput: {
            runs: string;
            approve: string;
        };
        AgentSessionInput: {
            /** @enum {string} */
            agent: "claude-code";
            id: string;
            project: string | null;
            title: string | null;
            /** Format: date-time */
            start: string;
            /** Format: date-time */
            end: string;
            busyMs: number | null;
            tokens: number;
            costUSD: number | null;
            tests: ("pass" | "fail") | null;
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
        GitOid: string;
        StoreUpdate: {
            /** @constant */
            kind: "store.update";
            /** @constant */
            ref: "refs/heads/main";
            before: components["schemas"]["GitOid"] | null;
            after: components["schemas"]["GitOid"] | null;
        };
        Operation: components["schemas"]["WriteFile"] | components["schemas"]["DeleteFile"] | components["schemas"]["StoreUpdate"];
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
                path?: string;
            };
        } | {
            /** @constant */
            code: "document.invalid";
            params: {
                issues: {
                    path: string;
                    code: string;
                    char?: string;
                }[];
                path?: string;
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
            code: "run.node-unsupported";
            params: {
                node: string;
                type: string;
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
            code: "import.not-found";
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
            code: "store.older-schema";
            params: {
                dir: string;
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
                    char?: string;
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
            code: "workflow.skill-name";
            params: {
                node: string;
                name: string;
            };
        } | {
            /** @constant */
            code: "workflow.duplicate-skill";
            params: {
                node: string;
                name: string;
                of: string;
            };
        } | {
            /** @constant */
            code: "workflow.check-source";
            params: {
                node: string;
                from: string;
            };
        } | {
            /** @constant */
            code: "workflow.check-output";
            params: {
                node: string;
                handle: string;
            };
        } | {
            /** @constant */
            code: "package.two-stages";
            params: {
                node: string;
            };
        } | {
            /** @constant */
            code: "package.cross-stage";
            params: {
                edge: string;
            };
        } | {
            /** @constant */
            code: "package.name-taken";
            params: {
                name: string;
                node: string;
            };
        } | {
            /** @constant */
            code: "package.reserved-name";
            params: {
                name: string;
            };
        } | {
            /** @constant */
            code: "package.approval-needed";
            params: {
                id: string;
                plugin: string;
                /** @enum {string} */
                level: "supervised" | "checkpoint" | "auto";
                commands: string[];
            };
        } | {
            /** @constant */
            code: "package.hooks-missing";
            params: {
                path: string;
            };
        } | {
            /** @constant */
            code: "package.not-installed";
            params: {
                id: string;
            };
        } | {
            /** @constant */
            code: "package.plugin-taken";
            params: {
                plugin: string;
                id: string;
            };
        } | {
            /** @constant */
            code: "package.levels-mixed";
            params: {
                id: string;
                /** @enum {string} */
                level: "supervised" | "checkpoint" | "auto";
                other: string;
                /** @enum {string} */
                otherLevel: "supervised" | "checkpoint" | "auto";
            };
        } | {
            /** @constant */
            code: "package.codex-missing";
            params: {
                plugin: string;
                id: string;
            };
        } | {
            /** @constant */
            code: "package.codex-stale";
            params: {
                plugin: string;
                id: string;
            };
        } | {
            /** @constant */
            code: "package.codex-left";
            params: {
                plugin: string;
            };
        } | {
            /** @constant */
            code: "package.node-missing";
            params: {
                plugin: string;
                path: string;
                id: string | null;
                level: ("supervised" | "checkpoint" | "auto") | null;
            };
        } | {
            /** @constant */
            code: "automation.unknown-folder";
            params: {
                path: string;
            };
        } | {
            /** @constant */
            code: "git.failed";
            params: {
                /** @enum {string} */
                step: "start" | "fetch" | "list" | "read" | "commit" | "update";
                error: string;
            };
        } | {
            /** @constant */
            code: "store.conflict";
            params: {
                id: string;
            };
        } | {
            /** @constant */
            code: "store.version-not-higher";
            params: {
                id: string;
                stored: string;
                found: string;
            };
        } | {
            /** @constant */
            code: "store.identity-missing";
            params: {
                /** @enum {string} */
                key: "user.name" | "user.email";
            };
        } | {
            /** @constant */
            code: "store.moved";
            params: {
                ref: string;
                expected: components["schemas"]["GitOid"] | null;
                actual: components["schemas"]["GitOid"] | null;
            };
        } | {
            /** @constant */
            code: "store.not-found";
            params: {
                id: string;
                commit: string | null;
            };
        } | {
            /** @constant */
            code: "store.draft-exists";
            params: {
                id: string;
            };
        } | {
            /** @constant */
            code: "git.refused-source";
            params: {
                /** @enum {string} */
                field: "url" | "ref" | "path";
            };
        } | {
            /** @constant */
            code: "git.unsafe-entry";
            params: {
                path: string;
                /** @enum {string} */
                kind: "link" | "submodule" | "name" | "case";
            };
        } | {
            /** @constant */
            code: "extension.refused";
            params: {
                extension: string;
                /** @enum {string} */
                reason: "sandbox-unavailable" | "windows" | "protocol" | "actions" | "folder" | "runtime" | "off" | "programs";
            };
        } | {
            /** @constant */
            code: "extension.install-refused";
            params: {
                extension: string | null;
                /** @enum {string} */
                reason: "no-manifest" | "entry" | "protocol" | "installed" | "id" | "reserved" | "programs";
            };
        } | {
            /** @constant */
            code: "extension.unknown";
            params: {
                extension: string;
            };
        } | {
            /** @constant */
            code: "extension.consent-needed";
            params: {
                extension: string;
            };
        } | {
            /** @constant */
            code: "extension.failed";
            params: {
                extension: string;
                /** @enum {string} */
                step: "stage" | "start" | "initialize" | "run" | "doctor";
                error: string;
            };
        } | {
            /** @constant */
            code: "extension.finding";
            params: {
                extension: string;
                check: string;
                /** @enum {string} */
                severity: "error" | "warning" | "info";
                code: string;
                message: string;
            };
        } | {
            /** @constant */
            code: "profile.foreign-kind";
            params: {
                kind: string;
            };
        } | {
            /** @constant */
            code: "profile.secret-like";
            params: {
                path: string;
            };
        } | {
            /** @constant */
            code: "profile.forbidden-setting";
            params: {
                path: string;
            };
        } | {
            /** @constant */
            code: "profile.parent-unknown";
            params: {
                pack: string;
                path: string;
            };
        } | {
            /** @constant */
            code: "profile.parent-cycle";
            params: {
                chain: string[];
            };
        } | {
            /** @constant */
            code: "profile.parent-limit";
            params: {
                chain: string[];
                limit: number;
            };
        } | {
            /** @constant */
            code: "profile.pack-sources";
            params: {
                pack: string;
                files: string[];
            };
        } | {
            /** @constant */
            code: "profile.entry-unknown";
            params: {
                pack: string;
                path: string;
                /** @enum {string} */
                kind: "rules" | "template" | "profile" | "skill";
            };
        } | {
            /** @constant */
            code: "profile.app-too-old";
            params: {
                minApp: string;
                app: string;
            };
        } | {
            /** @constant */
            code: "profile.part-unknown";
            params: {
                part: string;
                by: string;
            };
        } | {
            /** @constant */
            code: "profile.part-requires";
            params: {
                part: string;
                requires: string;
            };
        } | {
            /** @constant */
            code: "profile.owner-changed";
            params: {
                path: string;
            };
        } | {
            /** @constant */
            code: "profile.placeholder-unknown";
            params: {
                at: string;
                placeholder: string;
            };
        } | {
            /** @constant */
            code: "profile.binding-missing";
            params: {
                part: string;
                /** @enum {string} */
                binding: "hub" | "gates";
            };
        } | {
            /** @constant */
            code: "profile.drift";
            params: {
                /** @enum {string} */
                status: "missing" | "outdated" | "deselected-present" | "not-run";
                subject: string;
                remove: string | null;
            };
        } | {
            /** @constant */
            code: "profile.extra";
            params: {
                item: string;
            };
        } | {
            /** @constant */
            code: "profile.remove-unknown";
            params: {
                item: string;
            };
        } | {
            /** @constant */
            code: "profile.copy-exists";
            params: {
                path: string;
            };
        } | {
            /** @constant */
            code: "profile.newer-pack";
            params: {
                path: string;
                recorded: string;
                local: string;
            };
        } | {
            /** @constant */
            code: "profile.binding-waiting";
            params: {
                part: string;
                /** @enum {string} */
                binding: "gates";
            };
        } | {
            /** @constant */
            code: "profile.when-unmet";
            params: {
                part: string;
                /** @enum {string} */
                when: "orca";
            };
        } | {
            /** @constant */
            code: "profile.approval-needed";
            params: {
                part: string;
                plugin: string;
                source: string | null;
                ref: string | null;
                autoUpdate: boolean;
                project: string | null;
            };
        } | {
            /** @constant */
            code: "profile.options-guarded";
            params: {
                part: string;
                path: string;
            };
        } | {
            /** @constant */
            code: "profile.target-approval";
            params: {
                part: string;
                title: string;
                project: string;
                source: string | null;
                programs: string[];
                configs: string[];
            };
        } | {
            /** @constant */
            code: "profile.template-failed";
            params: {
                part: string;
                template: string;
                error: string;
            };
        } | {
            /** @constant */
            code: "profile.target-twice";
            params: {
                part: string;
                target: string;
            };
        } | {
            /** @constant */
            code: "profile.skill-twice";
            params: {
                folder: string;
                skills: string[];
            };
        } | {
            /** @constant */
            code: "profile.skill-plugin";
            params: {
                skill: string;
                path: string;
            };
        } | {
            /** @constant */
            code: "profile.target-linked";
            params: {
                part: string;
                target: string;
                path: string;
            };
        } | {
            /** @constant */
            code: "profile.agents-unread";
            params: {
                path: string;
            };
        } | {
            /** @constant */
            code: "profile.pack-unpinned";
            params: {
                source: string;
                path: string;
            };
        } | {
            /** @constant */
            code: "profile.source-digest";
            params: {
                source: string;
                expected: string;
                found: string;
            };
        } | {
            /** @constant */
            code: "profile.source-waiting";
            params: {
                source: string;
                commit: string;
                offered: string;
            };
        } | {
            /** @constant */
            code: "profile.source-unavailable";
            params: {
                source: string;
                commit: string;
            };
        } | {
            /** @constant */
            code: "git.too-large";
            params: {
                path: string | null;
                found: number;
                limit: number;
                /** @enum {string} */
                unit: "files" | "bytes";
            };
        } | {
            /** @constant */
            code: "outbox.not-approved";
            params: {
                key: string;
                hash: components["schemas"]["Sha256"];
                approvedHash: string;
            };
        } | {
            /** @constant */
            code: "outbox.not-found";
            params: {
                id: string;
            };
        } | {
            /** @constant */
            code: "outbox.key-taken";
            params: {
                key: string;
                id: string;
            };
        } | {
            /** @constant */
            code: "outbox.not-hub";
            params: {
                id: string;
                repo: string;
            };
        } | {
            /** @constant */
            code: "outbox.status";
            params: {
                id: string;
                status: string;
            };
        } | {
            /** @constant */
            code: "outbox.not-undoable";
            params: {
                id: string;
                /** @enum {string} */
                reason: "unchanged" | "no-inverse";
            };
        } | {
            /** @constant */
            code: "tracker.unavailable";
            params: {
                error: string;
                retryAfter: string | null;
                rateLimitReset: string | null;
            };
        } | {
            /** @constant */
            code: "tracker.refused";
            params: {
                status: number;
                error: string;
            };
        } | {
            /** @constant */
            code: "tracker.invalid-answer";
            params: {
                error: string;
            };
        } | {
            /** @constant */
            code: "managed.guard-off";
            params: {
                path: string;
                key: string;
            };
        } | {
            /** @constant */
            code: "managed.unreadable";
            params: {
                path: string;
                error: string;
            };
        } | {
            /** @constant */
            code: "work-items.no-hub";
            params: Record<string, never>;
        } | {
            /** @constant */
            code: "work-items.not-hub";
            params: {
                repo: string;
                hub: string;
            };
        } | {
            /** @constant */
            code: "secret.missing";
            params: {
                name: string;
            };
        } | {
            /** @constant */
            code: "secret.unavailable";
            params: {
                name: string;
                error: string;
            };
        } | {
            /** @constant */
            code: "secret.not-fine-grained";
            params: {
                name: string;
            };
        } | {
            /** @constant */
            code: "secret.no-input";
            params: {
                name: string;
            };
        };
        ImportReview: {
            source: {
                folder: string;
            } | {
                git: string;
                ref: string;
                commit: string;
            };
            units: {
                id: string;
                /** @enum {string} */
                status: "new" | "same" | "update" | "conflict";
                version: string;
                stored: string | null;
                license: string | null;
                changes: {
                    added: string[];
                    removed: string[];
                    changed: string[];
                };
            }[];
            risks: {
                workflow: string;
                node: string;
                /** @enum {string} */
                kind: "schedule" | "precheck" | "command" | "agent" | "approval" | "input" | "workflow";
                text: string;
            }[];
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
            before: (components["schemas"]["Sha256"] | components["schemas"]["GitOid"]) | null;
            after: (components["schemas"]["Sha256"] | components["schemas"]["GitOid"]) | null;
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
                } | components["schemas"]["StoreUpdate"])[];
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
                } | components["schemas"]["StoreUpdate"])[];
            } | null;
            findings: components["schemas"]["Finding"][];
        };
        ImportPreview: {
            id: string | null;
            review: components["schemas"]["ImportReview"];
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
                } | components["schemas"]["StoreUpdate"])[];
            } | null;
        };
        ProfilePart: {
            id: string;
            /** @enum {string} */
            level: "machine" | "workspace" | "project";
            title: string;
            description: string | null;
            on: boolean;
            when: ("orca" | "devcontainer" | "no-devcontainer" | "gates") | null;
        };
        ProfileView: {
            parts: components["schemas"]["ProfilePart"][];
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
                } | components["schemas"]["StoreUpdate"])[];
            } | null;
            findings: components["schemas"]["Finding"][];
            held: boolean;
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
        SwapAccount: {
            number: number;
            alias?: string;
            active: boolean;
            disabled: boolean;
            held: boolean;
            threshold: number | null;
            windows: {
                window: string;
                usedPercent: number;
                resetsAt: string | null;
                readAt: string | null;
            }[];
        };
        SwapAccounts: {
            accounts: components["schemas"]["SwapAccount"][];
            settings: {
                [key: string]: string | number | boolean;
            };
        };
        SwapApproval: {
            runs: string;
            approve: string;
        };
        AgentSession: {
            /** @enum {string} */
            agent: "claude-code";
            id: string;
            project: string | null;
            title: string | null;
            /** Format: date-time */
            start: string;
            /** Format: date-time */
            end: string;
            busyMs: number | null;
            tokens: number;
            costUSD: number | null;
            tests: ("pass" | "fail") | null;
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
