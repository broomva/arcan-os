Agent OS Blueprint — Mastra + Bun + Elysia + skills.sh

This document is the authoritative architectural description of the Agent OS. It is intentionally written as an explanation-first document. You should be able to build the system end‑to‑end from this file without reverse‑engineering bullet lists.

The goal of this system is to support long‑running, file‑based agents with human approvals, replayable execution, and skills.sh‑style procedural skills, while keeping the agent engine (Mastra today) fully replaceable.

⸻

What problem this architecture actually solves

Traditional “agent apps” fail when:

• runs last longer than one request
• tools mutate the filesystem
• humans must approve dangerous actions
• the UI disconnects and reconnects
• you want to replay or audit what really happened

This architecture treats an agent run as a durable execution process, not a chat session.

The daemon is the operating system.
The model is only a reasoning component.

⸻

Mental model (read this before anything else)

A run is an ordered stream of immutable events.

The only source of truth is the event log.

Everything else — CLI, TUI, state, resume, approvals, artifacts — is derived from those events.

The agent engine never talks to the filesystem, shell, or UI directly.
It only requests tools.

⸻

1. System architecture

The system is split into five hard layers:
	1.	Agent daemon (agentd)
	2.	Run orchestration core
	3.	Tool kernel
	4.	Skills layer
	5.	Agent engine adapter (Mastra)

Clients (CLI/TUI/web) never talk to the engine. They only consume events.

User ──> agentd ──> RunManager ──> EngineAdapter(Mastra)
                  │
                  ├─> ToolKernel
                  ├─> SkillsRegistry
                  ├─> EventStore
                  └─> SSE broadcaster


⸻

2. Run lifecycle (the real execution model)

This section describes the exact control flow of a run.

2.1 Creating a run

The client calls:

POST /v1/runs

The daemon creates a RunRecord and immediately emits:

run.started

A RunManager instance is created and enqueued in the session queue.

Only one run may execute at a time per session.

⸻

2.2 Context assembly

Before the first model call, the daemon builds an execution context.

The ContextAssembler loads:

• last checkpoint (if resuming)
• previous run summary (if any)
• loaded skills text
• memory file
• recent tool outputs (summarised)

It does not scan the whole repository.
The agent must use tools to explore files.

The output of this phase is an AssembledContext object.

⸻

2.3 Engine execution

The EngineAdapter invokes Mastra with the assembled context and user input.

Mastra produces a stream of internal parts.

The adapter translates them into engine‑agnostic chunks:

• text output
• tool requests
• completion
• error

At this point Mastra is completely isolated behind the adapter.

⸻

2.4 Tool requests

When the engine emits a tool request:
	1.	The adapter emits a canonical event:
tool.call
	2.	The ToolKernel is invoked.
	3.	If the tool requires approval, execution pauses and:
approval.requested is emitted
	4.	The run enters the paused state.
	5.	When the user resolves the approval, the run resumes and the tool is executed.
	6.	The tool result is emitted as:
tool.result
	7.	The result is fed back into the engine.

This mechanism is the only way the engine can mutate the environment.

⸻

2.5 Output streaming

Whenever the engine produces text, the adapter emits:

output.delta

These events are streamed to all connected clients.

Clients never see engine internals.

⸻

2.6 Artifacts

When a meaningful file result is produced (patch, report, log, snapshot), the daemon stores the content in the artifact store and emits:

artifact.emitted

Artifacts are content‑addressed and immutable.

⸻

2.7 Completion

When the engine finishes, the daemon emits:

run.completed

If the engine fails, it emits:

run.failed

⸻

3. Canonical event model

All system behaviour is observable through a single event stream.

Every event has the same envelope:

interface AgentEvent<T> {
  eventId: string
  runId: string
  sessionId: string
  seq: number
  ts: number
  type: AgentEventType
  payload: T
}

The only supported v1 event types are:

• run.started / run.completed / run.failed / run.paused / run.resumed
• output.delta / output.message
• tool.call / tool.result
• approval.requested / approval.resolved
• artifact.emitted
• checkpoint.created

This is deliberately minimal.

⸻

4. Persistence and replay

The daemon stores events in SQLite.

The database is append‑only.

A run is reconstructed by replaying its events in order.

Clients reconnect using SSE with Last‑Event‑ID, which corresponds to the event sequence number.

Checkpoints exist only to accelerate resume.

They do not replace the event log.

⸻

5. Tool kernel (file‑based execution layer)

The tool kernel is the most critical security boundary.

The engine never executes tools directly.

Instead, the kernel exposes a controlled command surface.

5.1 Tool interface

Each tool is registered as:

interface ToolHandler<I, O> {
  id: string
  requiresApproval: boolean
  execute(input: I, ctx: ToolContext): Promise<O>
}

The kernel enforces:

• workspace jail
• path normalisation
• allowlists / denylists
• timeouts
• output size limits
• redaction

5.2 Mandatory v1 tools

• fs.read
• fs.patch
• search.rg
• shell.run

All write and shell operations require approval in v1.

⸻

6. Skills system (skills.sh)

Skills are treated as procedural knowledge packages.

They are not tools and they are not workflows.

A skill is a directory containing a SKILL.md file and optional resources.

The daemon maintains a SkillsRegistry that:

• scans skill roots
• indexes metadata
• lazily loads SKILL.md content

6.1 Skill usage model

When a skill is loaded, its full instructions are injected into the next context assembly.

The engine sees the skill only as text instructions.

Skill execution in v1 is purely instruction‑driven.

Runnable skills are intentionally deferred to v2.

⸻

7. Context and memory

The agent is not allowed to see the repository by default.

It must retrieve information through tools.

ContextAssembler builds prompts from:

• user input
• recent output
• summaries
• skill instructions
• memory file

When context grows too large, Compactor creates a summary artifact and replaces detailed history with a reference.

⸻

8. Mastra adapter

Mastra is used strictly as a reasoning engine.

The adapter is an anti‑corruption layer.

It converts Mastra parts into:

• text chunks
• tool request chunks
• completion

Mastra internal state is never persisted.

Resume always reconstructs context and starts a fresh engine invocation.

⸻

9. Daemon server (Elysia)

Elysia is used only as an HTTP/SSE transport layer.

The daemon exposes three mandatory endpoints:

• POST /v1/runs
• GET  /v1/runs/:runId/events
• POST /v1/approvals/:approvalId

SSE must support replay using Last‑Event‑ID.

⸻

10. Clients

Clients subscribe to the event stream and build projections.

The TUI and CLI are pure read models.

They never influence execution except through commands (run creation and approvals).

⸻

11. Project structure

The repository is organised so that no client or engine can bypass the OS core.

apps/daemon contains only orchestration and adapters.

packages/core contains only types and shared contracts.

packages/tool‑kernel, skills, persistence and engine adapters are isolated packages.

This enforces dependency direction.

⸻

12. Engine abstraction

The OS depends on a single interface:

interface AgentEngine {
  run(req: EngineRunRequest): AsyncIterable<EngineChunk>
  feedToolResult(callId: string, result: ToolResultPayload): Promise<void>
}

Mastra implements this interface through the adapter.

Nothing else in the system knows Mastra exists.

⸻

13. Run orchestration

RunManager owns the lifecycle and state machine.

States:

running → paused → running → completed

The only reason a run pauses in v1 is approval gating.

⸻

14. Checkpoints and resume

A checkpoint contains:

• summary
• relevant file references
• loaded skills
• memory snapshot
• last sequence number

On resume, context is rebuilt and the engine is started again.

The system does not attempt to restore engine state.

⸻

15. Design patterns used intentionally

• Ports & Adapters (engine and tools)
• Event sourcing (lightweight)
• Command pattern (tools)
• Anti‑corruption layer (Mastra adapter)
• Projection / CQRS for UI

⸻

16. What this architecture deliberately avoids

• engine‑specific event formats
• model‑specific memory
• implicit filesystem access
• background auto‑approval logic
• workflow DSLs

⸻

17. Development rules
	1.	Every behaviour must be visible as an event.
	2.	No client talks directly to the engine.
	3.	No tool bypasses the kernel.
	4.	No write without approval.
	5.	No persistence outside the event store.

⸻

18. Definition of done for v1

The system can:

• apply a patch to a repository
• request approvals for all mutations
• stream execution live
• replay a finished run
• resume after restart

If any of these fail, the architecture is incomplete.

⸻

36. AI-native execution model (the missing conceptual layer)

This architecture intentionally separates reasoning from effects.

The LLM is allowed to propose arbitrary intents. The system controls how those intents become real-world effects.

The execution contract is:

Intent → Capability tool call → Risk evaluation → Preview (if needed) → Approval (if needed) → Effect → Event

This is not a validator of reasoning. It is an execution governor.

The agent is free to attempt any action through exposed capabilities. The kernel decides the control path.

⸻

37. Capability-based tools (not raw bash-first tools)

The tool layer must expose capabilities, not generic shell access.

This allows the agent to reason freely while keeping effects observable and controllable.

Minimum v1 capability set:

repo.search(query, globs?)
repo.read(path, range?)
repo.patch(path, unifiedDiff)
process.run(command, cwd?)
test.run(name?)
lint.run()

Each capability is implemented internally by the kernel (which may call shell or libraries), but the agent never sees raw system primitives.

This preserves AI freedom while creating structured audit points.

⸻

38. Risk scoring and execution gating

Every tool invocation is classified by the kernel.

The kernel computes a risk profile:

{
toolId,
category,         // read | write | exec | network
scope,            // files, directories, commands
estimatedImpact,  // small | medium | large
touchesSecrets,
touchesConfig,
touchesBuild,
}

This is used only to determine the control path.

Allowed control paths:

• auto-execute
• preview + auto-execute
• preview + approval
• deny

Deny is reserved only for invariant violations (sandbox escape, policy violations).

⸻

39. Preview-first execution

For any non-trivial write or execution, the kernel must produce a preview payload.

Examples:

repo.patch preview:
	•	files touched
	•	number of hunks
	•	line counts

process.run preview:
	•	command
	•	working directory
	•	estimated side effects (if known)

The preview is embedded in approval.requested events.

This preview is also fed back to the agent so it can refine its plan.

⸻

40. Adaptive trust and progressive autonomy

The system supports progressive reduction of friction.

The kernel maintains per-repository and per-session trust metadata:
	•	count of successful executions
	•	count of failed tool calls
	•	count of reverted patches
	•	manual overrides

Policy may downgrade or upgrade approval requirements based on this metadata.

This keeps the system AI-native by adapting execution control based on performance.

⸻

41. policy.yaml (kernel policy contract)

Example minimal policy file:

workspace:
  root: ./
  denyPatterns:
    - "**/.git/**"

execution:
  timeouts:
    process.run: 300s

capabilities:
  repo.read:
    approval: never
  repo.search:
    approval: never
  repo.patch:
    approval: always
  process.run:
    approval: risk

risk:
  highRiskCommands:
    - rm
    - sudo
    - curl
    - wget

redaction:
  keys:
    - SECRET
    - TOKEN
    - API_KEY

limits:
  maxStdout: 20000
  maxDiffSize: 200000

The kernel is the only consumer of this policy.

⸻

42. How skills.sh integrates with execution

Skills are injected into context, not executed directly.

However, skills may reference capabilities by name:

Example inside SKILL.md:

“Use repo.search to locate the migration files. Then apply a patch using repo.patch. Finally run test.run.”

This creates a soft procedural contract without granting new execution privileges.

Skills do not bypass the kernel.

⸻

43. Using bash-tool / skills.sh style runners

If a skill provides runnable scripts (v2):

• scripts are executed only through process.run
• scripts must live inside the workspace jail
• script execution always goes through preview + approval

bash-tool becomes an implementation detail of process.run.

It is not exposed to the agent.

⸻

44. Mastra integration with capability tools

Mastra tools must map strictly to kernel capabilities.

Mastra tool handlers are thin wrappers that emit:

EngineChunk(kind=“tool-request”)

The kernel resolves and executes.

Mastra never receives raw filesystem handles or shell access.

⸻

45. Why this is AI-native (and not rule-based automation)

The model is never constrained in planning or proposing actions.

Constraints apply only at the effect boundary.

The system learns operational safety through:

• adaptive trust
• approval history
• run outcomes
• repository context

This preserves open-ended reasoning while controlling impact.

⸻

46. Explicit invariants (non-negotiable)

These invariants are enforced regardless of policy:

• no filesystem escape
• no execution outside workspace
• no hidden tool execution
• no unlogged effects
• no unbounded output

These are safety invariants, not agent logic.

⸻

47. What makes this an Agent OS (not an agent framework)

This system provides:

• execution scheduling
• durable process state
• approval gating
• execution policy
• audit trail
• replay
• projections

The agent engine is replaceable.

The OS is the product.

⸻

48. Implementation order (to avoid architectural collapse)
	1.	Event store + SSE replay
	2.	RunManager + approval gate
	3.	Tool kernel with policy.yaml
	4.	Capability tools (read, patch, run)
	5.	Mastra adapter
	6.	Context assembler
	7.	Skills registry

Only after these exist should TUI and skills runners be implemented.

⸻

49. Strategic warning

If you weaken the kernel boundary or embed execution inside the engine adapter, the system collapses into a coding agent.

If you overbuild planners, graphs, and workflows before shipping the execution loop, you will stall.

The kernel + run lifecycle is the product.