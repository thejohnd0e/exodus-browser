/** Public API errors carry stable codes only; internal messages never cross HTTP. */
export class AgentApiError extends Error {
  constructor(readonly status: number, readonly code: string) { super(code); }
}
