import { defineExtension } from "@cedarloom/extension-sdk";
import { doctor, status } from "./orca.ts";

defineExtension({ status }, { doctor });
