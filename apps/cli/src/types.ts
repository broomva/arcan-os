import type {
  ApprovalRequestedPayload,
  ToolCallPayload,
  ToolResultPayload,
} from '@arcan-os/core';

export interface UIMessage {
  id: string;
  role: 'user' | 'assistant';
  content?: string;
  isTool?: boolean;
  toolCall?: ToolCallPayload;
  toolResult?: ToolResultPayload;
  isApproval?: boolean;
  approval?: ApprovalRequestedPayload;
}
