import { defineExtension } from "@cedarloom/extension-sdk";
import { doctor, status, targets } from "./swap.ts";

defineExtension({ status }, { doctor, targets });
