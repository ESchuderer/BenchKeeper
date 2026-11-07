import { DatabaseSync } from "node:sqlite";
import { vi } from "vitest";

/** Every COMMIT fails the way SQLite fails it on a full disk: the transaction is already rolled back. */
export const failCommits = (failure: Error): void => {
  vi.spyOn(DatabaseSync.prototype, "exec").mockImplementation(function (this: DatabaseSync, sql) {
    this.prepare(sql === "COMMIT" ? "ROLLBACK" : sql).run();
    if (sql === "COMMIT") throw failure;
  });
};
