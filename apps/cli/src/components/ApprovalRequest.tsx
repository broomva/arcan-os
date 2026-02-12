import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';
import React from 'react';

type ApprovalRequestProps = {
  toolId: string;
  args: Record<string, unknown>;
  risk: string;
  onApprove: () => void;
  onDeny: () => void;
};

export function ApprovalRequest({
  toolId,
  args,
  risk,
  onApprove,
  onDeny,
}: ApprovalRequestProps) {
  const [input, setInput] = React.useState('');

  const handleSubmit = (value: string) => {
    if (value.toLowerCase() === 'y') {
      onApprove();
    } else {
      onDeny();
    }
  };

  return (
    <Box
      flexDirection="column"
      borderStyle="double"
      borderColor="red"
      padding={1}
    >
      <Text color="red" bold>
        ⚠ Approval Requested
      </Text>
      <Text>
        Tool: <Text bold>{toolId}</Text>
      </Text>
      <Text>
        Risk: <Text color="yellow">{risk}</Text>
      </Text>
      <Box marginY={1}>
        <Text dimColor>{JSON.stringify(args, null, 2)}</Text>
      </Box>
      <Box>
        <Text>Allow execution? [y/N]: </Text>
        <TextInput
          value={input}
          onChange={setInput}
          onSubmit={handleSubmit}
          focus={true}
        />
      </Box>
    </Box>
  );
}
