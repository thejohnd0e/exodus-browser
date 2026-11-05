export type McpToolCall = { jsonrpc: '2.0'; id?: number | string; method?: string; params?: { name?: string; arguments?: Record<string, unknown> } };
export type McpResponse = { jsonrpc: '2.0'; id: number | string | null; result?: unknown; error?: { code: number; message: string } } | null;
export declare function createMcpHandler(options: {
  url: string;
  token: string;
  fetchImpl?: (input: string, init?: Record<string, unknown>) => Promise<{ ok: boolean; status: number; json(): Promise<any> }>;
}): { handle(message: McpToolCall): Promise<McpResponse> };
