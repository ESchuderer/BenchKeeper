// The answers of a stand-in claude-swap extension: like the real one, its switch only names claude-swap's command until
// the user allows cswap.
export default {
  initialize: () => ({ protocol: "1.0", actions: ["switch"] }),
  "action/run": ({ config, inputs }) => ({
    outputs: config.allow.includes("cswap")
      ? { switched: true, from: 3, to: Number(inputs.account) }
      : {
          runs: `cswap switch ${inputs.account}`,
          approve: `cedarloom claude-swap switch --account ${inputs.account} --allow cswap`,
        },
  }),
};
