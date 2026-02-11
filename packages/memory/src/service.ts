import type { EventStore } from '@agent-os/event-store';
import type { AgentEvent, SessionSnapshotData } from '@agent-os/core';
import type { LanguageModel } from 'ai';
import type { RunManager } from '@agent-os/run-manager';
import { Observer } from './observer.js';
import { Reflector } from './reflector.js';

export interface MemoryServiceConfig {
  eventStore: EventStore;
  model: LanguageModel;
  /**
   * Number of events to accumulate before running the observer.
   * Default: 20
   */
  observationThreshold?: number;
  /**
   * Number of observations to accumulate before running the reflector.
   * Default: 10
   */
  reflectionThreshold?: number;
}

export class MemoryService {
  private observer: Observer;
  private reflector: Reflector;
  private eventStore: EventStore;
  private observationThreshold: number;
  private reflectionThreshold: number;

  constructor(config: MemoryServiceConfig) {
    this.eventStore = config.eventStore;
    this.observer = new Observer(config.model);
    this.reflector = new Reflector(config.model);
    this.observationThreshold = config.observationThreshold ?? 20;
    this.reflectionThreshold = config.reflectionThreshold ?? 10;
  }

  /**
   * Process a single run for memory updates.
   * Checks if enough events have accumulated since the last observation.
   * 
   * @param config - Dependencies injected at runtime (e.g. RunManager to emit events)
   */
  async processRun(
    sessionId: string,
    runId: string,
    runManager: RunManager, // Need this to emit events
  ): Promise<void> {
    const snapshot = this.eventStore.getLatestSnapshot<SessionSnapshotData>({ sessionId });
    
    // Default to 0 if no snapshot
    const lastSeq = snapshot?.data.lastObservedSeq ?? 0;
    
    // 1. Fetch unobserved events from the store
    // Use lastSeq + 1 to avoid re-reading the last processed event
    const newEvents = this.eventStore.query({
      sessionId,
      afterSeq: lastSeq,
      order: 'asc',
    });

    if (newEvents.length < this.observationThreshold) {
      return;
    }

    // 2. Run Observer
    // console.log(`[Memory] Observing ${newEvents.length} events for session ${sessionId}...`);
    const newObservations = await this.observer.observe(newEvents);
    
    // Calculate the sequence range we covered
    const minSeq = newEvents.length > 0 ? newEvents[0].seq : lastSeq;
    const maxSeq = newEvents.length > 0 ? newEvents[newEvents.length - 1].seq : lastSeq;

    // 3. Emit "memory.observed" event 
    // This updates the snapshot projection (which adds observations + updates lastObservedSeq)
    // We attach it to the current runId.
    if (newObservations.length > 0 || maxSeq > lastSeq) {
      runManager.emit(runId, 'memory.observed', {
        observations: newObservations,
        processedSeqRange: { start: minSeq, end: maxSeq },
      });
    }

    // 4. Check for Reflections
    // We need the accumulated observations.
    // The snapshot might not be immediately updated if 'emit' is async or projection is laggy.
    // However, in our system, projections happen on-read or are eventually consistent.
    // Let's assume we can rely on the snapshot state *plus* our new observations for a quick check.
    
    const allObservations = [...(snapshot?.data.observations ?? []), ...newObservations];

    if (allObservations.length >= this.reflectionThreshold) {
      // Run Reflector
      // console.log(`[Memory] Reflecting on ${allObservations.length} observations...`);
      const newReflections = await this.reflector.reflect(allObservations);
      
      if (newReflections.length > 0) {
        runManager.emit(runId, 'memory.reflected', {
          reflections: newReflections,
        });
      }
    }
  }
}
