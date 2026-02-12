import { Box, Text, useInput } from 'ink';
import React, { useState } from 'react';
import { Chat } from '../Chat.js';
import { MemoryPane } from './MemoryPane.js';
import { TracePane } from './TracePane.js';

type DashboardProps = {
  sessionId: string;
};

export function Dashboard({ sessionId }: DashboardProps) {
  const [activeTab, setActiveTab] = useState<'memory' | 'trace'>('memory');

  useInput((input, key) => {
    if (input === 'm') setActiveTab('memory');
    if (input === 't') setActiveTab('trace');
  });

  return (
    <Box flexDirection="row" height="100%">
      {/* Left Pane: Chat (60%) */}
      <Box
        width="60%"
        borderStyle="single"
        borderColor="green"
        flexDirection="column"
      >
        <Text bold color="green">
          {' '}
          Chat (Session: {sessionId.slice(0, 8)}...)
        </Text>
        <Chat sessionId={sessionId} />
      </Box>

      {/* Right Pane: Inspector (40%) */}
      <Box
        width="40%"
        borderStyle="single"
        borderColor="blue"
        flexDirection="column"
      >
        <Box
          borderStyle="single"
          borderBottom={false}
          borderLeft={false}
          borderRight={false}
        >
          <Text>
            <Text
              color={activeTab === 'memory' ? 'blue' : 'gray'}
              bold={activeTab === 'memory'}
            >
              [M]emory
            </Text>
            {' | '}
            <Text
              color={activeTab === 'trace' ? 'blue' : 'gray'}
              bold={activeTab === 'trace'}
            >
              [T]race
            </Text>
          </Text>
        </Box>

        {activeTab === 'memory' ? (
          <MemoryPane sessionId={sessionId} />
        ) : (
          <TracePane sessionId={sessionId} />
        )}
      </Box>
    </Box>
  );
}
