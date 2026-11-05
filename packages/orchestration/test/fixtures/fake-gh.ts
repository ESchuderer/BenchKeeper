// Stands in for gh: `auth token` prints a token when it has one (FAKE_GH_TOKEN, or a GH_TOKEN it should never see),
// else exits with FAKE_GH_EXIT, 1 by default, gh's exit code for no token. FAKE_GH_KILL makes it end by a signal.
if (process.env["FAKE_GH_KILL"] !== undefined) process.kill(process.pid, "SIGTERM");
const token = process.env["FAKE_GH_TOKEN"] ?? process.env["GH_TOKEN"];
if (token === undefined) process.exitCode = Number(process.env["FAKE_GH_EXIT"] ?? "1");
else process.stdout.write(`${token}\n`);
