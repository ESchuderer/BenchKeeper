import { config } from "zod";

// The page's CSP allows no eval, so zod parses without the code it would generate; its probe for eval would otherwise
// report a CSP violation. Imported first by the editor, before any schema of the contracts is built.
config({ jitless: true });
