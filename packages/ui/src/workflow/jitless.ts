import { config } from "zod";

// The CSP allows no eval, so zod parses without generated code; imported first, before any contracts schema is built.
config({ jitless: true });
