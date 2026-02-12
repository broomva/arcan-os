import { Box, Text } from 'ink';
import { useEffect, useState } from 'react';
import { AgentClient } from '../client/agent-client.js';

const client = new AgentClient();

export default function ListCommand() {
  const [sessions, setSessions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    client
      .listSessions()
      .then(setSessions)
      .catch(() => setSessions([]))
      .finally(() => setLoading(false));
  }, []);

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
