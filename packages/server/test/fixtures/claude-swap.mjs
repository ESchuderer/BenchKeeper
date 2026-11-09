// The answers of a stand-in claude-swap extension: like the real one, a change only names its command until the user
// allows its program, cswap for a switch or the menu bar service, the installer and the approved command for the install.
const INSTALL = "uv tool install --default-index https://pypi.org/simple 'claude-swap[menubar]==0.30.0'";
const ANSWERS = {
  switch: (allowed, { account }) =>
    allowed("cswap")
      ? { switched: true, from: 3, to: Number(account) }
      : { runs: `cswap switch ${account}`, approve: `cedarloom claude-swap switch --account ${account} --allow cswap` },
  "auto-on": (allowed) =>
    allowed("cswap")
      ? { service: "Menu bar service installed (com.cswap.menubar).", hint: "turn on Auto-switch accounts" }
      : { runs: "cswap menubar --install-service", approve: "cedarloom claude-swap auto-on --allow cswap" },
  install: (allowed, { approved }) =>
    allowed("uv") && approved === INSTALL
      ? { installed: true, version: "0.30.0" }
      : {
          installed: false,
          runs: INSTALL,
          approve: "cedarloom claude-swap install --allow uv",
          installer: "uv",
          source: "https://pypi.org/project/claude-swap/0.30.0/",
          release: "0.30.0",
        },
};
export default {
  initialize: () => ({ protocol: "1.0", actions: Object.keys(ANSWERS) }),
  "action/run": ({ action, config, inputs }) => ({
    outputs: ANSWERS[action]((program) => config.allow.includes(program), inputs),
  }),
};
