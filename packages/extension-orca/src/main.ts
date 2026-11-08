import { defineExtension } from "@cedarloom/extension-sdk";
import { doctor, follow, status, workers } from "./orca.ts";

defineExtension({ status, follow }, { doctor, workers });
