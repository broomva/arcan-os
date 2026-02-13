/**
 * repo.read — Read file contents within workspace jail
 * (V1 spec §37: repo.read(path, range?))
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { ToolContext, ToolHandler } from '@arcan-os/core';
import { z } from 'zod';

export const inputSchema = z.object({
  path: z.string().describe('Relative path to the file within the workspace'),
  startLine: z
    .number()
    .optional()
    .describe('Start line (1-indexed, inclusive)'),
  endLine: z.number().optional().describe('End line (1-indexed, inclusive)'),
  includeAnchors: z
    .boolean()
    .optional()
    .default(false)
    .describe('Include per-line content anchors for robust edit workflows'),
});

type Input = z.infer<typeof inputSchema>;

interface Output {
  path: string;
  content: string;
  totalLines: number;
  range?: { start: number; end: number };
  anchors?: Array<{ line: number; hash: string }>;
}

const lineHash = (line: string): string =>
  createHash('sha1').update(line).digest('hex').slice(0, 6);

export const repoRead: ToolHandler<Input, Output> = {
  id: 'repo.read',
  description:
    'Read the contents of a file. Supports optional line range and optional line anchors for reliable edits. Path is relative to workspace root.',
  inputSchema,
  category: 'read',

  async execute(input: Input, ctx: ToolContext): Promise<Output> {
    const { resolve } = await import('node:path');
    const fullPath = resolve(ctx.workspaceRoot, input.path);

    const content = readFileSync(fullPath, 'utf-8');
    const lines = content.split('\n');

    const buildAnchors = (start: number, lineValues: string[]) =>
      lineValues.map((line, i) => ({
        line: start + i,
        hash: lineHash(line),
      }));

    if (input.startLine !== undefined || input.endLine !== undefined) {
      const start = Math.max(1, input.startLine ?? 1);
      const end = Math.min(lines.length, input.endLine ?? lines.length);
      const selected = lines.slice(start - 1, end);
      const sliced = selected.join('\n');

      return {
        path: input.path,
        content: sliced,
        totalLines: lines.length,
        range: { start, end },
        anchors: input.includeAnchors
          ? buildAnchors(start, selected)
          : undefined,
      };
    }

    return {
      path: input.path,
      content,
      totalLines: lines.length,
      anchors: input.includeAnchors ? buildAnchors(1, lines) : undefined,
    };
  },
};
