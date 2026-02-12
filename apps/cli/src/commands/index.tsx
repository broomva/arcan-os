import { Box, Text } from 'ink';
import React from 'react';
import zod from 'zod';

export const options = zod.object({
  name: zod.string().optional().describe('Name to greet'),
});

type Props = {
  options: zod.infer<typeof options>;
};

export default function Index({ options }: Props) {
  return (
    <Box flexDirection="column" padding={1}>
      <Text color="green">Agent OS CLI</Text>
      <Text>Use `agent chat [sessionId]` to start.</Text>
    </Box>
  );
}
