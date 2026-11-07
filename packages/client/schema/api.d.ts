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
            code: "run.event-invalid";
            params: {
                runId: string;
                seq: number;
                issues: {
                    path: string;
                    code: string;
                }[];
            };
        } | {
            /** @constant */
            code: "run.lease-held";
            params: {
                runId: string;
                pid: number;
            };
        } | {
            /** @constant */
            code: "run.finished";
            params: {
                runId: string;
                status: string;
            };
        } | {
            /** @constant */
            code: "run.not-waiting";
            params: {
                runId: string;
                node: string;
            };
        } | {
            /** @constant */
            code: "run.report-only-apply";
            params: {
                runId: string;
                applyRun: string;
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
            code: "run.shell-missing";
            params: Record<string, never>;
        } | {
            /** @constant */
            code: "run.project-mismatch";
            params: {
                runId: string;
                project: string;
                given: string;
            };
        } | {
            /** @constant */
            code: "run.project-missing";
            params: {
                project: string;
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
            code: "workflow.report-only-extension";
            params: {
                node: string;
            };
        } | {
            /** @constant */
            code: "workflow.extension-missing";
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
            code: "accounts.unknown-account";
            params: {
                account: string;
            };
        } | {
            /** @constant */
            code: "accounts.name-taken";
            params: {
                account: string;
            };
        } | {
            /** @constant */
            code: "accounts.name-invalid";
            params: {
                name: string;
            };
        } | {
            /** @constant */
            code: "accounts.login-unsupported";
            params: {
                account: string;
                agent: string;
            };
        } | {
            /** @constant */
            code: "accounts.folder-taken";
            params: {
                path: string;
            };
        } | {
            /** @constant */
            code: "accounts.home-not-own";
            params: {
                account: string;
                home: string;
            };
        } | {
            /** @constant */
            code: "accounts.home-linked";
            params: {
                account: string;
                path: string;
            };
        } | {
            /** @constant */
            code: "accounts.home-missing";
            params: {
                account: string;
                home: string;
            };
        } | {
            /** @constant */
            code: "accounts.home-unusable";
            params: {
                account: string;
                path: string;
                error: string;
            };
        } | {
            /** @constant */
            code: "accounts.map-refused";
            params: {
                /** @enum {string} */
                reason: "unknown-target" | "no-folder" | "not-mapped";
                name: string;
            };
        } | {
            /** @constant */
            code: "accounts.login-failed";
            params: {
                account: string;
                error: string;
            };
        } | {
            /** @constant */
            code: "doctor.logged-out";
            params: {
                account: string;
                home: string;
            };
        } | {
            /** @constant */
            code: "doctor.login-elsewhere";
            params: {
                account: string;
                home: string;
                configDirectory: string;
            };
        } | {
            /** @constant */
            code: "doctor.login-method";
            params: {
                account: string;
                method: string;
            };
        } | {
            /** @constant */
            code: "doctor.login-unchecked";
            params: {
                account: string;
                error: string;
            };
        } | {
            /** @constant */
            code: "doctor.login-skipped";
            params: {
                account: string;
            };
        } | {
            /** @constant */
            code: "automation.unknown-folder";
            params: {
                path: string;
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
        } | {
            /** @constant */
            code: "launch.sandbox-overridden";
            params: {
                path: string;
                key: string;
            };
        } | {
            /** @constant */
            code: "launch.not-logged-in";
            params: {
                account: string;
                reason: string;
            };
        } | {
            /** @constant */
            code: "doctor.plugin-none";
            params: {
                plugin: string;
                commit: string;
            };
        } | {
            /** @constant */
            code: "doctor.plugin-not-loaded";
            params: {
                plugin: string;
                errors: string;
            };
        } | {
            /** @constant */
            code: "launch.managed-settings-unreadable";
            params: {
                path: string;
                error: string;
            };
        } | {
            /** @constant */
            code: "git.failed";
            params: {
                /** @enum {string} */
                step: "start" | "fetch" | "list" | "read" | "worktree" | "commit" | "update";
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
            code: "extension.digest-mismatch";
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
                binding: "hub";
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
                kind: "schedule" | "precheck" | "command" | "agent" | "write" | "workflow" | "extension";
                text: string;
            }[];
            extensions: {
                id: string;
                version: string;
                git: string;
                commit: string;
                path?: string;
                digest: components["schemas"]["Sha256Input"];
                /** @enum {string} */
                status: "verified" | "mismatch" | "unreachable";
                installed: boolean;
                capabilities: {
                    net?: string[];
                    credentials?: {
                        [key: string]: {
                            description?: string;
                            scheme: {
                                /** @constant */
                                type: "http";
                                /** @enum {string} */
                                scheme: "bearer" | "basic";
                            } | {
                                /** @constant */
                                type: "apiKey";
                                /** @constant */
                                in: "header";
                                name: string;
                            };
                            hosts: string[];
                        };
                    };
                    projectRead?: boolean;
                    planWrite?: boolean;
                    programs?: {
                        [key: string]: {
                            darwin?: string[];
                            linux?: string[];
                            win32?: string[];
                        };
                    };
                } | null;
            }[];
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
            code: "run.event-invalid";
            params: {
                runId: string;
                seq: number;
                issues: {
                    path: string;
                    code: string;
                }[];
            };
        } | {
            /** @constant */
            code: "run.lease-held";
            params: {
                runId: string;
                pid: number;
            };
        } | {
            /** @constant */
            code: "run.finished";
            params: {
                runId: string;
                status: string;
            };
        } | {
            /** @constant */
            code: "run.not-waiting";
            params: {
                runId: string;
                node: string;
            };
        } | {
            /** @constant */
            code: "run.report-only-apply";
            params: {
                runId: string;
                applyRun: string;
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
            code: "run.shell-missing";
            params: Record<string, never>;
        } | {
            /** @constant */
            code: "run.project-mismatch";
            params: {
                runId: string;
                project: string;
                given: string;
            };
        } | {
            /** @constant */
            code: "run.project-missing";
            params: {
                project: string;
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
            code: "workflow.report-only-extension";
            params: {
                node: string;
            };
        } | {
            /** @constant */
            code: "workflow.extension-missing";
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
            code: "accounts.unknown-account";
            params: {
                account: string;
            };
        } | {
            /** @constant */
            code: "accounts.name-taken";
            params: {
                account: string;
            };
        } | {
            /** @constant */
            code: "accounts.name-invalid";
            params: {
                name: string;
            };
        } | {
            /** @constant */
            code: "accounts.login-unsupported";
            params: {
                account: string;
                agent: string;
            };
        } | {
            /** @constant */
            code: "accounts.folder-taken";
            params: {
                path: string;
            };
        } | {
            /** @constant */
            code: "accounts.home-not-own";
            params: {
                account: string;
                home: string;
            };
        } | {
            /** @constant */
            code: "accounts.home-linked";
            params: {
                account: string;
                path: string;
            };
        } | {
            /** @constant */
            code: "accounts.home-missing";
            params: {
                account: string;
                home: string;
            };
        } | {
            /** @constant */
            code: "accounts.home-unusable";
            params: {
                account: string;
                path: string;
                error: string;
            };
        } | {
            /** @constant */
            code: "accounts.map-refused";
            params: {
                /** @enum {string} */
                reason: "unknown-target" | "no-folder" | "not-mapped";
                name: string;
            };
        } | {
            /** @constant */
            code: "accounts.login-failed";
            params: {
                account: string;
                error: string;
            };
        } | {
            /** @constant */
            code: "doctor.logged-out";
            params: {
                account: string;
                home: string;
            };
        } | {
            /** @constant */
            code: "doctor.login-elsewhere";
            params: {
                account: string;
                home: string;
                configDirectory: string;
            };
        } | {
            /** @constant */
            code: "doctor.login-method";
            params: {
                account: string;
                method: string;
            };
        } | {
            /** @constant */
            code: "doctor.login-unchecked";
            params: {
                account: string;
                error: string;
            };
        } | {
            /** @constant */
            code: "doctor.login-skipped";
            params: {
                account: string;
            };
        } | {
            /** @constant */
            code: "automation.unknown-folder";
            params: {
                path: string;
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
        } | {
            /** @constant */
            code: "launch.sandbox-overridden";
            params: {
                path: string;
                key: string;
            };
        } | {
            /** @constant */
            code: "launch.not-logged-in";
            params: {
                account: string;
                reason: string;
            };
        } | {
            /** @constant */
            code: "doctor.plugin-none";
            params: {
                plugin: string;
                commit: string;
            };
        } | {
            /** @constant */
            code: "doctor.plugin-not-loaded";
            params: {
                plugin: string;
                errors: string;
            };
        } | {
            /** @constant */
            code: "launch.managed-settings-unreadable";
            params: {
                path: string;
                error: string;
            };
        } | {
            /** @constant */
            code: "git.failed";
            params: {
                /** @enum {string} */
                step: "start" | "fetch" | "list" | "read" | "worktree" | "commit" | "update";
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
            code: "extension.digest-mismatch";
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
                binding: "hub";
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
                kind: "schedule" | "precheck" | "command" | "agent" | "write" | "workflow" | "extension";
                text: string;
            }[];
            extensions: {
                id: string;
                version: string;
                git: string;
                commit: string;
                path?: string;
                digest: components["schemas"]["Sha256"];
                /** @enum {string} */
                status: "verified" | "mismatch" | "unreachable";
                installed: boolean;
                capabilities: {
                    net?: string[];
                    credentials?: {
                        [key: string]: {
                            description?: string;
                            scheme: {
                                /** @constant */
                                type: "http";
                                /** @enum {string} */
                                scheme: "bearer" | "basic";
                            } | {
                                /** @constant */
                                type: "apiKey";
                                /** @constant */
                                in: "header";
                                name: string;
                            };
                            hosts: string[];
                        };
                    };
                    projectRead?: boolean;
                    planWrite?: boolean;
                    programs?: {
                        [key: string]: {
                            darwin?: string[];
                            linux?: string[];
                            win32?: string[];
                        };
                    };
                } | null;
            }[];
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
