/**
 * @agent-os/observability — OTel Setup
 *
 * Configures OpenTelemetry tracing for Agent OS.
 * AI SDK's `experimental_telemetry` emits OTel spans automatically.
 * This module configures the TracerProvider and exporters.
 */

import { trace, type Tracer } from '@opentelemetry/api';
import {
  BasicTracerProvider,
  SimpleSpanProcessor,
  InMemorySpanExporter,
  type SpanExporter,
} from '@opentelemetry/sdk-trace-base';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OTelConfig {
  /** Service name for OTel resource */
  serviceName?: string;
  /** Span exporters to register */
  exporters?: SpanExporter[];
  /** Enable LangSmith exporter */
  langsmith?: {
    apiKey: string;
    endpoint?: string;
    project?: string;
  };
  /** OTLP endpoint (e.g., Jaeger, Honeycomb) */
  otlpEndpoint?: string;
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let _provider: BasicTracerProvider | null = null;
let _inMemoryExporter: InMemorySpanExporter | null = null;

/**
 * Initialize OTel tracing for Agent OS.
 * Returns a Tracer that can be passed to AI SDK's `experimental_telemetry`.
 */
export function setupTelemetry(config: OTelConfig = {}): Tracer {
  const serviceName = config.serviceName ?? 'agent-os';

  const provider = new BasicTracerProvider();
  _provider = provider;

  // Add configured exporters
  const exporters: SpanExporter[] = config.exporters ?? [];

  // Add OTLP exporter if endpoint is set
  if (config.otlpEndpoint) {
    try {
      // Dynamic import to keep it optional
      const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http');
      exporters.push(
        new OTLPTraceExporter({ url: config.otlpEndpoint }),
      );
    } catch {
      console.warn(
        '[agent-os/observability] OTLP exporter not available. Install @opentelemetry/exporter-trace-otlp-http',
      );
    }
  }

  // Add LangSmith exporter if configured
  if (config.langsmith) {
    const langsmithExporter = createLangSmithExporter(config.langsmith);
    if (langsmithExporter) {
      exporters.push(langsmithExporter);
    }
  }

  // If no exporters configured, use in-memory for testing
  if (exporters.length === 0) {
    _inMemoryExporter = new InMemorySpanExporter();
    exporters.push(_inMemoryExporter);
  }

  for (const exporter of exporters) {
    provider.addSpanProcessor(new SimpleSpanProcessor(exporter));
  }

  // Return tracer directly from the provider instance, NOT from the
  // global trace singleton (which can only be set once and silently
  // ignores subsequent register() calls).
  return provider.getTracer(serviceName);
}

/**
 * Shutdown telemetry. Flushes all pending spans.
 */
export async function shutdownTelemetry(): Promise<void> {
  if (_provider) {
    await _provider.shutdown();
    _provider = null;
  }
}

/**
 * Get the in-memory exporter for testing/inspection.
 */
export function getInMemoryExporter(): InMemorySpanExporter | null {
  return _inMemoryExporter;
}

// ---------------------------------------------------------------------------
// LangSmith exporter
// ---------------------------------------------------------------------------

/**
 * Create a LangSmith-compatible OTel exporter.
 *
 * LangSmith supports receiving OTel traces via its OTLP-compatible endpoint.
 * AI SDK's `experimental_telemetry` emits standard OTel spans that LangSmith
 * can ingest directly.
 */
function createLangSmithExporter(config: {
  apiKey: string;
  endpoint?: string;
  project?: string;
}): SpanExporter | null {
  try {
    // LangSmith accepts OTel traces at its OTLP endpoint
    const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http');

    const endpoint = config.endpoint ?? 'https://api.smith.langchain.com';
    const project = config.project ?? 'agent-os';

    return new OTLPTraceExporter({
      url: `${endpoint}/otel/v1/traces`,
      headers: {
        'x-api-key': config.apiKey,
        'Langsmith-Project': project,
      },
    });
  } catch {
    console.warn(
      '[agent-os/observability] LangSmith OTel exporter not available. Install @opentelemetry/exporter-trace-otlp-http',
    );
    return null;
  }
}
