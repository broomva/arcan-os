import { Box, Text } from 'ink';
import { useEffect, useState } from 'react';
import { ClientProvider, useClient } from '../context/client-context.js';

function SessionList() {
  const client = useClient();
  const [sessions, setSessions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    client
      .listSessions()
      .then(setSessions)
      .catch(() => setSessions([]))
      .finally(() => setLoading(false));
  }, [client]);

  if (loading) return <Text>Loading sessions...</Text>;

  if (sessions.length === 0) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color="yellow">No active sessions found.</Text>
        <Text>
          Start one with <Text bold>agent chat</Text>
        </Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold underline>
          Active Sessions
        </Text>
      </Box>
      {sessions.map((id) => (
        <Text key={id}>• {id}</Text>
      ))}
    </Box>
  );
}

export default function ListCommand() {
  return (
    <ClientProvider>
      <SessionList />
    </ClientProvider>
  );
}
