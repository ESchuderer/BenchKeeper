import { defineExtension } from "@cedarloom/extension-sdk";
import { auto, autoOff, autoOn, doctor, install, list, settings, status, switchTo } from "./swap.ts";

defineExtension(
  { status, install, list, switch: switchTo, settings, auto, "auto-on": autoOn, "auto-off": autoOff },
  { doctor },
);
