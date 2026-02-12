import type {
  AgentEvent,
  ApprovalRequestedPayload,
  OutputDeltaPayload,
  ToolCallPayload,
  ToolResultPayload,
} from '@arcan-os/core';
import { Box, Text, useApp } from 'ink';
import Markdown from 'ink-markdown';
import Spinner from 'ink-spinner';
import { useCallback, useEffect, useState } from 'react';
import { useClient } from '../context/client-context.js';
import type { UIMessage } from '../types.js';
import { ApprovalRequest } from './ApprovalRequest.js';
import { SmartInput } from './Input/SmartInput.js';
import { ToolCall } from './ToolCall.js';

type ChatProps = {
  sessionId: string;
};

export function Chat({ sessionId }: ChatProps) {
  const client = useClient();
  const { exit } = useApp();
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [isThinking, setIsThinking] = useState(false);
  const [status, setStatus] = useState('Ready');
  const [currentRunId, setCurrentRunId] = useState<string | null>(null);
  const [approval, setApproval] = useState<ApprovalRequestedPayload | null>(
    null,
  );

  // Load history on mount
  useEffect(() => {
    client
      .getSessionState(sessionId)
      .then((state) => {
        const restored: UIMessage[] = [];
        for (const event of state.pendingEvents) {
          if (event.type === 'output.delta') {
            const payload = event.payload as OutputDeltaPayload;
            const last = restored[restored.length - 1];
            if (
              last?.role === 'assistant' &&
              !last.isTool &&
              !last.isApproval
            ) {
              last.content = (last.content || '') + payload.text;
            } else {
              restored.push({
                id: event.eventId,
                role: 'assistant',
                content: payload.text,
              });
            }
          } else if (event.type === 'tool.call') {
            const payload = event.payload as ToolCallPayload;
            restored.push({
              id: event.eventId,
              role: 'assistant',
              isTool: true,
              toolCall: payload,
            });
          } else if (event.type === 'tool.result') {
            const payload = event.payload as ToolResultPayload;
            const toolMsg = restored.find(
              (m) => m.isTool && m.toolCall?.callId === payload.callId,
            );
            if (toolMsg) {
              toolMsg.toolResult = payload;
            }
          }
        }
        if (restored.length > 0) {
          setMessages(restored);
        }
      })
      .catch(() => {
        // Session may not exist yet — that's fine for new sessions
      });
  }, [client, sessionId]);

  // Handle Input Submit
  const handleSubmit = async (value: string, contextFiles: string[]) => {
    if (!value.trim()) return;

    // Handle commands
    if (value.startsWith('/')) {
      const cmd = value.trim();
      if (cmd === '/clear') {
        setMessages([]);
        return;
      }
      if (cmd === '/quit') {
        exit();
        return;
      }
      // DEFERRED: Dashboard switch requires a routing architecture (parent callback or navigation layer)
    }

    setIsThinking(true);
    setStatus('Starting run...');

    // Optimistic user message matches what we send
    const displayContent =
      contextFiles.length > 0
        ? `${value}\n\n[Context: ${contextFiles.map((f) => `@${f}`).join(', ')}]`
        : value;

    const userMsg: UIMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: displayContent,
    };
    setMessages((prev) => [...prev, userMsg]);

    try {
      // DEFERRED: Send context files natively once arcand RunConfig supports a `context` field
      let prompt = value;
      if (contextFiles.length > 0) {
        prompt += `\n\nContext Files:\n${JSON.stringify(contextFiles)}`;
      }

      const { runId } = await client.createRun({
        sessionId,
        prompt: prompt,
      });
      setCurrentRunId(runId);
    } catch (e) {
      setStatus(`Error: ${e}`);
      setIsThinking(false);
    }
  };

  const handleApprove = async () => {
    if (!approval || !currentRunId) return;
    setStatus('Approving...');
    try {
      await client.resolveApproval(approval.approvalId, 'approve');
    } catch (e) {
      setStatus(`Approval error: ${e}`);
    }
    setApproval(null);
  };

  const handleDeny = async () => {
    if (!approval || !currentRunId) return;
    setStatus('Denying...');
    try {
      await client.resolveApproval(approval.approvalId, 'deny');
    } catch (e) {
      setStatus(`Denial error: ${e}`);
    }
    setApproval(null);
  };

  const processEvent = useCallback((event: AgentEvent) => {
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
  }, []);

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
  }, [client, currentRunId, processEvent]);

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
        <SmartInput
          onSubmit={handleSubmit}
          placeholder="Ask agent... (/ for commands, @ for context)"
        />
      )}
    </Box>
  );
}
