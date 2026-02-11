/**
 * @agent-os/observability
 */
export {
  setupTelemetry,
  shutdownTelemetry,
  getInMemoryExporter,
} from './otel-setup.js';
export type { OTelConfig } from './otel-setup.js';
export { EventTracer } from './event-tracer.js';
