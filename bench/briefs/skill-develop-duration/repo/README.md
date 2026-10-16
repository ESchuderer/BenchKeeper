# jobrunner

Runs the jobs of a job file with timeouts and retries.

```sh
jobrunner jobs.json --timeout 90s --only backup
```

Job file:

```json
{ "jobs": [{ "name": "backup", "command": "sh backup.sh", "timeout": "5m", "retryDelay": "30s" }] }
```

A duration is a whole number and a unit: `ms`, `s`, `m` or `h`. Defaults: `timeout` 30s, `retryDelay` 1s.

Tests: `npm test` (Node.js 22, no dependencies).
