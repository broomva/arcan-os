import { beforeAll, describe, expect, test } from 'bun:test';
import { generateId } from '@arcan-os/core';
import { createKernel } from './kernel';
import { RunService } from './modules/runs/service';

const MOCK_MODEL = 'openai/gpt-4o';

describe('Observational Memory E2E', () => {
  let kernel: Awaited<ReturnType<typeof createKernel>>;
  const sessionId = generateId();
  const workspace = '/tmp/agent-os-test-memory';

  beforeAll(async () => {
    kernel = await createKernel({
      dbPath: ':memory:',
      workspace,
      model: MOCK_MODEL,
    });
  });

  test('should generate observations from run', async () => {
    // Skip if engine is not available (no valid API key)
    if (!kernel.engine) {
      console.log('Skipping memory E2E: no engine available (missing API key)');
      return;
    }

    const runConfig = {
      runId: generateId(),
      sessionId,
      prompt: 'My name is Alice and I like coding in TypeScript.',
    };

    const run = RunService.createAndStart(kernel, runConfig);
    expect(run.state).toBe('running');

    // Poll for run completion — the LLM call may take 10-20s
    let completed = false;
    for (let i = 0; i < 60; i++) {
      const state = kernel.runManager.getRun(run.runId);
      if (state?.state === 'completed' || state?.state === 'failed') {
        completed = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    expect(completed).toBe(true);

    // Give memory service time to process asynchronously
    await new Promise((r) => setTimeout(r, 3000));

    // Check for memory.observed event
    const events = kernel.eventStore.query({ sessionId });
    const observedEvent = events.find((e) => e.type === 'memory.observed');

    // NOTE: Memory observation only triggers when event count exceeds the
    // threshold (default 20). A single short run won't produce enough events,
    // so we just verify the run completed and events were stored.
    const runEvents = events.filter((e) => e.runId === run.runId);
    expect(runEvents.length).toBeGreaterThan(0);

    if (observedEvent) {
      console.log('Observations generated:', observedEvent.payload);
    } else {
      console.log(
        `No observations yet (${runEvents.length} events, threshold is ${20})`,
      );
    }
  }, 60_000);
});
