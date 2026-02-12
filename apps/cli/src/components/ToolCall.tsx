import type { ToolCallPayload, ToolResultPayload } from '@agent-os/core';
import { Box, Text } from 'ink';
import { useState } from 'react';

type ToolCallProps = {
  toolId: string;
  args: ToolCallPayload['args'];
  result?: ToolResultPayload['result'];
  durationMs?: number;
};

export function ToolCall({ toolId, args, result, durationMs }: ToolCallProps) {
  const [_isExpanded, _setIsExpanded] = useState(false); // TODO: interactive expand?

  const status = result ? (
    <Text color="green">✔</Text>
  ) : (
    <Text color="yellow">⚡</Text>
  );

  return (
    <Box
      flexDirection="column"
      marginLeft={2}
      borderStyle="round"
      borderColor="gray"
    >
      <Box>
        <Text bold>
          {status} {toolId}{' '}
        </Text>
        <Text color="gray">
          {durationMs ? `(${durationMs}ms)` : '(running...)'}
        </Text>
      </Box>
      <Box marginLeft={2}>
        <Text color="gray" dimColor>
          {JSON.stringify(args).slice(0, 100)}
          {JSON.stringify(args).length > 100 ? '...' : ''}
        </Text>
      </Box>
      {result !== undefined && (
        <Box marginLeft={2} marginTop={0}>
          <Text color="gray">
            ↳ Result: {JSON.stringify(result).slice(0, 100)}
            {JSON.stringify(result).length > 100 ? '...' : ''}
          </Text>
        </Box>
      )}
    </Box>
  );
}
