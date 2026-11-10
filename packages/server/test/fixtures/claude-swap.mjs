// The answers of a stand-in claude-swap extension: like the real one, a change only names its command until the user
// allows its program, cswap for a switch or the menu bar service, the installer and the approved command for the install.
const INSTALL = "uv tool install --no-config --default-index https://pypi.org/simple 'claude-swap[menubar]==1.0.0'";
const ANSWERS = {
  switch: (allowed, { account }) =>
    allowed("cswap")
      ? { switched: true, from: 3, to: Number(account) }
      : { runs: `cswap switch ${account}`, approve: `cedarloom claude-swap switch --account ${account} --allow cswap` },
  "auto-on": (allowed) =>
    allowed("cswap")
      ? { service: "Menu bar service installed (com.cswap.menubar).", autoSwitch: true }
      : {
          runs: "cswap menubar --install-service --auto-switch",
          approve: "cedarloom claude-swap auto-on --allow cswap",
        },
  "auto-off": (allowed) =>
    allowed("cswap")
      ? { service: "Menu bar restarted (pid 4243) to apply the auto-switch setting.", autoSwitch: false }
      : { runs: "cswap menubar --no-auto-switch", approve: "cedarloom claude-swap auto-off --allow cswap" },
  install: (allowed, { approved }) =>
    allowed("uv") && approved === INSTALL
      ? { installed: true, version: "1.0.0" }
      : {
          installed: false,
          runs: INSTALL,
          approve: "cedarloom claude-swap install --allow uv",
          installer: "uv",
          source: "https://pypi.org/project/claude-swap/1.0.0/",
          release: "1.0.0",
        },
};
export default {
  initialize: () => ({ protocol: "1.0", actions: Object.keys(ANSWERS) }),
  "action/run": ({ action, config, inputs }) => ({
    outputs: ANSWERS[action]((program) => config.allow.includes(program), inputs),
  }),
};
