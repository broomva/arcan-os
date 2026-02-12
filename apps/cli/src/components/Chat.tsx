import type {
  AgentEvent,
  ApprovalRequestedPayload,
  OutputDeltaPayload,
  ToolCallPayload,
  ToolResultPayload,
} from '@agent-os/core';
import { Box, Text, useApp } from 'ink';
import Markdown from 'ink-markdown';
import Spinner from 'ink-spinner';
import TextInput from 'ink-text-input';
import React, { useState, useEffect } from 'react';
import { AgentClient } from '../client/agent-client.js';
import type { UIMessage } from '../types.js';
import { ApprovalRequest } from './ApprovalRequest.js';
import { ToolCall } from './ToolCall.js';

// Initialize client (TODO: Move to context or prop)
const client = new AgentClient();

type ChatProps = {
  sessionId: string;
};

export function Chat({ sessionId }: ChatProps) {
  const { exit } = useApp();
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [isThinking, setIsThinking] = useState(false);
  const [status, setStatus] = useState('Ready');
  const [currentRunId, setCurrentRunId] = useState<string | null>(null);
  const [approval, setApproval] = useState<ApprovalRequestedPayload | null>(
    null,
  );

  // Load history on mount
  useEffect(() => {
    // TODO: client.getHistory(sessionId).then(setMessages);
  }, []);

  // Handle Input Submit
  const handleSubmit = async (value: string) => {
    if (!value.trim()) return;

    setInput('');
    setIsThinking(true);
    setStatus('Starting run...');

    // Optimistic user message
    const userMsg: UIMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: value,
    };
    setMessages((prev) => [...prev, userMsg]);

    try {
      const { runId } = await client.createRun({
        sessionId,
        prompt: value,
      });
      setCurrentRunId(runId);
    } catch (e) {
      setStatus(`Error: ${e}`);
      setIsThinking(false);
    }
  };

  const handleApprove = async () => {
    if (!approval || !currentRunId) return;
    // TODO: Client needs approveTool(runId, approvalId) method
    // For now we just log it or fail
    setStatus('Approving...');
    setApproval(null);
  };

  const handleDeny = async () => {
    if (!approval || !currentRunId) return;
    // TODO: Client needs denyTool(runId, approvalId) method
    setStatus('Denying...');
    setApproval(null);
  };

  // Subscribe to Run Stream
  useEffect(() => {
    if (!currentRunId) return;

    let isActive = true;
    const fetchData = async () => {
      try {
        for await (const event of client.connectToRun(currentRunId)) {
          if (!isActive) break;
          processEvent(event);
        }
      } catch (e) {
        setStatus(`Stream Error: ${e}`);
      } finally {
        setIsThinking(false);
        setStatus('Ready');
        setCurrentRunId(null);
        setApproval(null);
      }
    };

    fetchData();

    return () => {
      isActive = false;
    };
  }, [currentRunId]);

  const processEvent = (event: AgentEvent) => {
    switch (event.type) {
      case 'run.started':
        setStatus('Thinking...');
        break;
      case 'output.delta': {
        const payload = event.payload as OutputDeltaPayload;
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last?.role === 'assistant' && !last.isTool && !last.isApproval) {
            return [
              ...prev.slice(0, -1),
              { ...last, content: (last.content || '') + payload.text },
            ];
          }
          return [
            ...prev,
            {
              id: event.eventId,
              role: 'assistant',
              content: payload.text,
            },
          ];
        });
        break;
      }
      case 'tool.call': {
        const payload = event.payload as ToolCallPayload;
        setMessages((prev) => [
          ...prev,
          {
            id: event.eventId,
            role: 'assistant',
            isTool: true,
            toolCall: payload,
          },
        ]);
        setStatus(`Running tool: ${payload.toolId}`);
        break;
      }
      case 'tool.result': {
        const payload = event.payload as ToolResultPayload;
        setMessages((prev) =>
          prev.map((msg) => {
            if (msg.isTool && msg.toolCall?.callId === payload.callId) {
              return { ...msg, toolResult: payload };
            }
            return msg;
          }),
        );
        break;
      }
      case 'approval.requested': {
        const payload = event.payload as ApprovalRequestedPayload;
        setApproval(payload);
        setStatus('Waiting for approval...');
        break;
      }
      case 'run.completed':
        setStatus('Done');
        break;
      case 'run.failed':
        setStatus('Failed');
        break;
    }
  };

  return (
    <Box flexDirection="column" padding={1}>
      <Box flexDirection="column" marginBottom={1}>
        {messages.map((msg) => (
          <Box key={msg.id} flexDirection="column" marginBottom={1}>
            <Text color={msg.role === 'user' ? 'green' : 'blue'} bold>
              {msg.role === 'user' ? 'User' : 'Agent'}:
            </Text>
            {msg.isTool && msg.toolCall ? (
              <ToolCall
                toolId={msg.toolCall.toolId}
                args={msg.toolCall.args}
                result={msg.toolResult?.result}
                durationMs={msg.toolResult?.durationMs}
              />
            ) : (
              <Box marginLeft={2}>
                <Markdown>{msg.content || ''}</Markdown>
              </Box>
            )}
          </Box>
        ))}
      </Box>

      {approval && (
        <ApprovalRequest
          toolId={approval.toolId}
          args={approval.args}
          risk={JSON.stringify(approval.risk)}
          onApprove={handleApprove}
          onDeny={handleDeny}
        />
      )}

      {isThinking && !approval && (
        <Box marginBottom={1}>
          <Text color="cyan">
            <Spinner type="dots" /> {status}
          </Text>
        </Box>
      )}

      {!isThinking && !approval && (
        <Box borderStyle="round" borderColor="green" paddingX={1}>
          <Text color="green">❯ </Text>
          <TextInput
            value={input}
            onChange={setInput}
            onSubmit={handleSubmit}
            placeholder="Ask the agent..."
          />
        </Box>
      )}
    </Box>
  );
}
