export type AgentApiStatus = {
  enabled: boolean;
  origin: string | null;
  credentials: Array<{ id: string; label: string; revoked: boolean; profileIds: string[]; proxyIds: string[] }>;
};
export type AgentCredentialGrantInput = { credentialId: string; kind: 'profile' | 'proxy'; resourceId: string };
