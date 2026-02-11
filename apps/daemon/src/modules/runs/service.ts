/**
 * Runs module — Service (business logic)
 *
 * Decoupled from Elysia context. Handles run creation, engine orchestration,
 * and SSE stream construction.
 */

import type { AgentEvent, RunConfig } from '@agent-os/core';
import type { Kernel } from '../../kernel';

// ---------------------------------------------------------------------------
// RunService — abstract class, all static (no instance needed)
// ---------------------------------------------------------------------------

export abstract class RunService {
  /**
   * Create a run, start it, and kick off the engine loop in the background.
   * Returns the run record synchronously; the engine runs asynchronously.
   */
  static createAndStart(kernel: Kernel, config: RunConfig) {
    const record = kernel.runManager.createRun(config);
    const startEvent = kernel.runManager.startRun(record.runId);

    // Fire the engine loop asynchronously (non-blocking)
    if (kernel.engine) {
      RunService.runEngineLoop(kernel, record.runId, config).catch((err) => {
        console.error(`Engine error for run ${record.runId}:`, err);
        try {
          kernel.runManager.failRun(record.runId, String(err));
        } catch {
          // Run may already be in terminal state
        }
      });
    }

    return {
      runId: record.runId,
      sessionId: record.sessionId,
      state: record.state,
      startedAt: startEvent.ts,
    };
  }

  /**
   * Execute the engine adapter loop and pipe events into the RunManager.
   * Runs in background — errors are caught and mark the run as failed.
   */
  private static async runEngineLoop(kernel: Kernel, runId: string, config: RunConfig) {
    if (!kernel.engine) return;

    // Assemble context
    const tools = kernel.toolKernel.getTools();
    
    // Get Memory Snapshot (contains observations/reflections)
    // Note: We're using the EventStore to get the latest snapshot
    const sessionSnapshot = kernel.eventStore.getLatestSnapshot({ sessionId: config.sessionId });

    const request = kernel.contextAssembler.assemble({
      runConfig: config,
      messages: [],
      tools,
      sessionSnapshot: sessionSnapshot?.type === 'session' ? sessionSnapshot.data : undefined,
    });

    // Stream events from the engine
    for await (const event of kernel.engine.run(request)) {
      // Emit through RunManager → EventStore
      kernel.runManager.emit(runId, event.type, event.payload);
    }

    // Complete the run
    kernel.runManager.completeRun(runId);

    // Trigger Observational Memory processing
    if (kernel.memoryService) {
      // Fire-and-forget or await?
      // It's background processing, so we can await it if we want it to finish before fully "returning",
      // but typically memory is eventually consistent.
      // However, for debugging/testing, awaiting is safer.
      // Let's fire-and-forget but log errors.
      kernel.memoryService
        .processRun(config.sessionId, runId, kernel.runManager)
        .catch((err) => {
          console.error(`[Memory] Error processing run ${runId}:`, err);
        });
    }
  }

  /**
   * Build an SSE ReadableStream for a run's events.
   * Replays existing events, then subscribes to live events.
   */
  static buildEventStream(
    kernel: Kernel,
    runId: string,
    lastEventId: string | null,
    abortSignal: AbortSignal,
  ): ReadableStream {
    return new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();

        const send = (event: AgentEvent) => {
          const data = JSON.stringify(event);
          const sseMessage = `id: ${event.eventId}\nevent: ${event.type}\ndata: ${data}\n\n`;
          try {
            controller.enqueue(encoder.encode(sseMessage));
          } catch {
            // Stream closed
          }
        };

        // Resolve afterSeq from Last-Event-ID
        let afterSeq = 0;
        if (lastEventId) {
          const events = kernel.eventStore.query({ runId });
          const lastEvent = events.find((e) => e.eventId === lastEventId);
          if (lastEvent) afterSeq = lastEvent.seq;
        }

        // Replay existing events
        const existingEvents = kernel.eventStore.query({
          runId,
          afterSeq,
          order: 'asc',
        });

        let isTerminal = false;
        for (const event of existingEvents) {
          send(event);
          if (event.type === 'run.completed' || event.type === 'run.failed') {
            isTerminal = true;
          }
        }

        if (isTerminal) {
          try { controller.close(); } catch { /* already closed */ }
          return;
        }

        // Subscribe to live events
        const unsub = kernel.runManager.onEvent((event) => {
          if (event.runId === runId) send(event);

          if (
            event.runId === runId &&
            (event.type === 'run.completed' || event.type === 'run.failed')
          ) {
            try { controller.close(); } catch { /* already closed */ }
            unsub();
          }
        });

        abortSignal.addEventListener('abort', () => {
          unsub();
          try { controller.close(); } catch { /* already closed */ }
        });
      },
    });
  }
}
