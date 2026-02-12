/**
 * @agent-os/core — Tests
 */

import { describe, expect, it } from 'bun:test';
import { generateId, now, VALID_TRANSITIONS } from '../src/index.js';

// ---------------------------------------------------------------------------
// generateId
// ---------------------------------------------------------------------------

describe('generateId', () => {
  it('returns a non-empty string', () => {
    const id = generateId();
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
  });

  it('returns unique values on successive calls', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateId()));
    expect(ids.size).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// now
// ---------------------------------------------------------------------------

describe('now', () => {
  it('returns a positive number', () => {
    const ts = now();
    expect(typeof ts).toBe('number');
    expect(ts).toBeGreaterThan(0);
  });

  it('returns a value close to Date.now()', () => {
    const before = Date.now();
    const ts = now();
    const after = Date.now();
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });
});

// ---------------------------------------------------------------------------
// VALID_TRANSITIONS
// ---------------------------------------------------------------------------

describe('VALID_TRANSITIONS', () => {
  it('allows created → running', () => {
    expect(VALID_TRANSITIONS.created).toContain('running');
  });

  it('allows created → failed', () => {
    expect(VALID_TRANSITIONS.created).toContain('failed');
  });

  it('allows running → paused, completed, failed', () => {
    expect(VALID_TRANSITIONS.running).toEqual(
      expect.arrayContaining(['paused', 'completed', 'failed']),
    );
  });

  it('allows paused → running', () => {
    expect(VALID_TRANSITIONS.paused).toContain('running');
  });

  it('allows paused → failed', () => {
    expect(VALID_TRANSITIONS.paused).toContain('failed');
  });

  it('completed is terminal', () => {
    expect(VALID_TRANSITIONS.completed).toEqual([]);
  });

  it('failed is terminal', () => {
    expect(VALID_TRANSITIONS.failed).toEqual([]);
  });

  it('covers all five states', () => {
    const states = Object.keys(VALID_TRANSITIONS);
    expect(states).toEqual(
      expect.arrayContaining([
        'created',
        'running',
        'paused',
        'completed',
        'failed',
      ]),
    );
    expect(states).toHaveLength(5);
  });
});
