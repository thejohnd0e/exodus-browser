#!/usr/bin/env node
// Minimal stdio MCP adapter for the Exodus local API.
import { pathToFileURL } from 'node:url';
// Credentials come from the environment so they never appear in model-visible tool arguments.
const TOOLS = [
  { name: 'status', description: 'API version, capabilities and enabled state.', method: 'GET', path: '/api/v1/status' },
  { name: 'profiles_list', description: 'List profiles this integration is allowed to use.', method: 'GET', path: '/api/v1/profiles' },
  { name: 'profiles_get', description: 'Read one authorized profile by id.', method: 'GET', path: ({ id }) => `/api/v1/profiles/${encodeURIComponent(id)}`, input: { id: { type: 'string' } }, required: ['id'] },
  { name: 'profile_create', description: 'Create a profile with a generated or supplied fingerprint.', method: 'POST', path: '/api/v1/profiles', input: { name: { type: 'string' }, startUrls: { type: 'array', items: { type: 'string' } }, proxyId: { type: ['string', 'null'] }, fingerprint: { type: 'object' } }, required: ['name'] },
  { name: 'profile_start', description: 'Launch an authorized profile.', method: 'POST', path: ({ id }) => `/api/v1/profiles/${encodeURIComponent(id)}/start`, input: { id: { type: 'string' } }, required: ['id'] },
  { name: 'profile_stop', description: 'Stop an authorized profile.', method: 'POST', path: ({ id }) => `/api/v1/profiles/${encodeURIComponent(id)}/stop`, input: { id: { type: 'string' } }, required: ['id'] },
  { name: 'proxies_list', description: 'List granted saved proxies without passwords.', method: 'GET', path: '/api/v1/proxies' },
  { name: 'fingerprint_generate', description: 'Generate a fingerprint accepted by profile creation.', method: 'POST', path: '/api/v1/fingerprints', input: { os: { type: 'string' } } },
  { name: 'tabs', description: 'List tabs of a granted running profile.', method: 'GET', path: ({ id }) => `/api/v1/profiles/${encodeURIComponent(id)}/tabs`, input: { id: { type: 'string' } }, required: ['id'] },
  { name: 'navigate', description: 'Navigate one tab to an http(s) URL.', method: 'POST', path: ({ id, targetId }) => `/api/v1/profiles/${encodeURIComponent(id)}/tabs/${encodeURIComponent(targetId)}/navigate`, input: { id: { type: 'string' }, targetId: { type: 'string' }, url: { type: 'string' } }, required: ['id', 'targetId', 'url'] },
  { name: 'snapshot', description: 'Structured page snapshot with element refs for click and fill.', method: 'POST', path: ({ id, targetId }) => `/api/v1/profiles/${encodeURIComponent(id)}/tabs/${encodeURIComponent(targetId)}/snapshot`, input: { id: { type: 'string' }, targetId: { type: 'string' } }, required: ['id', 'targetId'] },
  { name: 'click', description: 'Click an element ref from a snapshot.', method: 'POST', path: ({ id, targetId }) => `/api/v1/profiles/${encodeURIComponent(id)}/tabs/${encodeURIComponent(targetId)}/click`, input: { id: { type: 'string' }, targetId: { type: 'string' }, ref: { type: 'string' } }, required: ['id', 'targetId', 'ref'] },
  { name: 'fill', description: 'Fill an input ref from a snapshot.', method: 'POST', path: ({ id, targetId }) => `/api/v1/profiles/${encodeURIComponent(id)}/tabs/${encodeURIComponent(targetId)}/fill`, input: { id: { type: 'string' }, targetId: { type: 'string' }, ref: { type: 'string' }, text: { type: 'string' } }, required: ['id', 'targetId', 'ref', 'text'] },
  { name: 'screenshot', description: 'PNG screenshot of a tab returned as base64.', method: 'POST', path: ({ id, targetId }) => `/api/v1/profiles/${encodeURIComponent(id)}/tabs/${encodeURIComponent(targetId)}/screenshot`, input: { id: { type: 'string' }, targetId: { type: 'string' } }, required: ['id', 'targetId'] },
  { name: 'close', description: 'Close one tab of a running profile.', method: 'POST', path: ({ id, targetId }) => `/api/v1/profiles/${encodeURIComponent(id)}/tabs/${encodeURIComponent(targetId)}/close`, input: { id: { type: 'string' }, targetId: { type: 'string' } }, required: ['id', 'targetId'] },
];
const byName = new Map(TOOLS.map(tool => [tool.name, tool]));
const PATH_ARGS = new Set(['id', 'targetId']);

export function createMcpHandler({ url, token, fetchImpl = globalThis.fetch }) {
  if (!url || !token) throw Error('EXODUS_API_URL and EXODUS_API_TOKEN are required');
  async function callTool(tool, args) {
    for (const key of tool.required ?? []) if (args?.[key] === undefined) throw Error(`MISSING_ARGUMENT: ${key}`);
    const path = typeof tool.path === 'function' ? tool.path(args ?? {}) : tool.path;
    const body = tool.method === 'GET' ? undefined : JSON.stringify(Object.fromEntries(Object.entries(args ?? {}).filter(([key]) => !PATH_ARGS.has(key))));
    const response = await fetchImpl(url.replace(/\/$/, '') + path, {
      method: tool.method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body } : {}),
    });
    const payload = await response.json().catch(() => ({ ok: false, error: { code: 'INVALID_RESPONSE' } }));
    if (!response.ok || !payload.ok) throw Error(payload?.error?.code ?? 'HTTP_' + response.status);
    return payload.value;
  }
  return {
    async handle(message) {
      if (!message || typeof message !== 'object') return { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request' } };
      if (message.id === undefined) return null;
      if (message.method === 'initialize') return { jsonrpc: '2.0', id: message.id, result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'exodus-agent', version: '1.0.0' } } };
      if (message.method === 'tools/list') return { jsonrpc: '2.0', id: message.id, result: { tools: TOOLS.map(tool => ({ name: tool.name, description: tool.description, inputSchema: { type: 'object', properties: tool.input ?? {}, required: tool.required ?? [] } })) } };
      if (message.method === 'tools/call') {
        const tool = byName.get(message.params?.name);
        if (!tool) return { jsonrpc: '2.0', id: message.id, error: { code: -32602, message: 'Unknown tool' } };
        try {
          const value = await callTool(tool, message.params?.arguments ?? {});
          return { jsonrpc: '2.0', id: message.id, result: { content: [{ type: 'text', text: JSON.stringify(value) }] } };
        } catch (error) {
          return { jsonrpc: '2.0', id: message.id, result: { isError: true, content: [{ type: 'text', text: String(error?.message ?? 'TOOL_FAILED') }] } };
        }
      }
      return { jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Method not found' } };
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const mcp = createMcpHandler({ url: process.env.EXODUS_API_URL, token: process.env.EXODUS_API_TOKEN });
  let buffer = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => {
    buffer += chunk;
    let index;
    while ((index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (!line) continue;
      void (async () => {
        let response = null;
        try { response = await mcp.handle(JSON.parse(line)); }
        catch { response = { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }; }
        if (response) process.stdout.write(JSON.stringify(response) + '\n');
      })();
    }
  });
}
