import { Box, Text } from 'ink';

type MemoryPaneProps = {
  sessionId: string;
};

export function MemoryPane({ sessionId: _sessionId }: MemoryPaneProps) {
  // TODO: Fetch actual memory from daemon
  // const [memory, setMemory] = useState<any>(null);

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold underline>
        Working Memory
      </Text>
      <Box marginY={1}>
        <Text color="gray">No observations yet.</Text>
      </Box>
      <Box borderStyle="single" borderColor="gray">
        <Text dimColor>
          (This pane will show the agent's short-term memory and recent
          observations)
        </Text>
      </Box>
    </Box>
  );
}
