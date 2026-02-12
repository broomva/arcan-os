/**
 * repo.search — Search workspace files using pattern matching
 * (V1 spec §37: repo.search(query, globs?))
 */

import type { ToolContext, ToolHandler } from '@arcan-os/core';
import { z } from 'zod';

export const inputSchema = z.object({
  query: z.string().describe('Search pattern (text or regex)'),
  globs: z
    .array(z.string())
    .optional()
    .describe('File glob patterns to include'),
  maxResults: z
    .number()
    .optional()
    .default(50)
    .describe('Maximum results to return'),
});

type Input = z.infer<typeof inputSchema>;

interface SearchMatch {
  file: string;
  line: number;
  content: string;
}

interface Output {
  matches: SearchMatch[];
  totalMatches: number;
  truncated: boolean;
}

export const repoSearch: ToolHandler<Input, Output> = {
  id: 'repo.search',
  description:
    'Search for text patterns across workspace files. Returns matching lines with file paths and line numbers.',
  // biome-ignore lint/suspicious/noExplicitAny: Zod schema type mismatch with ToolHandler
  inputSchema: inputSchema as any,
  category: 'read',

  async execute(input: Input, ctx: ToolContext): Promise<Output> {
    const maxResults = input.maxResults ?? 50;

    // Use ripgrep if available, fall back to Bun subprocess with grep
    try {
      const args = [
        '--json',
        '--max-count',
        String(maxResults),
        '--no-heading',
      ];

      if (input.globs && input.globs.length > 0) {
        for (const glob of input.globs) {
          args.push('--glob', glob);
        }
      }

      args.push(input.query, ctx.workspaceRoot);

      const proc = Bun.spawn(['rg', ...args], {
        stdout: 'pipe',
        stderr: 'pipe',
        signal: ctx.signal,
      });

      const stdout = await new Response(proc.stdout).text();
      const matches: SearchMatch[] = [];

      for (const line of stdout.split('\n').filter(Boolean)) {
        try {
          const parsed = JSON.parse(line);
          if (parsed.type === 'match') {
            matches.push({
              file: parsed.data.path.text.replace(`${ctx.workspaceRoot}/`, ''),
              line: parsed.data.line_number,
              content: parsed.data.lines.text.trimEnd(),
            });
          }
        } catch {
          // Skip malformed lines
        }
      }

      return {
        matches: matches.slice(0, maxResults),
        totalMatches: matches.length,
        truncated: matches.length > maxResults,
      };
    } catch {
      // Fallback: simple grep-like search using Bun
      const args = ['-rn', '--include=*', input.query, ctx.workspaceRoot];
      const proc = Bun.spawn(['grep', ...args], {
        stdout: 'pipe',
        stderr: 'pipe',
        signal: ctx.signal,
      });

      const stdout = await new Response(proc.stdout).text();
      const matches: SearchMatch[] = [];

      for (const line of stdout.split('\n').filter(Boolean)) {
        const colonIdx = line.indexOf(':');
        const secondColon = line.indexOf(':', colonIdx + 1);
        if (colonIdx > 0 && secondColon > colonIdx) {
          matches.push({
            file: line.slice(0, colonIdx).replace(`${ctx.workspaceRoot}/`, ''),
            line: Number.parseInt(line.slice(colonIdx + 1, secondColon), 10),
            content: line.slice(secondColon + 1).trimEnd(),
          });
        }
      }

      return {
        matches: matches.slice(0, maxResults),
        totalMatches: matches.length,
        truncated: matches.length > maxResults,
      };
    }
  },
};
