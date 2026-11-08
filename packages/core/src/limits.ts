/**
 * Length limits of the event fields the server accepts (DESIGN.md section 6). Browser-safe:
 * the server checks them and the collectors (such as the Claude Code mapping) trim to them.
 */
export const LIMITS = { sessionId: 200, cwd: 1024, detail: 40 } as const;
