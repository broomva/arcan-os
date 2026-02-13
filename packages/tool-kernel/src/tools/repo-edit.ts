/**
 * repo.edit — Apply anchored file edits with stale-read protection
 *
 * This tool is designed for harness reliability. Instead of rewriting whole
 * files, callers can target anchored lines/ranges and provide optional
 * preconditions.
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ToolContext, ToolHandler } from '@arcan-os/core';
import { z } from 'zod';

const replaceLineOp = z.object({
  kind: z.literal('replace-line'),
  line: z.number().int().min(1),
  expectedHash: z.string().min(3),
  content: z.string(),
});

const insertAfterOp = z.object({
  kind: z.literal('insert-after'),
  line: z.number().int().min(1),
  expectedHash: z.string().min(3),
  content: z.string().describe('Text to insert after target line'),
});

const replaceRangeOp = z.object({
  kind: z.literal('replace-range'),
  startLine: z.number().int().min(1),
  endLine: z.number().int().min(1),
  startHash: z.string().min(3),
  endHash: z.string().min(3),
  content: z.string().describe('Replacement block text'),
});

const editOpSchema = z.discriminatedUnion('kind', [
  replaceLineOp,
  insertAfterOp,
  replaceRangeOp,
]);

export const inputSchema = z.object({
  path: z.string().describe('Relative path to the file to edit'),
  baseHash: z
    .string()
    .optional()
    .describe('Optional full-file hash for stale-read detection'),
  mode: z
    .enum(['atomic', 'best-effort'])
    .optional()
    .default('atomic')
    .describe(
      'atomic = reject all operations if any operation fails, best-effort = apply valid operations only',
    ),
  operations: z.array(editOpSchema).min(1),
});

type Input = z.infer<typeof inputSchema>;
type EditFailureCode =
  | 'file-not-found'
  | 'stale-base'
  | 'anchor-mismatch'
  | 'invalid-range';

interface AnchorWindow {
  line: number;
  hash: string;
}

interface OpError {
  index: number;
  kind: Input['operations'][number]['kind'];
  code: EditFailureCode;
  message: string;
  anchorWindow?: AnchorWindow[];
}

interface Output {
  path: string;
  fileHash: string;
  appliedOperations: number;
  failedOperations: OpError[];
}

const lineHash = (line: string): string =>
  createHash('sha1').update(line).digest('hex').slice(0, 6);

const fileHash = (content: string): string =>
  createHash('sha1').update(content).digest('hex');

const collectAnchorWindow = (
  lines: string[],
  centerLine: number,
): AnchorWindow[] => {
  const start = Math.max(1, centerLine - 1);
  const end = Math.min(lines.length, centerLine + 1);
  const window: AnchorWindow[] = [];

  for (let line = start; line <= end; line++) {
    const value = lines[line - 1] ?? '';
    window.push({ line, hash: lineHash(value) });
  }

  return window;
};

export const repoEdit: ToolHandler<Input, Output> = {
  id: 'repo.edit',
  description:
    'Apply anchored edits to a file with line-hash checks for stale-read and conflict detection.',
  // biome-ignore lint/suspicious/noExplicitAny: Zod schema type mismatch with ToolHandler
  inputSchema: inputSchema as any,
  category: 'write',

  async execute(input: Input, ctx: ToolContext): Promise<Output> {
    const fullPath = resolve(ctx.workspaceRoot, input.path);

    if (!existsSync(fullPath)) {
      return {
        path: input.path,
        fileHash: '',
        appliedOperations: 0,
        failedOperations: [
          {
            index: 0,
            kind: input.operations[0].kind,
            code: 'file-not-found',
            message: `File does not exist: ${input.path}`,
          },
        ],
      };
    }

    const original = readFileSync(fullPath, 'utf-8');
    if (input.baseHash && fileHash(original) !== input.baseHash) {
      return {
        path: input.path,
        fileHash: fileHash(original),
        appliedOperations: 0,
        failedOperations: [
          {
            index: 0,
            kind: input.operations[0].kind,
            code: 'stale-base',
            message: 'Base hash mismatch. Re-read file before editing.',
          },
        ],
      };
    }

    const sourceLines = original.split('\n');
    const workingLines = [...sourceLines];
    const errors: OpError[] = [];
    let applied = 0;

    for (const [index, op] of input.operations.entries()) {
      if (op.kind === 'replace-line') {
        const lineIdx = op.line - 1;
        if (lineIdx < 0 || lineIdx >= workingLines.length) {
          errors.push({
            index,
            kind: op.kind,
            code: 'invalid-range',
            message: `Line ${op.line} is out of range`,
          });
          continue;
        }
        if (lineHash(workingLines[lineIdx] ?? '') !== op.expectedHash) {
          errors.push({
            index,
            kind: op.kind,
            code: 'anchor-mismatch',
            message: `Line hash mismatch at line ${op.line}`,
            anchorWindow: collectAnchorWindow(workingLines, op.line),
          });
          continue;
        }
        workingLines[lineIdx] = op.content;
        applied++;
        continue;
      }

      if (op.kind === 'insert-after') {
        const lineIdx = op.line - 1;
        if (lineIdx < 0 || lineIdx >= workingLines.length) {
          errors.push({
            index,
            kind: op.kind,
            code: 'invalid-range',
            message: `Line ${op.line} is out of range`,
          });
          continue;
        }
        if (lineHash(workingLines[lineIdx] ?? '') !== op.expectedHash) {
          errors.push({
            index,
            kind: op.kind,
            code: 'anchor-mismatch',
            message: `Line hash mismatch at line ${op.line}`,
            anchorWindow: collectAnchorWindow(workingLines, op.line),
          });
          continue;
        }
        workingLines.splice(lineIdx + 1, 0, op.content);
        applied++;
        continue;
      }

      if (op.endLine < op.startLine) {
        errors.push({
          index,
          kind: op.kind,
          code: 'invalid-range',
          message: 'endLine must be greater than or equal to startLine',
        });
        continue;
      }

      const startIdx = op.startLine - 1;
      const endIdx = op.endLine - 1;
      if (startIdx < 0 || endIdx >= workingLines.length) {
        errors.push({
          index,
          kind: op.kind,
          code: 'invalid-range',
          message: `Range ${op.startLine}-${op.endLine} is out of bounds`,
        });
        continue;
      }

      const startMatches =
        lineHash(workingLines[startIdx] ?? '') === op.startHash;
      const endMatches = lineHash(workingLines[endIdx] ?? '') === op.endHash;
      if (!startMatches || !endMatches) {
        errors.push({
          index,
          kind: op.kind,
          code: 'anchor-mismatch',
          message: `Range hash mismatch for ${op.startLine}-${op.endLine}`,
          anchorWindow: collectAnchorWindow(workingLines, op.startLine),
        });
        continue;
      }

      const replacement = op.content.split('\n');
      workingLines.splice(startIdx, endIdx - startIdx + 1, ...replacement);
      applied++;
    }

    const hasErrors = errors.length > 0;
    if (input.mode === 'atomic' && hasErrors) {
      return {
        path: input.path,
        fileHash: fileHash(original),
        appliedOperations: 0,
        failedOperations: errors,
      };
    }

    const next = workingLines.join('\n');
    if (applied > 0) {
      writeFileSync(fullPath, next, 'utf-8');
    }

    return {
      path: input.path,
      fileHash: fileHash(applied > 0 ? next : original),
      appliedOperations: applied,
      failedOperations: errors,
    };
  },
};
