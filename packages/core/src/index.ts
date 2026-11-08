// Browser-safe entry: the page loads this through its import map. The Node-only server
// lives in `src/node/` and is exported separately as `@pixel-office/core/server`.
export const VERSION = "0.0.0";

export * from "./state.js";
export * from "./demo.js";
