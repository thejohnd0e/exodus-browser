/** OpenAPI 3.1 description of the implemented `/api/v1` surface. Kept next to the handler so the
 * contract is testable; browser-tab tools are intentionally absent. */
export const OPENAPI = {
  openapi: '3.1.0',
  info: { title: 'Exodus Agent API', version: '1.0.0', description: 'Local management API for authorized integrations. Loopback only, bearer authentication.' },
  servers: [{ url: 'http://127.0.0.1:{port}', variables: { port: { default: '0' } } }],
  security: [{ bearerAuth: [] }],
  components: {
    securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } },
    parameters: {
      IdempotencyKey: { name: 'Idempotency-Key', in: 'header', required: false, schema: { type: 'string', pattern: '^[A-Za-z0-9_-]{8,128}$' }, description: 'Replays the original result for POST requests with the same key and body.' },
      ProfileId: { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
      TargetId: { name: 'targetId', in: 'path', required: true, schema: { type: 'string' } },
    },
    schemas: {
      Error: { type: 'object', required: ['ok', 'error'], properties: { ok: { const: false }, error: { type: 'object', required: ['code'], properties: { code: { type: 'string' } } } } },
      Profile: { type: 'object', required: ['id', 'name', 'startUrls', 'languages', 'fingerprint'], properties: {
        id: { type: 'string', format: 'uuid' }, name: { type: 'string' }, note: { type: 'string' }, startUrls: { type: 'array', items: { type: 'string' } },
        languages: { type: 'array', items: { type: 'string' } }, proxyId: { type: ['string', 'null'] }, proxy: { type: ['object', 'null'] },
        fingerprint: { type: 'object' }, fingerprintSeed: { type: 'integer' }, createdAt: { type: 'string' }, updatedAt: { type: 'string' },
      } },
      ProfileCreate: { type: 'object', required: ['name'], properties: {
        name: { type: 'string', maxLength: 200 }, note: { type: 'string', maxLength: 2000 }, startUrls: { type: 'array', maxItems: 20, items: { type: 'string' } },
        languages: { type: 'array', minItems: 1, maxItems: 1, items: { type: 'string' } }, proxyId: { type: ['string', 'null'], format: 'uuid' },
        fingerprint: { type: 'object', description: 'Optional fingerprint from POST /fingerprints.' }, fingerprintSeed: { type: 'integer', minimum: 0, maximum: 4294967295 },
      } },
      Status: { type: 'object', properties: { apiVersion: { const: '1' }, capabilities: { type: 'array', items: { type: 'string' } } } },
    },
  },
  paths: {
    '/api/v1/status': { get: { operationId: 'status', summary: 'API version and implemented capabilities', responses: { '200': { description: 'Status' } } } },
    '/api/v1/profiles': {
      get: { operationId: 'listProfiles', summary: 'List granted profiles', responses: { '200': { description: 'Profiles' } } },
      post: { operationId: 'createProfile', summary: 'Create a profile and grant it to the caller', parameters: [{ $ref: '#/components/parameters/IdempotencyKey' }], requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/ProfileCreate' } } } }, responses: { '200': { description: 'Created profile' }, '400': { description: 'Invalid input' }, '409': { description: 'Engine unavailable or idempotency conflict' } } },
    },
    '/api/v1/profiles/{id}': { get: { operationId: 'getProfile', summary: 'Read one granted profile', parameters: [{ $ref: '#/components/parameters/ProfileId' }], responses: { '200': { description: 'Profile' }, '404': { description: 'Not found or not granted' } } } },
    '/api/v1/profiles/{id}/start': { post: { operationId: 'startProfile', summary: 'Launch a granted profile', parameters: [{ $ref: '#/components/parameters/ProfileId' }, { $ref: '#/components/parameters/IdempotencyKey' }], requestBody: { required: false, content: { 'application/json': { schema: { type: 'object' } } } }, responses: { '200': { description: 'State' }, '404': { description: 'Not found or not granted' } } } },
    '/api/v1/profiles/{id}/stop': { post: { operationId: 'stopProfile', summary: 'Stop a granted profile', parameters: [{ $ref: '#/components/parameters/ProfileId' }, { $ref: '#/components/parameters/IdempotencyKey' }], requestBody: { required: false, content: { 'application/json': { schema: { type: 'object' } } } }, responses: { '200': { description: 'State' }, '404': { description: 'Not found or not granted' } } } },
    '/api/v1/proxies': { get: { operationId: 'listProxies', summary: 'List granted proxies without passwords', responses: { '200': { description: 'Proxies' } } } },
    '/api/v1/fingerprints': { post: { operationId: 'generateFingerprint', summary: 'Generate a fingerprint for the installed engine', requestBody: { required: false, content: { 'application/json': { schema: { type: 'object', properties: { os: { enum: ['windows11', 'windows10', 'macos', 'linux'] } } } } } }, responses: { '200': { description: 'Fingerprint' }, '409': { description: 'Engine unavailable' } } } },
    '/api/v1/openapi.json': { get: { operationId: 'openapi', summary: 'This document', responses: { '200': { description: 'OpenAPI document' } } } },
    '/api/v1/profiles/{id}/tabs': { get: { operationId: 'listTabs', summary: 'List tabs of a granted running profile', parameters: [{ $ref: '#/components/parameters/ProfileId' }], responses: { '200': { description: 'Tabs' }, '409': { description: 'Profile is not running' } } } },
    '/api/v1/profiles/{id}/tabs/{targetId}/navigate': { post: { operationId: 'navigateTab', summary: 'Navigate one tab', parameters: [{ $ref: '#/components/parameters/ProfileId' }, { $ref: '#/components/parameters/TargetId' }], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['url'], properties: { url: { type: 'string' } } } } } }, responses: { '200': { description: 'Navigated' }, '400': { description: 'Invalid URL' }, '404': { description: 'Tab not found' }, '409': { description: 'Profile is not running' } } } },
    '/api/v1/profiles/{id}/tabs/{targetId}/snapshot': { post: { operationId: 'snapshotTab', summary: 'Structured page snapshot with refs', parameters: [{ $ref: '#/components/parameters/ProfileId' }, { $ref: '#/components/parameters/TargetId' }], requestBody: { required: false, content: { 'application/json': { schema: { type: 'object' } } } }, responses: { '200': { description: 'Snapshot' }, '404': { description: 'Tab not found' }, '409': { description: 'Profile is not running' } } } },
    '/api/v1/profiles/{id}/tabs/{targetId}/click': { post: { operationId: 'clickTab', summary: 'Click a snapshot ref', parameters: [{ $ref: '#/components/parameters/ProfileId' }, { $ref: '#/components/parameters/TargetId' }], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['ref'], properties: { ref: { type: 'string' } } } } } }, responses: { '200': { description: 'Clicked' }, '409': { description: 'Profile is not running, or element not found/not visible' } } } },
    '/api/v1/profiles/{id}/tabs/{targetId}/fill': { post: { operationId: 'fillTab', summary: 'Fill a snapshot ref', parameters: [{ $ref: '#/components/parameters/ProfileId' }, { $ref: '#/components/parameters/TargetId' }], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['ref', 'text'], properties: { ref: { type: 'string' }, text: { type: 'string', maxLength: 10000 } } } } } }, responses: { '200': { description: 'Filled' }, '409': { description: 'Profile is not running, or element not found' } } } },
    '/api/v1/profiles/{id}/tabs/{targetId}/screenshot': { post: { operationId: 'screenshotTab', summary: 'PNG screenshot as base64', parameters: [{ $ref: '#/components/parameters/ProfileId' }, { $ref: '#/components/parameters/TargetId' }], requestBody: { required: false, content: { 'application/json': { schema: { type: 'object' } } } }, responses: { '200': { description: 'Screenshot' }, '409': { description: 'Profile is not running, or screenshot too large' } } } },
    '/api/v1/profiles/{id}/tabs/{targetId}/close': { post: { operationId: 'closeTab', summary: 'Close one tab', parameters: [{ $ref: '#/components/parameters/ProfileId' }, { $ref: '#/components/parameters/TargetId' }], requestBody: { required: false, content: { 'application/json': { schema: { type: 'object' } } } }, responses: { '200': { description: 'Closed' }, '404': { description: 'Tab not found' }, '409': { description: 'Profile is not running' } } } },
  },
} as const;
