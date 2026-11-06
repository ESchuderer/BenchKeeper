// A plugin on its real stdio, as the host starts one: nothing but the protocol may reach standard output.
import { definePlugin } from "@cedarloom/plugin-sdk";

definePlugin({
  greet: ({ inputs }) => {
    console.log("a stray line for standard output");
    console.dir({ stray: "object" });
    process.stdout.write("a stray write\n");
    return { greeting: `Hello, ${String(inputs["name"])}` };
  },
});
