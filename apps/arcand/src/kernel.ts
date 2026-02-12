/**
 * @arcan-os/arcand — Kernel Factory
 *
 * Creates the shared services that power the arcand:
 * EventStore, RunManager, ToolKernel, ContextAssembler, and AiSdkEngine.
 *
 * The kernel is the dependency-injection root — modules receive it
 * via Elysia's `decorate` and destructure only what they need.
 */

import { ContextAssembler } from '@arcan-os/context';
import { AiSdkEngine } from '@arcan-os/engine-adapter';
import { EventStore } from '@arcan-os/event-store';
import { MemoryService } from '@arcan-os/memory';
import { RunManager } from '@arcan-os/run-manager';
import { SkillRegistry } from '@arcan-os/skills';
import {
  processRun,
  repoPatch,
  repoRead,
  repoSearch,
  ToolKernel,
} from '@arcan-os/tool-kernel';
import { env } from './env';

// ---------------------------------------------------------------------------
// Model resolution — maps "provider/model" to an AI SDK LanguageModel
// ---------------------------------------------------------------------------

async function resolveModel(modelSpec: string) {
  const [provider, ...rest] = modelSpec.split('/');
  const modelId = rest.join('/');

  switch (provider) {
    case 'anthropic': {
      const { createAnthropic } = await import('@ai-sdk/anthropic');
      return createAnthropic()(modelId);
    }
    case 'openai': {
      const { createOpenAI } = await import('@ai-sdk/openai');
      return createOpenAI()(modelId);
    }
    default:
      throw new Error(
        `Unknown model provider "${provider}". Use "anthropic/<model>" or "openai/<model>".`,
      );
  }
}

// ---------------------------------------------------------------------------
// Kernel type
// ---------------------------------------------------------------------------

export interface Kernel {
  eventStore: EventStore;
  runManager: RunManager;
  toolKernel: ToolKernel;
  contextAssembler: ContextAssembler;
  engine: AiSdkEngine | null;
  memoryService: MemoryService | null;
  workspace: string;
  modelSpec: string;
}

// ---------------------------------------------------------------------------
// Kernel factory
// ---------------------------------------------------------------------------

export interface KernelOptions {
  dbPath?: string;
  workspace?: string;
  model?: string;
  basePrompt?: string;
}

const DEFAULT_MODEL = 'anthropic/claude-sonnet-4-20250514';
const DEFAULT_PROMPT =
  'You are Arcan OS, a helpful coding assistant with access to file system tools.';

export async function createKernel(opts: KernelOptions = {}): Promise<Kernel> {
  const workspace = opts.workspace ?? env.ARCAN_OS_WORKSPACE;
  const modelSpec = opts.model ?? env.ARCAN_OS_MODEL ?? DEFAULT_MODEL;
  const dbPath = opts.dbPath ?? env.ARCAN_OS_DB;
  const basePrompt = opts.basePrompt ?? DEFAULT_PROMPT;

  // Core services
  const eventStore = new EventStore(dbPath);
  const runManager = new RunManager(eventStore);
  const toolKernel = new ToolKernel(workspace);

  // Register capability tools
  toolKernel.register(repoRead);
  toolKernel.register(repoSearch);
  toolKernel.register(repoPatch);
  toolKernel.register(processRun);

  // Rebuild seq counters if using persisted DB
  if (dbPath !== ':memory:') {
    eventStore.rebuildSeqCounters();
  }

  // Skills
  const skillRegistry = new SkillRegistry({
    workspace,
    homeDir: process.env.HOME ?? '/tmp',
  });

  // Context assembler
  const contextAssembler = new ContextAssembler({
    basePrompt,
    skillRegistry,
    workspace,
  });

  // Engine adapter (nullable — requires API key at runtime)
  let engine: AiSdkEngine | null = null;
  try {
    const model = await resolveModel(modelSpec);
    engine = new AiSdkEngine({
      model,
      toolKernel,
      maxSteps: 25,
      telemetryEnabled: true,
    });
  } catch (e) {
    // Engine creation can fail if no API key is set — that's OK for testing
    console.warn(
      `⚠️  Engine not available (model: ${modelSpec}). Runs will not invoke LLM. Error: ${e}`,
    );
  }

  if (engine) {
    console.log(`✅ Engine initialized with model: ${modelSpec}`);
  } else {
    console.log(`❌ Engine is NULL. Check API keys.`);
  }

  // Memory Service
  let memoryService: MemoryService | null = null;
  if (engine) {
    // We reuse the engine's model for memory processing for now
    // In production, you might want a cheaper/faster model for observation
    const memoryModel = await resolveModel(modelSpec); // Create new instance or reuse logic

    memoryService = new MemoryService({
      eventStore,
      model: memoryModel,
    });
  }

  return {
    eventStore,
    runManager,
    toolKernel,
    contextAssembler,
    engine,
    memoryService,
    workspace,
    modelSpec,
  };
}
