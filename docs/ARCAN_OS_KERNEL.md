Arcan OS — Architectural Definition (Open-Core Kernel + Managed Control Plane)

Goal: define an execution substrate for agentic, AI-native applications where reasoning proposes and the OS executes safely, with policy, approvals, audit, replay, and pluggable runtimes/tools.

This document is written to be a durable reference for design + implementation.

⸻

0) North Star

Arcan OS is not an “agent framework”.
It is an execution kernel + control plane that can host any reasoning layer and support arbitrary dynamic systems while remaining safe, observable, and governable.

Core mental model
	•	Planner / Reasoner (untrusted): produces intent, plans, tool selections, code/artifacts
	•	Arcan OS (trusted): enforces capability policies, schedules work, executes tools in isolation, records immutable evidence, requires approvals, streams events, supports replay

⸻

1) Design Principles

1.1 Planner / Executor Split (non-negotiable)
	•	The reasoning layer never directly performs side effects.
	•	All side effects must pass through the OS via typed tools.

1.2 Everything is an Event
	•	The system is event-sourced: append-only ledger of what happened.
	•	“State” is a projection, derived from events.

1.3 Capability-Based Security (default-deny)
	•	Tools declare required capabilities.
	•	Policies grant capabilities per run/tenant/user.
	•	No “security by prompt”.

1.4 Tool Calls are Side-Effect Boundaries

Each tool call has:
	•	schema, idempotency key, timeout, retry strategy
	•	redaction rules for logs
	•	deterministic error shape
	•	resource/budget accounting

1.5 Replayability & Explainability
	•	Every run can be replayed from the ledger.
	•	The system can answer: what happened, why, with what inputs, under what policy, with what approvals.

1.6 Isolation is Pluggable

Executors run tools under an isolation profile:
	•	local process (dev)
	•	container (prod baseline)
	•	WASM (high-control)
	•	remote worker pool

1.7 UI is a Projection Over Runs

The UI is not “chat-first”.
It is “mission control” over:
	•	run timeline
	•	plan graph
	•	step inspector
	•	tool invocations
	•	artifacts/diffs
	•	approvals/policy decisions

⸻

2) Core Entities (Domain Model)

2.1 Run

A Run represents a single agentic job instance.

Fields:
	•	run_id, tenant_id, initiator, run_type
	•	created_at, status, tags
	•	root_spec_ref
	•	budgets

2.2 Step

A unit of execution in the run graph.

Fields:
	•	step_id, run_id, name, kind, status, attempt
	•	inputs_ref, outputs_ref
	•	started_at, finished_at

2.3 ToolCall

The side-effect boundary.

Fields:
	•	tool_call_id, run_id, step_id
	•	tool_name, tool_version
	•	args_ref, result_ref
	•	status, idempotency_key
	•	timeout_ms, retry_policy
	•	capabilities_required
	•	policy_decision_ref, approval_ref
	•	resource_usage

2.4 Artifact

Produced object with lineage.

Fields:
	•	artifact_id, run_id, step_id
	•	type, content_hash, storage_uri, mime_type
	•	lineage

2.5 Approval

Structured human gate.

Fields:
	•	approval_id, run_id, scope
	•	requested_by, requested_from
	•	status, decision_reason, expires_at

2.6 PolicyDecision

Policy enforcement record.

Fields:
	•	policy_decision_id, run_id, tool_call_id
	•	policy_version
	•	inputs
	•	decision
	•	explanation
	•	constraints

⸻

3) System Architecture Overview

3.1 Components

OSS Kernel:
	•	event ledger
	•	policy engine
	•	tool registry
	•	executor interface
	•	scheduler baseline
	•	replay engine

Managed SaaS:
	•	multi-tenant control plane
	•	worker pools
	•	secrets broker
	•	enterprise policy and approvals
	•	observability and evals

3.2 Data flow
	1.	Run created
	2.	Planner attaches RunSpec
	3.	Scheduler activates steps
	4.	Tool calls pass policy and approvals
	5.	Executors run tools
	6.	Events emitted
	7.	UI consumes projections

⸻

4) Contracts & Specs

4.1 ToolSpec
	•	name, version, description
	•	input_schema, output_schema
	•	capabilities_required
	•	side_effects
	•	idempotent
	•	default_timeout_ms
	•	retry_policy
	•	redaction
	•	isolation_requirements

4.2 RunSpec
	•	run_type
	•	graph
	•	nodes (steps)
	•	constraints

4.3 Event Schema

Envelope:
	•	event_id, timestamp, tenant_id, run_id, type, payload, trace

Core events:
	•	run.*
	•	step.*
	•	tool.*
	•	artifact.*
	•	approval.*
	•	policy.*

⸻

5) Execution Model

5.1 Scheduler

Lease-based, retry-aware, approval-aware.

5.2 Executor Interface

Executes tool calls under isolation profiles.

5.3 Isolation Profiles

Network, filesystem, cpu/mem, secrets, outbound allowlists.

⸻

6) Policy & Governance
	•	Policy engine decides ALLOW / DENY / REQUIRE_APPROVAL
	•	All decisions are events
	•	Approvals unblock execution

⸻

7) Storage Model
	•	Append-only event ledger
	•	Projections
	•	Content-addressed artifact store

⸻

8) Observability & Replay
	•	Tracing
	•	Full and partial replay
	•	Time-travel debugging

⸻

9) SDKs & Integration
	•	Tool SDK
	•	Planner SDK
	•	Connector model

⸻

10) Interaction Surfaces
	•	RunTimeline
	•	PlanGraph
	•	StepInspector
	•	ToolInvocationPanel
	•	ArtifactViewer
	•	PolicyPanel
	•	ApprovalQueue

⸻

11) Multi-tenancy & Identity
	•	tenants, projects, users, service accounts

⸻

12) Security Model
	•	default deny
	•	scoped secrets
	•	data classification and redaction

⸻

13) Evaluations & Reliability
	•	eval runs
	•	regression harness

⸻

14) Open-Core Split

OSS:
	•	kernel, sdk, local runner, cli, minimal UI

SaaS:
	•	hosted control plane, workers, connectors, governance, observability

⸻

15) Repository Structure

agentos/
docs/
core/
sdk/
cli/
ui/
examples/

⸻

16) Procurement Workflow

Uses the same primitives: runs, steps, tools, artifacts, approvals, policies.

⸻

17) Implementation Roadmap
	•	ledger
	•	tools
	•	policy
	•	executor
	•	scheduler
	•	artifacts
	•	streaming
	•	replay

⸻

18) Key Decisions
	•	event schema
	•	tool spec
	•	policy interface
	•	artifact model
	•	executor isolation

⸻

19) Non-Goals
	•	not a chat app
	•	not a model provider
	•	not an ERP replacement

⸻

20) Glossary

Planner, Executor, PEP, Ledger, Projection, Artifact