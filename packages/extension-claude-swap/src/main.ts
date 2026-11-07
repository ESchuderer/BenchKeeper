import { defineExtension } from "@cedarloom/extension-sdk";
import { doctor, install, status, targets } from "./swap.ts";

defineExtension({ status, install }, { doctor, targets });
