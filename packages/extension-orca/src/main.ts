import { defineExtension } from "@cedarloom/extension-sdk";
import { doctor, status, workers } from "./orca.ts";

defineExtension({ status }, { doctor, workers });
