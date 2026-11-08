import { defineExtension } from "@cedarloom/extension-sdk";
import { auto, autoOff, autoOn, doctor, install, sessions, status, targets } from "./swap.ts";

defineExtension({ status, install, auto, "auto-on": autoOn, "auto-off": autoOff }, { doctor, targets, sessions });
