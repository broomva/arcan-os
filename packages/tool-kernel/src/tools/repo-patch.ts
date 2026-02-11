/**
 * repo.patch — Apply a unified diff to a file
 * (V1 spec §37: repo.patch(path, unifiedDiff))
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { ToolContext, ToolHandler } from '@agent-os/core';
import { z } from 'zod';

export const inputSchema = z.object({
  path: z.string().describe('Relative path to the file to patch'),
  content: z.string().describe('The full new file content to write'),
  createIfMissing: z
    .boolean()
    .optional()
    .default(true)
    .describe('Create the file if it does not exist'),
});

type Input = z.infer<typeof inputSchema>;

interface Output {
  path: string;
  linesChanged: number;
  created: boolean;
}

export const repoPatch: ToolHandler<Input, Output> = {
  id: 'repo.patch',
  description:
    'Write or overwrite a file with the provided content. Creates parent directories if needed. Path is relative to workspace root.',
  // biome-ignore lint/suspicious/noExplicitAny: Zod schema type mismatch with ToolHandler
  inputSchema: inputSchema as any,
  category: 'write',

  async execute(input: Input, ctx: ToolContext): Promise<Output> {
    const fullPath = resolve(ctx.workspaceRoot, input.path);
    const existed = existsSync(fullPath);

    if (!existed && !input.createIfMissing) {
      throw new Error(`File does not exist: ${input.path}`);
    }

    // Count line changes
    let linesChanged = 0;
    if (existed) {
      const oldContent = readFileSync(fullPath, 'utf-8');
      const oldLines = oldContent.split('\n');
      const newLines = input.content.split('\n');
      linesChanged = Math.abs(newLines.length - oldLines.length);

      // Count changed lines
      const maxLen = Math.max(oldLines.length, newLines.length);
      for (let i = 0; i < maxLen; i++) {
        if (oldLines[i] !== newLines[i]) linesChanged++;
      }
    } else {
      linesChanged = input.content.split('\n').length;
    }

    // Ensure directory exists
    const dir = dirname(fullPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    // Write file
    writeFileSync(fullPath, input.content, 'utf-8');

    return {
      path: input.path,
      linesChanged,
      created: !existed,
    };
  },
};
