/**
 * @agent-os/observability
 */

export { EventTracer } from './event-tracer.js';
export type { OTelConfig } from './otel-setup.js';
export {
  getInMemoryExporter,
  setupTelemetry,
  shutdownTelemetry,
} from './otel-setup.js';
