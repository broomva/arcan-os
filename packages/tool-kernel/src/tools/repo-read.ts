/**
 * repo.read — Read file contents within workspace jail
 * (V1 spec §37: repo.read(path, range?))
 */

import { readFileSync } from 'node:fs';
import type { ToolContext, ToolHandler } from '@agent-os/core';
import { z } from 'zod';

export const inputSchema = z.object({
  path: z.string().describe('Relative path to the file within the workspace'),
  startLine: z
    .number()
    .optional()
    .describe('Start line (1-indexed, inclusive)'),
  endLine: z.number().optional().describe('End line (1-indexed, inclusive)'),
});

type Input = z.infer<typeof inputSchema>;

interface Output {
  path: string;
  content: string;
  totalLines: number;
  range?: { start: number; end: number };
}

export const repoRead: ToolHandler<Input, Output> = {
  id: 'repo.read',
  description:
    'Read the contents of a file. Supports optional line range. Path is relative to workspace root.',
  inputSchema,
  category: 'read',

  async execute(input: Input, ctx: ToolContext): Promise<Output> {
    const { resolve, join } = await import('node:path');
    const fullPath = resolve(ctx.workspaceRoot, input.path);

    const content = readFileSync(fullPath, 'utf-8');
    const lines = content.split('\n');

    if (input.startLine !== undefined || input.endLine !== undefined) {
      const start = Math.max(1, input.startLine ?? 1);
      const end = Math.min(lines.length, input.endLine ?? lines.length);
      const sliced = lines.slice(start - 1, end).join('\n');

      return {
        path: input.path,
        content: sliced,
        totalLines: lines.length,
        range: { start, end },
      };
    }

    return {
      path: input.path,
      content,
      totalLines: lines.length,
    };
  },
};
