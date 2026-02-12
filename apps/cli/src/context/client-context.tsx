import { createContext, useContext } from 'react';
import { AgentClient } from '../client/agent-client.js';

const ClientContext = createContext<AgentClient | null>(null);

export function ClientProvider({
  baseUrl,
  children,
}: {
  baseUrl?: string;
  children: React.ReactNode;
}) {
  const client = new AgentClient(baseUrl);
  return <ClientContext value={client}>{children}</ClientContext>;
}

export function useClient(): AgentClient {
  const client = useContext(ClientContext);
  if (!client) {
    throw new Error('useClient must be used within a <ClientProvider>');
  }
  return client;
}
