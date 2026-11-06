// A plugin on its real stdio, as the host starts one: console.log must not reach standard output.
import { definePlugin } from "@cedarloom/plugin-sdk";

definePlugin({
  greet: ({ inputs }) => {
    console.log("a stray line for standard output");
    return { greeting: `Hello, ${String(inputs["name"])}` };
  },
});
