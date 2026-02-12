import React from 'react';
import zod from 'zod';
import { Chat } from '../components/Chat.js';

export const options = zod.object({
  id: zod.string().optional().describe('Session ID to resume'),
});

type Props = {
  options: zod.infer<typeof options>;
};

export default function ChatCommand({ options }: Props) {
  // Generate random session ID if not provided
  const sessionId = options.id || crypto.randomUUID();

  return <Chat sessionId={sessionId} />;
}
