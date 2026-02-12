import { Box, Text } from 'ink';
import React from 'react';

type TracePaneProps = {
  sessionId: string;
};

export function TracePane({ sessionId }: TracePaneProps) {
  return (
    <Box flexDirection="column" padding={1}>
      <Text bold underline>
        Execution Trace
      </Text>
      <Box marginY={1}>
        <Text color="gray">Waiting for run...</Text>
      </Box>
      <Box borderStyle="single" borderColor="gray">
        <Text dimColor>
          (This pane will show the active tool call stack and step-by-step
          reasoning)
        </Text>
      </Box>
    </Box>
  );
}
