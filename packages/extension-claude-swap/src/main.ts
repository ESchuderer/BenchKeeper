import { defineExtension } from "@cedarloom/extension-sdk";
import { doctor, install, sessions, status, targets } from "./swap.ts";

defineExtension({ status, install }, { doctor, targets, sessions });
