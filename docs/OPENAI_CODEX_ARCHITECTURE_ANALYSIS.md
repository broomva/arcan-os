# OpenAI Codex Architecture Analysis

**Repository:** https://github.com/openai/codex
**Analysis Date:** February 9, 2026
**Latest Version:** 0.98.0 (479 releases)
**License:** Apache-2.0
**Primary Language:** Rust (95.9%), TypeScript (2.6%), Python (0.9%)

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [High-Level Architecture](#high-level-architecture)
3. [Core Components](#core-components)
4. [Data Flow Architecture](#data-flow-architecture)
5. [Key Architectural Decisions](#key-architectural-decisions)
6. [Dependency Chain Analysis](#dependency-chain-analysis)
7. [Implementation Highlights](#implementation-highlights)
8. [Security Architecture](#security-architecture)
9. [Build & Distribution Strategy](#build--distribution-strategy)
10. [Key Takeaways](#key-takeaways)
11. [References](#references)

---

## Executive Summary

OpenAI Codex is a **lightweight coding agent that runs locally in the terminal**, designed to assist developers with software development tasks. The project demonstrates a sophisticated multi-language architecture with:

- **Rust core** for performance-critical business logic and sandboxing
- **TypeScript SDK** for embedding in custom applications
- **Node.js CLI** for cross-platform distribution via npm
- **Model Context Protocol (MCP)** integration for extensible tool use
- **Multi-tier sandbox** for secure code execution
- **JSONL streaming protocol** for universal IPC

### What Codex Can Do

- Generate code matching project structure and conventions
- Comprehend and explain complex/legacy codebases
- Perform code review (bugs, logic errors, edge cases)
- Debug and resolve issues with targeted fixes
- Automate repetitive tasks (refactoring, testing, migrations)

### Available Interfaces

- CLI (Command Line Interface)
- TUI (Terminal User Interface with Ratatui)
- IDE Extensions (VS Code, Cursor, Windsurf)
- TypeScript SDK (programmatic access)
- Web interface (Cloud-based)
- Desktop App

---

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                       USER INTERFACES                            │
├─────────────────┬──────────────┬──────────────┬─────────────────┤
│   CLI (Node.js) │  TUI (Rust)  │  IDE Plugin  │  TypeScript SDK │
└────────┬────────┴──────┬───────┴──────┬───────┴────────┬────────┘
         │               │              │                │
         └───────────────┴──────────────┴────────────────┘
                                │
                    ┌───────────▼──────────┐
                    │  Rust Core (codex-rs)│
                    │   Business Logic     │
                    └───────────┬──────────┘
                                │
         ┌──────────────────────┼──────────────────────┐
         │                      │                      │
    ┌────▼────┐          ┌─────▼─────┐         ┌─────▼─────┐
    │ OpenAI  │          │   MCP     │         │ Sandbox   │
    │   API   │          │  Servers  │         │  Runtime  │
    └─────────┘          └───────────┘         └───────────┘
```

### Repository Structure

```
openai/codex/
├── codex-rs/                    # Rust core (95.9% of codebase)
│   ├── core/                   # Business logic library
│   ├── protocol/               # Message protocol definitions
│   ├── cli/                    # CLI subcommands
│   ├── tui/                    # Full-screen terminal UI (66 files)
│   ├── exec/                   # Headless automation
│   ├── app-server/             # Application server
│   ├── backend-client/         # Backend API client
│   ├── mcp-server/             # Model Context Protocol server
│   ├── login/                  # Authentication
│   ├── linux-sandbox/          # Linux sandboxing (landlock, seccomp)
│   ├── windows-sandbox-rs/     # Windows sandboxing
│   ├── process-hardening/      # Security measures
│   ├── keyring-store/          # Credential storage
│   └── utils/                  # Shared utilities
│
├── codex-cli/                   # Node.js CLI wrapper (2.6%)
│   ├── bin/codex.js            # Platform-aware launcher
│   └── scripts/                # Build scripts
│
├── sdk/typescript/              # TypeScript SDK
│   ├── src/
│   │   ├── codex.ts            # Main client class
│   │   ├── thread.ts           # Conversation management
│   │   ├── exec.ts             # Process spawning
│   │   ├── events.ts           # Event types
│   │   └── index.ts            # Public exports
│   ├── tests/                  # Jest tests
│   └── samples/                # Example usage
│
├── shell-tool-mcp/              # Sandboxed shell execution MCP server
│   ├── src/                    # TypeScript implementation
│   └── patches/                # Runtime patches
│
├── docs/                        # Documentation
├── scripts/                     # Build utilities
├── BUILD.bazel                  # Bazel build configuration
└── .github/                     # CI/CD workflows
```

---

## Core Components

## 1. Rust Core (`codex-rs`) - The Brain

### **`core/` - Central Business Logic**

**Purpose:** Reusable library for embedding Codex in Rust applications

**Key Abstractions:**

#### Thread & Conversation Management
```rust
pub struct CodexThread {
    thread_id: ThreadId,
    messages: Vec<Message>,
    state: ThreadState,
    // ...
}

pub struct ThreadManager {
    threads: HashMap<ThreadId, CodexThread>,
    session_dir: PathBuf,  // ~/.codex/sessions/
}
```

- `CodexThread`: Manages multi-turn conversations with persistent context
- `ThreadManager`: Loads/saves threads, handles thread lifecycle
- Deprecated aliases: `CodexConversation`, `ConversationManager` (backward compatibility)

#### Model Client Infrastructure
```rust
pub trait ModelClient {
    async fn chat(&self, request: ChatRequest) -> ResponseStream;
}

pub enum ModelClientProvider {
    OpenAI,
    Ollama,     // Local model hosting
    LMStudio,   // Local model studio
}
```

- Abstract interface to LLM providers
- Streaming responses via `ResponseStream` and `ResponseEvent`
- Provider-agnostic design for model flexibility

#### Execution & Safety
```rust
pub enum ExecPolicy {
    ReadOnly,
    WorkspaceWrite { writable_roots: Vec<PathBuf> },
    DangerFullAccess,
}

fn is_dangerous_command(cmd: &str) -> bool;
fn is_safe_command(cmd: &str) -> bool;
```

**Three-tier security:**
1. **ReadOnly**: Safe exploration, no file modifications
2. **WorkspaceWrite**: Limited write access, protects `.git`, `.codex`, `.env`
3. **DangerFullAccess**: Unrestricted (requires explicit approval)

**Platform-specific sandboxing:**
- **Linux**: Landlock (path-based) + seccomp (syscall filtering)
- **Windows**: Job objects + restricted tokens
- **macOS**: App Sandbox framework

#### Configuration & State
```rust
pub struct AuthManager {
    keyring: KeyringStore,
    auth_state: CodexAuth,
}

pub struct Config {
    model: String,
    sandbox_mode: ExecPolicy,
    web_search_enabled: bool,
    // ...
}
```

- `AuthManager`: Credential handling (platform keyring integration)
- `Config`: User settings with TOML serialization
- `RolloutRecorder`: Session persistence with thread indexing
- State database (SQLite) for maintaining execution context

### **`protocol/` - Communication Protocol**

**Core Protocol Files:**
- `protocol.rs` - Main protocol definitions
- `models.rs` - Model type definitions
- `account.rs` - Account-related types
- `approvals.rs` - Approval workflow types
- `items.rs` - Item definitions (messages, tool calls, errors)
- `thread_id.rs` - Thread identifier types
- `message_history.rs` - Conversation history
- `config_types.rs` - Configuration structures
- `mcp.rs` - Model Context Protocol types
- `dynamic_tools.rs` - Dynamic tool definitions

**Communication Pattern: Submission Queue (SQ) / Event Queue (EQ)**

```rust
// Client → Agent (Submissions)
pub enum Op {
    UserInput {
        prompt: String,
        images: Vec<PathBuf>,
    },
    UserTurn {
        prompt: String,
        output_schema: Option<JsonSchema>,  // Structured output
    },
    ExecApproval {
        approved: bool,
        modified_command: Option<String>,
    },
    PatchApproval {
        approved: bool,
    },
    Interrupt,  // Abort current task
    Undo,
    GetHistory,
    ListSkills,
    AddMcpClient { config: McpClientConfig },
    RemoveMcpClient { client_id: String },
    // ...
}

// Agent → Client (Events)
pub enum Event {
    // Lifecycle
    TurnStarted,
    TurnComplete { usage: Usage },
    TurnFailed { error: ThreadError },

    // Content streaming
    AgentMessage { content: String },
    AgentMessageDelta { delta: String },
    ReasoningEvent { content: String },  // o1/o3 reasoning

    // Execution
    ExecCommandBegin { command: String, sandbox: ExecPolicy },
    ExecCommandEnd { success: bool, output: String },
    ToolCallBegin { tool: String, args: serde_json::Value },
    ToolCallEnd { result: serde_json::Value },

    // Interactive
    RequestExecApproval { command: String, reason: String },
    RequestPatchApproval { diff: String },
    RequestUserInput { prompt: String, schema: Option<JsonSchema> },

    // MCP
    McpElicitation { tool: String, prompt: String },

    // Collaboration (multi-agent)
    CollabEvent { event_type: CollabEventType },

    // Status
    Error { message: String },
    Warning { message: String },
}
```

**Sandbox Policies:**
```rust
pub enum ExecPolicy {
    ReadOnly,
    WorkspaceWrite {
        writable_roots: Vec<PathBuf>,
        // Always protected: .git, .codex, .agents, .env, secrets
    },
    DangerFullAccess,
}
```

**Token Usage Tracking:**
```rust
pub struct Usage {
    pub input_tokens: u64,
    pub cached_input_tokens: u64,      // Prompt caching savings
    pub output_tokens: u64,
    pub reasoning_output_tokens: u64,  // o1/o3 reasoning tokens

    // Calculated field
    pub context_window_remaining_pct: f64,  // Uses 12k baseline
}
```

**Session Persistence:**
```rust
pub struct SessionMetadata {
    pub thread_id: ThreadId,
    pub created_at: DateTime<Utc>,
    pub git_state: Option<GitState>,
    pub base_instructions: String,
    pub dynamic_tools: Vec<DynamicTool>,
}
```

### **`tui/` - Terminal User Interface**

**Implementation:** Ratatui-based full-screen terminal app (66 source files!)

**Key Modules:**
- `app.rs` - Main application state machine
- `chatwidget/` - Chat interface components
- `exec_cell/` - Command execution display
- `bottom_pane/` - Input and controls
- `notifications/` - Alert system
- `onboarding/` - First-run experience
- `status/` - Status indicators
- `streaming/` - Real-time updates
- `markdown_render.rs` - Rich text rendering
- `diff_render.rs` - Side-by-side diff display
- `session_log.rs` - Session recording/playback
- `external_editor.rs` - Vim/Emacs integration

### **`cli/` & `exec/` - Command-Line Interfaces**

**`cli/`**: Interactive CLI with subcommands
- `codex chat` - Start conversation
- `codex resume <id>` - Continue thread
- `codex history` - View past sessions
- `codex login` - Authenticate

**`exec/`**: Headless execution for automation
- Non-interactive mode
- JSON input/output
- CI/CD integration

### **`mcp-server/` - Model Context Protocol Server**

**Purpose:** Host MCP tools for agent use

**Capabilities:**
- Exposes tools via MCP protocol
- JSON-RPC 2.0 over stdio or HTTP+SSE
- Dynamic tool registration
- Sandbox state synchronization

**Protocol Spec:** [Model Context Protocol v1.24.0](https://modelcontextprotocol.io/specification/2025-11-25)

### **Supporting Infrastructure**

#### Authentication (`login/`)
- Clerk integration (via ChatGPT account)
- API key authentication
- Token refresh handling
- Credential storage via `keyring-store/`

#### Backend Client (`backend-client/`)
- OpenAI API client
- Streaming response handling
- Error retry logic
- Rate limiting

#### Network Proxy (`network-proxy/`)
- HTTP/HTTPS proxy support
- Corporate firewall traversal
- SSL certificate handling

#### Observability (`otel/`)
- OpenTelemetry integration
- Distributed tracing
- Performance metrics

---

## 2. Node.js CLI (`codex-cli`) - The Launcher

**Purpose:** Cross-platform launcher that wraps the Rust binary

### Architecture

```javascript
// bin/codex.js - Entry point

// 1. Platform Detection
const platform = process.platform;  // 'linux' | 'darwin' | 'win32'
const arch = process.arch;          // 'x64' | 'arm64'

const targetMap = {
  'linux-x64': 'x86_64-unknown-linux-musl',
  'linux-arm64': 'aarch64-unknown-linux-musl',
  'darwin-x64': 'x86_64-apple-darwin',
  'darwin-arm64': 'aarch64-apple-darwin',
  'win32-x64': 'x86_64-pc-windows-msvc',
  'win32-arm64': 'aarch64-pc-windows-msvc',
};

// 2. Binary Path Resolution
const binaryPath = path.join(
  __dirname,
  '../vendor',
  `${platform}-${arch}`,
  platform === 'win32' ? 'codex.exe' : 'codex'
);

// 3. Asynchronous Spawn (NOT sync!)
// Async allows Node.js to handle signals (Ctrl-C)
const child = spawn(binaryPath, process.argv.slice(2), {
  stdio: 'inherit',
  env: {
    ...process.env,
    CODEX_PACKAGE_MANAGER: detectPackageManager(),  // npm or bun
  },
});

// 4. Signal Forwarding
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => child.kill(signal));
}

// 5. Exit Code Mirroring
child.on('close', (code) => process.exit(code));
```

### Why Node.js Wrapper?

**Advantages:**
- ✅ **NPM distribution** - `npm install -g @openai/codex`
- ✅ **Automatic platform detection** - No manual binary selection
- ✅ **Signal handling** - Proper Ctrl-C behavior
- ✅ **Package manager detection** - Telemetry for usage patterns
- ✅ **Universal installation** - Works on all platforms

**Alternative Considered:** Pure shell script
- ❌ Platform detection is complex in POSIX shell
- ❌ Signal handling varies by shell
- ❌ Windows support requires separate .bat/.ps1

---

## 3. TypeScript SDK (`sdk/typescript`) - The Integration Layer

**Purpose:** Embed Codex agent in custom applications

### Public API

```typescript
// Installation
npm install @openai/codex-sdk

// Basic usage
import { Codex } from '@openai/codex-sdk';

const codex = new Codex({
  codexPathOverride: '/custom/path/to/codex',  // Optional
  env: { CODEX_API_KEY: 'sk-...' },            // Optional
  config: {                                     // Optional
    model: 'gpt-4o',
    sandboxMode: 'workspace-write',
  }
});

// Start new conversation
const thread = codex.startThread();

// Resume existing conversation
const thread = codex.resumeThread('abc123');
// Threads persist in ~/.codex/sessions/
```

### Core Classes

#### **`Codex` - Main Entry Point**

```typescript
export class Codex {
  private exec: CodexExec;
  private options: CodexOptions;

  constructor(options?: CodexOptions);

  startThread(): Thread;
  resumeThread(id: string): Thread;
}
```

**Responsibilities:**
- Manages `CodexExec` instance (process spawning)
- Provides thread lifecycle methods
- Shares configuration across threads

#### **`Thread` - Conversation Manager**

```typescript
export class Thread {
  private exec: CodexExec;
  private threadId: string | null;

  // Streaming execution (real-time events)
  async *runStreamed(
    input: Input,
    options?: TurnOptions
  ): AsyncGenerator<ThreadEvent> {
    for await (const event of this.exec.run({
      input: normalizeInput(input),
      threadId: this.threadId,
      ...options,
    })) {
      const parsed = JSON.parse(event);

      if (parsed.type === 'thread.started') {
        this.threadId = parsed.threadId;
      }

      yield parsed;
    }
  }

  // Blocking execution (wait for completion)
  async run(
    input: Input,
    options?: TurnOptions
  ): Promise<RunResult> {
    const items: Item[] = [];
    let responseText = '';
    let usage: Usage | undefined;

    for await (const event of this.runStreamed(input, options)) {
      if (event.type === 'item.completed') {
        items.push(event.item);
        if (event.item.type === 'agent_message') {
          responseText = event.item.content;
        }
      }
      if (event.type === 'turn.completed') {
        usage = event.usage;
      }
    }

    return { items, responseText, usage };
  }
}
```

**Input Types:**
```typescript
type Input =
  | string                           // Plain text
  | Array<{                          // Multimodal
      type: 'text' | 'image',
      text?: string,
      image?: string,  // File path
    }>;
```

**Thread Options:**
```typescript
interface TurnOptions {
  model?: string;                    // 'gpt-4o', 'o1', 'o3-mini'
  sandboxMode?: 'read-only' | 'workspace-write' | 'danger-full-access';
  approvalMode?: 'auto' | 'prompt' | 'reject';
  webSearchEnabled?: boolean;
  reasoningEffort?: 'low' | 'medium' | 'high';  // o1/o3 models
  outputSchema?: object;             // Zod schema for structured output
}
```

#### **`CodexExec` - Process Manager**

```typescript
export class CodexExec {
  private codexPath: string;
  private env?: Record<string, string>;
  private config?: Record<string, any>;

  constructor(options?: CodexOptions) {
    this.codexPath = options?.codexPathOverride || findCodexPath();
    this.env = options?.env;
    this.config = options?.config;
  }

  async *run(args: CodexExecArgs): AsyncGenerator<string> {
    // 1. Build command arguments
    const cmdArgs = [
      '--experimental-json',
      ...(args.threadId ? ['--thread-id', args.threadId] : []),
      ...(args.model ? ['--model', args.model] : []),
      ...(args.sandboxMode ? ['--sandbox', args.sandboxMode] : []),
      // ... other flags
    ];

    // 2. Build environment variables
    const env = {
      ...process.env,
      ...this.env,
      ...(this.config ? { CODEX_CONFIG: toToml(this.config) } : {}),
    };

    // 3. Spawn child process
    const child = spawn(this.codexPath, cmdArgs, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env,
    });

    // 4. Write input to stdin
    child.stdin.write(JSON.stringify({
      type: 'user_input',
      prompt: args.input,
      images: args.images || [],
    }));
    child.stdin.end();

    // 5. Stream JSONL output
    let stderrOutput = '';
    child.stderr.on('data', (chunk) => {
      stderrOutput += chunk.toString();
    });

    for await (const line of readline.createInterface({
      input: child.stdout,
      crlfDelay: Infinity,
    })) {
      yield line;  // One JSON event per line
    }

    // 6. Error handling
    const exitCode = await new Promise((resolve) => {
      child.on('close', resolve);
    });

    if (exitCode !== 0) {
      throw new Error(`Codex exited with code ${exitCode}: ${stderrOutput}`);
    }
  }
}
```

**Binary Discovery:**
```typescript
function findCodexPath(): string {
  const platform = process.platform;
  const arch = process.arch;

  // npm package structure:
  // node_modules/@openai/codex/
  //   vendor/
  //     linux-x64/codex
  //     darwin-arm64/codex
  //     win32-x64/codex.exe

  const binaryName = platform === 'win32' ? 'codex.exe' : 'codex';
  return path.join(
    __dirname,
    '../vendor',
    `${platform}-${arch}`,
    binaryName
  );
}
```

### Event Types

```typescript
// Lifecycle events
interface ThreadStartedEvent {
  type: 'thread.started';
  threadId: string;
}

interface TurnStartedEvent {
  type: 'turn.started';
}

interface TurnCompletedEvent {
  type: 'turn.completed';
  usage: Usage;
}

interface TurnFailedEvent {
  type: 'turn.failed';
  error: ThreadError;
}

// Item lifecycle
interface ItemStartedEvent {
  type: 'item.started';
  item: Partial<Item>;  // Usually in_progress status
}

interface ItemUpdatedEvent {
  type: 'item.updated';
  item: Partial<Item>;  // State changes during processing
}

interface ItemCompletedEvent {
  type: 'item.completed';
  item: Item;  // Complete item (success or failure)
}

// Item types
type Item =
  | AgentMessageItem
  | ReasoningItem
  | CommandExecutionItem
  | FileChangeItem
  | McpToolCallItem
  | WebSearchItem
  | TodoItem
  | ErrorItem;
```

### Usage Examples

**Streaming with Real-Time UI:**
```typescript
for await (const event of thread.runStreamed('Write a CSV parser')) {
  if (event.type === 'agent_message_delta') {
    process.stdout.write(event.delta);  // Type character-by-character
  }

  if (event.type === 'exec_command_begin') {
    console.log(`\nExecuting: ${event.command}`);
  }

  if (event.type === 'item.completed' && event.item.type === 'file_change') {
    console.log(`Modified: ${event.item.file_path}`);
  }
}
```

**Blocking with Simple Result:**
```typescript
const result = await thread.run('Write a CSV parser');
console.log(result.responseText);
console.log(`Tokens used: ${result.usage.input_tokens} in, ${result.usage.output_tokens} out`);
```

**Structured Output with Zod:**
```typescript
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

const schema = z.object({
  functions: z.array(z.object({
    name: z.string(),
    parameters: z.array(z.string()),
    returns: z.string(),
  })),
});

const result = await thread.run('Analyze this codebase', {
  outputSchema: zodToJsonSchema(schema),
});

const parsed = schema.parse(JSON.parse(result.responseText));
console.log(parsed.functions);
```

---

## 4. Shell Tool MCP (`shell-tool-mcp`) - Sandboxed Execution

**Purpose:** MCP server that provides sandboxed shell command execution

### Implementation

**Package:** `@openai/codex-shell-tool-mcp`

**Core Concept:** Intercepts system calls to control which processes can execute

### Decision States

```typescript
enum ProcessDecision {
  Allow = 'allow',       // Auto-approve (safe commands)
  Prompt = 'prompt',     // Ask user for approval
  Forbidden = 'forbidden' // Block dangerous operations
}
```

**Configuration:**
```json
{
  "rules": [
    {
      "process": "/bin/ls",
      "decision": "allow"
    },
    {
      "process": "/bin/rm",
      "args_pattern": ".*-rf.*",
      "decision": "forbidden"
    },
    {
      "process": "/usr/bin/curl",
      "decision": "prompt",
      "reason": "Network access requires approval"
    }
  ]
}
```

### Architecture

```typescript
class ShellToolMCP {
  private sandbox: BashSandbox;
  private rules: ProcessRule[];

  async executeTool(name: string, args: any): Promise<ToolResult> {
    if (name === 'shell') {
      const decision = this.evaluateCommand(args.command);

      if (decision === 'forbidden') {
        return { error: 'Command blocked by policy' };
      }

      if (decision === 'prompt') {
        const approved = await this.requestApproval(args.command);
        if (!approved) {
          return { error: 'User denied execution' };
        }
      }

      return await this.sandbox.execute(args.command);
    }
  }
}
```

---

## Data Flow Architecture

### End-to-End Request Flow

```
┌──────────────────────────────────────────────────────────────────┐
│ 1. USER INPUT                                                     │
│    "Write a Python script to parse CSV files"                    │
└──────────────────┬───────────────────────────────────────────────┘
                   │
┌──────────────────▼───────────────────────────────────────────────┐
│ 2. TYPESCRIPT SDK (Thread.runStreamed)                           │
│    • Normalize input (text + images)                             │
│    • Build CodexExecArgs:                                         │
│      {                                                            │
│        input: "Write a Python script...",                         │
│        threadId: "abc123",                                        │
│        model: "gpt-4o",                                           │
│        sandboxMode: "workspace-write"                             │
│      }                                                            │
│    • Pass to CodexExec.run()                                      │
└──────────────────┬───────────────────────────────────────────────┘
                   │
┌──────────────────▼───────────────────────────────────────────────┐
│ 3. NODE.JS CLI (bin/codex.js)                                    │
│    • Spawn Rust binary: codex --experimental-json                │
│    • stdin: JSON submission                                       │
│      {                                                            │
│        "type": "user_turn",                                       │
│        "prompt": "Write a Python script...",                      │
│        "images": []                                               │
│      }                                                            │
│    • stdout: JSONL event stream (one event per line)             │
└──────────────────┬───────────────────────────────────────────────┘
                   │
┌──────────────────▼───────────────────────────────────────────────┐
│ 4. RUST CORE (ThreadManager)                                     │
│    • Deserialize Op::UserTurn from stdin                         │
│    • Load/create CodexThread from ~/.codex/sessions/             │
│    • Prepare context:                                             │
│      - System prompt                                              │
│      - Git context (branch, uncommitted changes)                 │
│      - Conversation history                                       │
│      - Available tools (MCP + built-in)                           │
│    • Invoke ModelClient.chat()                                    │
└──────────────────┬───────────────────────────────────────────────┘
                   │
┌──────────────────▼───────────────────────────────────────────────┐
│ 5. MODEL CLIENT (Backend API)                                    │
│    • Build OpenAI API request:                                    │
│      POST https://api.openai.com/v1/chat/completions              │
│      {                                                            │
│        "model": "gpt-4o",                                         │
│        "messages": [                                              │
│          {"role": "system", "content": "You are Codex..."},       │
│          {"role": "user", "content": "Write a Python script..."}  │
│        ],                                                         │
│        "tools": [...],                                            │
│        "stream": true                                             │
│      }                                                            │
│    • Stream response chunks                                       │
└──────────────────┬───────────────────────────────────────────────┘
                   │
┌──────────────────▼───────────────────────────────────────────────┐
│ 6. AGENT LOOP (Tool Use Cycle)                                   │
│                                                                    │
│ ┌────────────────────────────────────────────────────────────┐  │
│ │ Model: "I'll write a Python script for parsing CSV..."     │  │
│ │ → Emit Event::AgentMessage                                  │  │
│ │ → Emit Event::AgentMessageDelta (streaming)                 │  │
│ └────────────────────────────────────────────────────────────┘  │
│                          │                                        │
│ ┌────────────────────────▼────────────────────────────────────┐ │
│ │ Model calls tool: write_file("parse_csv.py", code)          │ │
│ │ → Emit Event::ToolCallBegin                                  │ │
│ │ → Check ExecPolicy & Sandbox                                 │ │
│ │ → If dangerous: Emit Event::RequestExecApproval              │ │
│ │   ← Wait for Op::ExecApproval submission                     │ │
│ │ → Execute tool if approved                                   │ │
│ │ → Emit Event::ToolCallEnd (success/failure)                  │ │
│ └────────────────────────┬────────────────────────────────────┘ │
│                          │                                        │
│ ┌────────────────────────▼────────────────────────────────────┐ │
│ │ Model: "I've created parse_csv.py. Would you like me to...?"│ │
│ │ → Emit Event::AgentMessage                                   │ │
│ │ → Emit Event::TurnComplete { usage: {...} }                  │ │
│ └──────────────────────────────────────────────────────────────┘ │
└───────────────────────────┬────────────────────────────────────────┘
                            │
┌───────────────────────────▼────────────────────────────────────┐
│ 7. STREAM EVENTS BACK                                           │
│    Rust Core → JSONL stdout → Node CLI → TypeScript SDK        │
│                                                                  │
│    Example event sequence:                                      │
│    {"type":"thread.started","threadId":"abc123"}                │
│    {"type":"turn.started"}                                      │
│    {"type":"item.started","item":{"type":"agent_message"}}      │
│    {"type":"agent_message_delta","delta":"I'll write"}          │
│    {"type":"agent_message_delta","delta":" a Python"}           │
│    {"type":"agent_message_delta","delta":" script..."}          │
│    {"type":"item.completed","item":{...}}                       │
│    {"type":"item.started","item":{"type":"tool_call"}}          │
│    {"type":"tool_call_begin","tool":"write_file"}               │
│    {"type":"tool_call_end","result":{...}}                      │
│    {"type":"item.completed","item":{...}}                       │
│    {"type":"turn.completed","usage":{"input_tokens":150,...}}   │
└───────────────────────────┬────────────────────────────────────┘
                            │
┌───────────────────────────▼────────────────────────────────────┐
│ 8. SDK CONSUMER (Your Application)                              │
│                                                                  │
│    for await (const event of thread.runStreamed(input)) {      │
│      switch (event.type) {                                      │
│        case 'agent_message_delta':                              │
│          updateUI(event.delta);                                 │
│          break;                                                 │
│        case 'tool_call_begin':                                  │
│          showToolExecution(event.tool);                         │
│          break;                                                 │
│        case 'item.completed':                                   │
│          if (event.item.type === 'file_change') {               │
│            refreshFileTree(event.item.file_path);               │
│          }                                                       │
│          break;                                                 │
│        case 'turn.completed':                                   │
│          showUsageStats(event.usage);                           │
│          break;                                                 │
│      }                                                           │
│    }                                                             │
└──────────────────────────────────────────────────────────────────┘
```

### Protocol Wire Format (JSONL)

**Submission (stdin to Rust binary):**
```json
{"type":"user_turn","prompt":"Write a CSV parser","images":[],"thread_id":"abc123"}
```

**Events (stdout from Rust binary):**
```json
{"type":"thread.started","threadId":"abc123"}
{"type":"turn.started"}
{"type":"item.started","item":{"id":"msg-1","type":"agent_message","status":"in_progress"}}
{"type":"agent_message_delta","delta":"I'll"}
{"type":"agent_message_delta","delta":" write"}
{"type":"agent_message_delta","delta":" that"}
{"type":"item.completed","item":{"id":"msg-1","type":"agent_message","content":"I'll write that","status":"completed"}}
{"type":"item.started","item":{"id":"tool-1","type":"tool_call","tool":"write_file","status":"in_progress"}}
{"type":"tool_call_begin","tool":"write_file","args":{"path":"parser.py","content":"..."}}
{"type":"request_exec_approval","command":"write_file parser.py","reason":"Writing new file"}
```

**Approval Response (stdin to Rust binary):**
```json
{"type":"exec_approval","approved":true}
```

**Continued Events:**
```json
{"type":"exec_command_begin","command":"write_file parser.py"}
{"type":"exec_command_end","success":true,"output":"File written successfully"}
{"type":"tool_call_end","result":{"success":true}}
{"type":"item.completed","item":{"id":"tool-1","type":"tool_call","status":"completed"}}
{"type":"turn.completed","usage":{"input_tokens":120,"output_tokens":450,"cached_input_tokens":0}}
```

---

## Key Architectural Decisions

### 1. Rust Core + Multi-Language Frontends

**Decision:** Implement business logic in Rust, expose via multiple interfaces

**Rationale:**

| Requirement | Why Rust? |
|-------------|-----------|
| **Performance** | Parsing large codebases requires speed; Rust's zero-cost abstractions deliver |
| **Memory Safety** | Long-running agents can't crash; Rust prevents memory leaks and use-after-free |
| **Sandboxing** | Low-level OS integration (seccomp, landlock) requires systems language |
| **Cross-platform** | Single codebase compiles to all platforms (Linux, macOS, Windows; x64, ARM64) |
| **Embeddability** | Compiles to native binary; no runtime dependencies (unlike Python/Node.js) |
| **Concurrency** | Tokio async runtime for efficient I/O and concurrent tool execution |

**Why Not Pure Node.js/Python?**
- ❌ Performance: 10-100x slower for parsing/analysis
- ❌ Sandboxing: Can't enforce seccomp filters without native bindings
- ❌ Distribution: Requires runtime installation
- ❌ Memory: Garbage collection pauses unacceptable for real-time streaming

**Multi-Language Frontends:**
- TypeScript SDK → JavaScript/Node.js ecosystem
- CLI → npm distribution, Homebrew, direct binary
- IDE extensions → Language-agnostic binary invocation

### 2. JSONL Event Streaming Protocol

**Decision:** Use newline-delimited JSON over stdout for IPC

**Alternatives Considered:**

| Approach | Pros | Cons | Decision |
|----------|------|------|----------|
| **gRPC** | Type-safe, fast, bidirectional | Requires network stack, complex setup | ❌ Overkill |
| **HTTP API** | Standard, tooling support | Requires server, port management | ❌ Too heavy |
| **Binary Protocol (MessagePack)** | Compact, fast | Not human-readable, debugging hard | ❌ Poor DX |
| **JSONL over stdio** | Simple, universal, debuggable | Slightly larger payloads | ✅ **Chosen** |

**JSONL Advantages:**
- ✅ **Universal**: Every language can spawn processes + read stdout
- ✅ **Streaming**: Natural async event flow (one event = one line)
- ✅ **Debuggable**: Human-readable with `tail -f` or `cat`
- ✅ **Portable**: Works in restricted environments (no network required)
- ✅ **Simple**: No serialization library required (just `JSON.parse`)
- ✅ **Backpressure**: stdout buffering provides natural flow control

**Format Example:**
```bash
# Terminal 1: Run codex with debug output
codex --experimental-json 2>&1 | tee /tmp/codex.log

# Terminal 2: Watch events in real-time
tail -f /tmp/codex.log | jq -r '.type + ": " + (.delta // .message // "")'

# Output:
# thread.started:
# turn.started:
# agent_message_delta: I'll
# agent_message_delta:  help
# agent_message_delta:  you
# tool_call_begin: write_file
# tool_call_end:
```

### 3. Model Context Protocol (MCP) Integration

**Decision:** Adopt MCP for tool extensibility instead of custom tool protocol

**Why MCP?**

**Industry Standard:**
- Specification: https://modelcontextprotocol.io/specification/2025-11-25
- Donated to [Linux Foundation's Agentic AI Foundation](https://en.wikipedia.org/wiki/Model_Context_Protocol) (Dec 2025)
- Co-founded by Anthropic, Block, OpenAI
- 97M+ monthly SDK downloads (Dec 2025)

**Ecosystem Benefits:**
- ✅ **Interoperability**: Works with Claude, GPT, Gemini, LLaMA
- ✅ **Tool Sharing**: Use community tools without custom integration
- ✅ **Standard Protocol**: JSON-RPC 2.0 over stdio or HTTP+SSE
- ✅ **Built-in Sandboxing**: Shell tool MCP provides safe execution
- ✅ **Dynamic Loading**: Add/remove tools at runtime

**Architecture:**
```
┌─────────────────────────────────────────────────────────────┐
│                     Codex Agent                              │
├─────────────────────────────────────────────────────────────┤
│  Built-in Tools          │  MCP Servers                     │
│  • write_file            │  • @openai/codex-shell-tool-mcp  │
│  • read_file             │  • @modelcontextprotocol/server-*│
│  • list_files            │  • Community MCP servers         │
│  • apply_diff            │                                  │
└───────────────────┬─────────────────────┬───────────────────┘
                    │                     │
                    │                     │ JSON-RPC 2.0
                    │                     ↓
                    │          ┌─────────────────────┐
                    │          │  MCP Server         │
                    │          │  (stdio or HTTP)    │
                    │          ├─────────────────────┤
                    │          │ • Initialize        │
                    │          │ • List tools        │
                    │          │ • Execute tool      │
                    │          │ • Stream results    │
                    │          └─────────────────────┘
                    │                     │
                    ↓                     ↓
              File System          Sandboxed Execution
```

**Example MCP Tool Definition:**
```json
{
  "name": "shell",
  "description": "Execute shell command in sandboxed Bash",
  "inputSchema": {
    "type": "object",
    "properties": {
      "command": {
        "type": "string",
        "description": "Shell command to execute"
      }
    },
    "required": ["command"]
  }
}
```

**Dynamic Tool Loading:**
```rust
// Add MCP client at runtime
Op::AddMcpClient {
    config: McpClientConfig {
        command: "node",
        args: vec!["/path/to/mcp-server.js"],
        env: HashMap::new(),
    }
}

// Agent can now use tools from this server
// Model: "I'll use the shell tool to list files"
// → Calls shell("ls -la")
```

### 4. Three-Tier Sandbox Model

**Decision:** Progressive security policies instead of binary safe/unsafe

**Sandbox Levels:**

#### **ReadOnly** (Safest)
```rust
ExecPolicy::ReadOnly
```
- ✅ File reads
- ✅ Directory listing
- ✅ Git operations (status, log, diff)
- ❌ File writes
- ❌ File deletions
- ❌ Process execution

**Use Cases:** Code review, exploration, analysis

#### **WorkspaceWrite** (Balanced)
```rust
ExecPolicy::WorkspaceWrite {
    writable_roots: vec![
        PathBuf::from("/workspace/src"),
        PathBuf::from("/workspace/tests"),
    ]
}
```
- ✅ Write to specified roots
- ✅ Create/modify files
- ✅ Run tests
- ❌ Write to `.git/`, `.codex/`, `.env`
- ❌ Modify system files
- ❌ Network access (without approval)

**Protected Paths (Always):**
- `.git/` - Version control integrity
- `.codex/` - Agent state/config
- `.agents/` - Agent definitions
- `.env`, `.env.local` - Secrets
- `~/.ssh/`, `~/.aws/` - Credentials

**Use Cases:** Active development, refactoring, testing

#### **DangerFullAccess** (Requires Approval)
```rust
ExecPolicy::DangerFullAccess
```
- ✅ Unrestricted file access
- ✅ System commands
- ✅ Network access
- ✅ Package installation
- ⚠️ Requires explicit user approval for each command

**Use Cases:** Setup tasks, system administration, deployment

**Platform-Specific Enforcement:**

| Platform | Technology | Capabilities |
|----------|-----------|--------------|
| **Linux** | Landlock + seccomp | Path-based restrictions + syscall filtering |
| **macOS** | App Sandbox | Profile-based access control |
| **Windows** | Job Objects + Tokens | Process isolation + restricted privileges |

**Example: Landlock (Linux)**
```rust
use landlock::{Access, AccessFs, Ruleset, RulesetAttr};

fn configure_landlock(policy: &ExecPolicy) -> Result<()> {
    let mut ruleset = Ruleset::new()
        .handle_access(AccessFs::ReadFile)?
        .handle_access(AccessFs::ReadDir)?;

    match policy {
        ExecPolicy::ReadOnly => {
            // No write access granted
        }
        ExecPolicy::WorkspaceWrite { writable_roots } => {
            for root in writable_roots {
                ruleset = ruleset.add_rule(
                    Access::from_file(root)?
                        .allow(AccessFs::WriteFile)
                        .allow(AccessFs::MakeDir)
                )?;
            }
        }
        ExecPolicy::DangerFullAccess => {
            // Full filesystem access
            return Ok(()); // Skip landlock
        }
    }

    ruleset.restrict_self()?;
    Ok(())
}
```

### 5. Session Persistence

**Decision:** Store thread state in `~/.codex/sessions/` with SQLite indexing

**Directory Structure:**
```
~/.codex/
├── sessions/
│   ├── abc123-2026-02-09T10-30-00.json    # Thread state
│   ├── def456-2026-02-09T11-15-00.json
│   └── ghi789-2026-02-09T14-45-00.json
├── state.db                                # SQLite index
├── config.toml                             # User settings
└── keyring/                                # Encrypted credentials
    └── tokens.enc
```

**Thread State Format:**
```json
{
  "thread_id": "abc123",
  "created_at": "2026-02-09T10:30:00Z",
  "last_updated": "2026-02-09T10:35:00Z",
  "messages": [
    {
      "role": "user",
      "content": "Write a CSV parser"
    },
    {
      "role": "assistant",
      "content": "I'll write a Python script...",
      "tool_calls": [
        {
          "tool": "write_file",
          "args": {"path": "parser.py", "content": "..."},
          "result": {"success": true}
        }
      ]
    }
  ],
  "git_context": {
    "branch": "feature/csv-parser",
    "uncommitted_changes": "M requirements.txt",
    "last_commit": "abc123d - Add CSV parsing"
  },
  "metadata": {
    "total_tokens": 1250,
    "files_modified": ["parser.py", "requirements.txt"],
    "commands_executed": ["write_file", "run_tests"]
  }
}
```

**SQLite Index:**
```sql
CREATE TABLE threads (
    thread_id TEXT PRIMARY KEY,
    created_at TIMESTAMP,
    last_updated TIMESTAMP,
    file_path TEXT,
    git_branch TEXT,
    total_tokens INTEGER,
    message_count INTEGER
);

CREATE INDEX idx_last_updated ON threads(last_updated DESC);
CREATE INDEX idx_git_branch ON threads(git_branch);
```

**Benefits:**
- ✅ **Resume Anywhere**: Start in CLI, continue in TUI, finish in IDE
- ✅ **Crash Recovery**: Restore state after unexpected termination
- ✅ **Audit Trail**: Complete history of agent actions
- ✅ **Experimentation**: Fork threads to try different approaches
- ✅ **Collaboration**: Share thread IDs with team members

**Thread Lifecycle:**
```rust
// Create new thread
let thread = thread_manager.create_thread()?;

// Save after each turn
thread_manager.save_thread(&thread)?;

// Resume later
let thread = thread_manager.load_thread("abc123")?;

// Fork for experimentation
let new_thread = thread_manager.fork_thread("abc123")?;
```

---

## Dependency Chain Analysis

### Rust Core Dependencies

```
codex-core (Cargo workspace)
│
├── Async Runtime & Concurrency
│   ├── tokio@1.x (multi-threaded async runtime)
│   │   ├── tokio-macros (async/await macros)
│   │   ├── mio (low-level I/O primitives)
│   │   └── libc (POSIX syscalls)
│   ├── async-trait@0.1 (trait async methods)
│   ├── async-channel@2.x (MPMC channels)
│   └── futures@0.3 (async abstractions)
│
├── Serialization & Configuration
│   ├── serde@1.x (serialization framework)
│   │   ├── serde_json (JSON support)
│   │   ├── serde_yaml (YAML config files)
│   │   ├── toml@0.8 (TOML config files)
│   │   └── serde_path_to_error (error context)
│   └── schemars@0.8 (JSON schema generation)
│
├── HTTP & WebSocket
│   ├── reqwest@0.11 (HTTP client)
│   │   ├── hyper (HTTP implementation)
│   │   ├── tokio-rustls (TLS support)
│   │   └── mime (MIME type handling)
│   └── tungstenite@0.20 (WebSocket client)
│
├── Parsing & Analysis
│   ├── tree-sitter@0.20 (syntax parsing)
│   │   └── tree-sitter-bash (Bash grammar)
│   ├── regex@1.x (pattern matching)
│   └── similar@2.x (diff computation)
│
├── Cryptography & Security
│   ├── sha1@0.10 (SHA-1 hashing)
│   ├── sha2@0.10 (SHA-256 hashing)
│   ├── base64@0.21 (encoding)
│   └── chardet (character encoding detection)
│
├── Platform Integration
│   ├── os_info@3.x (OS detection)
│   ├── libc@0.2 (C library bindings)
│   └── Platform-specific:
│       ├── [Linux] landlock@0.3 (filesystem sandboxing)
│       ├── [Linux] seccomp@0.1 (syscall filtering)
│       ├── [macOS] core-foundation@0.9
│       └── [Windows] windows@0.48 (Win32 APIs)
│
├── Data Structures & Compression
│   ├── zip@0.6 (ZIP compression)
│   ├── image@0.24 (image processing, dev only)
│   └── uuid@1.x (unique identifiers)
│
├── Terminal UI (TUI only)
│   ├── ratatui@0.24 (terminal UI framework)
│   │   ├── crossterm (terminal backend)
│   │   └── unicode-width (text rendering)
│   └── syntect@5.x (syntax highlighting)
│
├── Internal Workspace Crates
│   ├── codex-protocol (message definitions)
│   ├── codex-api (API types)
│   ├── backend-client (OpenAI client)
│   ├── git-ops (Git operations)
│   ├── file-search (codebase indexing)
│   ├── state-db (SQLite state management)
│   ├── network-proxy (HTTP proxy support)
│   ├── keyring-store (credential storage)
│   │   ├── [Linux] secret-service
│   │   ├── [macOS] security-framework
│   │   └── [Windows] wincred
│   ├── linux-sandbox (Linux sandboxing)
│   ├── windows-sandbox-rs (Windows sandboxing)
│   └── utils, async-utils, ansi-escape (utilities)
│
└── MCP Integration
    └── @modelcontextprotocol/sdk (Rust bindings)
```

### TypeScript SDK Dependencies

```
@openai/codex-sdk
│
├── Runtime (Node.js built-ins, no install required)
│   ├── child_process (spawn Rust binary)
│   ├── fs (file operations)
│   ├── path (path manipulation)
│   ├── readline (JSONL parsing)
│   └── stream (async iteration)
│
├── Schema Validation
│   ├── zod@3.x (runtime type validation)
│   └── zod-to-json-schema@3.x (Zod → JSON Schema)
│
├── MCP Client
│   └── @modelcontextprotocol/sdk@1.24.0
│
└── Development Dependencies
    ├── typescript@5.x (compiler)
    ├── tsup@8.x (bundler)
    ├── jest@29.x (testing)
    │   └── ts-jest@29.x (TypeScript support)
    ├── eslint@8.x (linting)
    │   ├── @typescript-eslint/parser
    │   └── eslint-plugin-jest
    └── prettier@3.x (formatting)
```

### Build System Dependencies

```
Bazel
│
├── rules_rust (Rust toolchain)
│   ├── Cargo build integration
│   ├── rustc 1.75+ (compiler)
│   └── Platform constraints:
│       ├── @platforms//os:linux + @platforms//cpu:x86_64
│       ├── @platforms//os:linux + @platforms//cpu:aarch64
│       ├── @platforms//os:osx + @platforms//cpu:x86_64
│       ├── @platforms//os:osx + @platforms//cpu:aarch64
│       ├── @platforms//os:windows + @platforms//cpu:x86_64
│       └── @platforms//os:windows + @platforms//cpu:aarch64
│
├── rules_ts (TypeScript toolchain)
│   ├── Node.js 18+ (runtime)
│   └── pnpm@10.x (package manager)
│
└── Platform-Specific
    ├── [Linux] glibc-2.31+ (NOT musl due to proc macro dlopen)
    ├── [Windows] MSVC 2022 + Windows SDK
    └── [macOS] Xcode disabled (uses system toolchain)
```

### Dependency Version Strategy

**Rust:**
- **Stable channel**: Rust 1.75+
- **Conservative updates**: Tokio, serde, reqwest pinned to minor versions
- **Workspace dependencies**: Centralized version management

**TypeScript:**
- **Modern Node.js**: 18+ (for native fetch, async iterators)
- **Zod validation**: Runtime safety for dynamic inputs
- **Minimal runtime deps**: Avoid bloat for fast installs

**Security:**
- **Dependabot**: Automated security updates
- **cargo-audit**: Vulnerability scanning
- **npm audit**: Package vulnerability checks

---

## Implementation Highlights

### 1. Async Event Generator Pattern

**Problem:** How to stream events from Rust binary to TypeScript client with backpressure?

**Solution:** Async generators with line-by-line JSONL parsing

```typescript
async *runStreamed(input: Input): AsyncGenerator<ThreadEvent> {
  // 1. Spawn Rust binary
  const child = spawn(codexBinary, args, {
    stdio: ['pipe', 'pipe', 'pipe']
  });

  // 2. Write input to stdin
  child.stdin.write(JSON.stringify({ type: 'user_turn', prompt: input }));
  child.stdin.end();

  // 3. Create readline interface for line-by-line parsing
  const rl = readline.createInterface({
    input: child.stdout,
    crlfDelay: Infinity  // Treat \r\n as single newline
  });

  // 4. Parse and yield events
  for await (const line of rl) {
    try {
      const event = JSON.parse(line);

      // Update internal state
      if (event.type === 'thread.started') {
        this.threadId = event.threadId;
      }

      // Yield to consumer
      yield event;

      // Consumer can pause here! (backpressure)
    } catch (err) {
      console.error('Failed to parse event:', line, err);
    }
  }

  // 5. Wait for process exit
  const exitCode = await new Promise<number>((resolve) => {
    child.on('close', resolve);
  });

  if (exitCode !== 0) {
    throw new Error(`Codex exited with code ${exitCode}`);
  }
}
```

**Benefits:**
- ✅ **Backpressure-aware**: If consumer is slow, Node.js pauses reading stdout
- ✅ **Memory-efficient**: No buffering entire response in memory
- ✅ **Clean error handling**: try/catch per event + finally cleanup
- ✅ **Type-safe**: TypeScript knows each event type

**Consumer Example:**
```typescript
// Fast consumer
for await (const event of thread.runStreamed(input)) {
  console.log(event.type);
}

// Slow consumer (simulates UI rendering)
for await (const event of thread.runStreamed(input)) {
  await new Promise(resolve => setTimeout(resolve, 100));  // 100ms delay
  updateUI(event);
  // Rust binary pauses when stdout buffer fills!
}
```

### 2. Two-Way Approval Flow

**Problem:** How to request user approval mid-execution?

**Solution:** Bidirectional communication via stdin/stdout

```
┌─────────────────────────────────────────────────────────────┐
│ Agent Execution Flow with Approval                          │
└─────────────────────────────────────────────────────────────┘

1. Agent: "I'll run: rm /tmp/cache/*"
   │
   ├─> Emit Event::RequestExecApproval
   │   {
   │     "type": "request_exec_approval",
   │     "command": "rm /tmp/cache/*",
   │     "reason": "Cleaning temporary files"
   │   }
   │
2. TypeScript SDK receives event
   │
   ├─> Consumer decides (prompt user, check policy, etc.)
   │
3. Consumer sends approval
   │
   ├─> stdin: Op::ExecApproval
   │   {
   │     "type": "exec_approval",
   │     "approved": true,
   │     "modified_command": null
   │   }
   │
4. Agent receives approval
   │
   ├─> Execute command in sandbox
   │
5. Agent: Executes and reports result
   │
   └─> Emit Event::ExecCommandEnd
       {
         "type": "exec_command_end",
         "success": true,
         "output": "Removed 42 files"
       }
```

**Rust Implementation:**
```rust
async fn execute_tool(&mut self, tool_call: ToolCall) -> Result<ToolResult> {
    // Check if command is dangerous
    if self.is_dangerous_command(&tool_call.command) {
        // Request approval
        self.emit_event(Event::RequestExecApproval {
            command: tool_call.command.clone(),
            reason: "Potentially destructive operation".to_string(),
        }).await?;

        // Wait for approval
        let approval = self.wait_for_submission().await?;

        match approval {
            Op::ExecApproval { approved: false, .. } => {
                return Ok(ToolResult::Error("User denied execution".to_string()));
            }
            Op::ExecApproval { approved: true, modified_command } => {
                let cmd = modified_command.unwrap_or(tool_call.command);
                self.sandbox.execute(&cmd).await
            }
            _ => {
                return Err(anyhow!("Expected ExecApproval, got {:?}", approval));
            }
        }
    } else {
        // Safe command, execute immediately
        self.sandbox.execute(&tool_call.command).await
    }
}
```

**TypeScript Consumer Example:**
```typescript
async function runWithApprovals(thread: Thread, input: string) {
  for await (const event of thread.runStreamed(input)) {
    if (event.type === 'request_exec_approval') {
      const approved = await askUser(
        `Allow command: ${event.command}?\nReason: ${event.reason}`
      );

      // Send approval back via stdin
      await thread.sendApproval(approved);
    }

    // Handle other events...
  }
}
```

### 3. Token Usage Tracking

**Problem:** How to track LLM costs and context window usage?

**Solution:** Granular token accounting with cached input tracking

```rust
pub struct Usage {
    pub input_tokens: u64,
    pub cached_input_tokens: u64,  // Prompt caching savings
    pub output_tokens: u64,
    pub reasoning_output_tokens: u64,  // o1/o3 reasoning
}

impl Usage {
    /// Calculate remaining context window percentage
    pub fn context_window_remaining_pct(&self, model: &str) -> f64 {
        let max_tokens = match model {
            "gpt-4o" => 128_000,
            "o1" => 200_000,
            "o3-mini" => 200_000,
            _ => 128_000,
        };

        let fixed_overhead = 12_000;  // System prompt, tool definitions
        let used = self.input_tokens + fixed_overhead;
        let remaining = max_tokens.saturating_sub(used);

        (remaining as f64 / max_tokens as f64) * 100.0
    }

    /// Calculate cost (approximate)
    pub fn estimated_cost_usd(&self, model: &str) -> f64 {
        let (input_cost, output_cost) = match model {
            "gpt-4o" => (5.0, 15.0),        // per 1M tokens
            "o1" => (15.0, 60.0),
            "o3-mini" => (1.1, 4.4),
            _ => (5.0, 15.0),
        };

        let input_cost = (self.input_tokens as f64 / 1_000_000.0) * input_cost;
        let output_cost = (self.output_tokens as f64 / 1_000_000.0) * output_cost;
        let reasoning_cost = (self.reasoning_output_tokens as f64 / 1_000_000.0) * output_cost;

        input_cost + output_cost + reasoning_cost
    }
}
```

**Event with Usage:**
```json
{
  "type": "turn.completed",
  "usage": {
    "input_tokens": 1250,
    "cached_input_tokens": 800,
    "output_tokens": 450,
    "reasoning_output_tokens": 0,
    "context_window_remaining_pct": 85.2,
    "estimated_cost_usd": 0.0123
  }
}
```

**Consumer Dashboard:**
```typescript
let totalCost = 0;
let totalInputTokens = 0;
let totalOutputTokens = 0;
let cachedTokenSavings = 0;

for await (const event of thread.runStreamed(input)) {
  if (event.type === 'turn.completed') {
    totalCost += event.usage.estimated_cost_usd;
    totalInputTokens += event.usage.input_tokens;
    totalOutputTokens += event.usage.output_tokens;
    cachedTokenSavings += event.usage.cached_input_tokens;

    console.log(`Total cost: $${totalCost.toFixed(4)}`);
    console.log(`Cached savings: ${cachedTokenSavings} tokens`);
  }
}
```

### 4. Git Context Integration

**Problem:** How to give agent awareness of version control state?

**Solution:** Inject git context into system prompt

```rust
pub struct GitContext {
    pub current_branch: String,
    pub uncommitted_changes: Vec<String>,
    pub recent_commits: Vec<GitCommit>,
    pub remote_tracking: Option<String>,
}

impl GitContext {
    pub async fn from_cwd() -> Result<Self> {
        let current_branch = Command::new("git")
            .args(["branch", "--show-current"])
            .output()
            .await?
            .stdout;

        let uncommitted = Command::new("git")
            .args(["status", "--porcelain"])
            .output()
            .await?
            .stdout;

        let recent_commits = Command::new("git")
            .args(["log", "--oneline", "-5"])
            .output()
            .await?
            .stdout;

        Ok(Self {
            current_branch: String::from_utf8(current_branch)?.trim().to_string(),
            uncommitted_changes: String::from_utf8(uncommitted)?
                .lines()
                .map(|s| s.to_string())
                .collect(),
            recent_commits: parse_commits(&recent_commits)?,
            remote_tracking: get_remote_tracking().await.ok(),
        })
    }
}
```

**System Prompt Enhancement:**
```rust
fn build_system_prompt(&self, git_context: &GitContext) -> String {
    format!(
        r#"You are Codex, an AI coding assistant.

Current Git Context:
- Branch: {branch}
- Uncommitted changes:
{changes}
- Recent commits:
{commits}

When making changes:
1. Consider the current branch name and context
2. Avoid modifying files with uncommitted changes unless necessary
3. Create commits with clear, conventional commit messages
4. Respect the project's branching strategy
"#,
        branch = git_context.current_branch,
        changes = git_context.uncommitted_changes.join("\n  "),
        commits = git_context.recent_commits
            .iter()
            .map(|c| format!("  {} - {}", c.hash, c.message))
            .collect::<Vec<_>>()
            .join("\n"),
    )
}
```

**Benefits:**
- ✅ Agent knows what branch it's on (avoid accidental main commits)
- ✅ Agent sees uncommitted changes (avoid conflicts)
- ✅ Agent learns project conventions from recent commits
- ✅ Agent can create contextually appropriate commits

---

## Security Architecture

### Defense in Depth Strategy

```
┌─────────────────────────────────────────────────────────────┐
│ Layer 1: Command Classification                             │
│ • Static analysis of command strings                         │
│ • Pattern matching for dangerous operations                  │
│ • Allowlist of safe commands                                 │
└──────────────────────┬──────────────────────────────────────┘
                       │ Command allowed by classification
                       ↓
┌─────────────────────────────────────────────────────────────┐
│ Layer 2: User Approval (if dangerous)                        │
│ • Interactive prompt for risky commands                      │
│ • Configurable approval policies                             │
│ • Command modification before execution                      │
└──────────────────────┬──────────────────────────────────────┘
                       │ User approved
                       ↓
┌─────────────────────────────────────────────────────────────┐
│ Layer 3: Sandbox Enforcement                                 │
│ • OS-level process isolation                                 │
│ • Filesystem path restrictions                               │
│ • Syscall filtering (Linux)                                  │
└──────────────────────┬──────────────────────────────────────┘
                       │ Sandboxed execution
                       ↓
┌─────────────────────────────────────────────────────────────┐
│ Layer 4: Credential Isolation                                │
│ • Keyring-based credential storage                           │
│ • No credential access for sandboxed processes               │
│ • Never log secrets                                          │
└─────────────────────────────────────────────────────────────┘
```

### 1. Command Classification

```rust
pub fn is_dangerous_command(cmd: &str) -> bool {
    let dangerous_patterns = [
        // Destructive operations
        r"rm\s+(-rf?|--recursive|--force)",
        r":\(\)\{.*:&.*\};:",  // Fork bomb
        r"dd\s+if=.*of=",      // Disk operations
        r"mkfs\.",             // Format filesystem

        // Permission changes
        r"chmod\s+777",
        r"chown\s+root",

        // Process manipulation
        r"kill\s+-9\s+1",      // Kill init
        r"pkill\s+",

        // Network operations
        r"nc\s+-l",            // Listen on port
        r"wget\s+.*\|\s*sh",   // Download and execute

        // System modification
        r"shutdown",
        r"reboot",
        r"init\s+0",
    ];

    dangerous_patterns.iter().any(|pattern| {
        Regex::new(pattern).unwrap().is_match(cmd)
    })
}

pub fn is_safe_command(cmd: &str) -> bool {
    let safe_commands = [
        "ls", "cat", "echo", "pwd", "cd",
        "grep", "find", "head", "tail", "wc",
        "git status", "git log", "git diff",
        "npm test", "pytest", "cargo test",
    ];

    safe_commands.iter().any(|safe| cmd.starts_with(safe))
}
```

### 2. Platform-Specific Sandboxing

#### Linux: Landlock + seccomp

```rust
use landlock::{Access, AccessFs, Ruleset, RulesetAttr};

pub fn apply_linux_sandbox(policy: &ExecPolicy) -> Result<()> {
    // 1. Landlock: Path-based restrictions
    let mut ruleset = Ruleset::new()
        .handle_access(AccessFs::from_all(ABI::V2))?
        .create()?;

    match policy {
        ExecPolicy::ReadOnly => {
            ruleset = ruleset
                .add_rule(PathBeneath::new("/", AccessFs::ReadFile | AccessFs::ReadDir))?;
        }
        ExecPolicy::WorkspaceWrite { writable_roots } => {
            for root in writable_roots {
                ruleset = ruleset.add_rule(
                    PathBeneath::new(root, AccessFs::from_all(ABI::V2))?
                )?;
            }

            // Protect critical directories
            let protected = [".git", ".codex", ".env", ".ssh", ".aws"];
            for dir in protected {
                ruleset = ruleset.add_rule(
                    PathBeneath::new(dir, AccessFs::ReadFile | AccessFs::ReadDir)?
                )?;
            }
        }
        ExecPolicy::DangerFullAccess => return Ok(()),
    }

    ruleset.restrict_self()?;

    // 2. seccomp: Syscall filtering
    let ctx = seccomp::Context::new(seccomp::Action::Allow)?
        .set_action(seccomp::Action::Errno(libc::EPERM), &[
            seccomp::Syscall::execve,    // Block arbitrary execution
            seccomp::Syscall::execveat,
            seccomp::Syscall::ptrace,    // Block debugging
            seccomp::Syscall::perf_event_open,  // Block profiling
        ])?;

    ctx.load()?;

    Ok(())
}
```

#### macOS: App Sandbox

```rust
use core_foundation::base::CFRelease;
use core_foundation::string::CFString;

pub fn apply_macos_sandbox(policy: &ExecPolicy) -> Result<()> {
    let profile = match policy {
        ExecPolicy::ReadOnly => r#"
            (version 1)
            (deny default)
            (allow file-read*)
            (allow process-exec (literal "/bin/sh"))
        "#,
        ExecPolicy::WorkspaceWrite { writable_roots } => {
            let mut profile = String::from(r#"
                (version 1)
                (deny default)
                (allow file-read*)
            "#);

            for root in writable_roots {
                profile.push_str(&format!(
                    r#"(allow file-write* (subpath "{}")))"#,
                    root.display()
                ));
            }

            profile
        }
        ExecPolicy::DangerFullAccess => return Ok(()),
    };

    unsafe {
        let profile_cfstr = CFString::new(&profile);
        let mut error: *mut c_void = std::ptr::null_mut();

        let result = sandbox_init(
            profile_cfstr.as_concrete_TypeRef(),
            0,
            &mut error
        );

        if result != 0 {
            return Err(anyhow!("sandbox_init failed"));
        }
    }

    Ok(())
}
```

#### Windows: Job Objects + Restricted Tokens

```rust
use windows::Win32::System::JobObjects::*;
use windows::Win32::Security::*;

pub fn apply_windows_sandbox(policy: &ExecPolicy) -> Result<()> {
    unsafe {
        // 1. Create job object
        let job = CreateJobObjectW(None, None)?;

        // 2. Configure job limits
        let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        info.BasicLimitInformation.LimitFlags =
            JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE |
            JOB_OBJECT_LIMIT_DIE_ON_UNHANDLED_EXCEPTION;

        SetInformationJobObject(
            job,
            JobObjectExtendedLimitInformation,
            &info as *const _ as *const c_void,
            std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        )?;

        // 3. Assign current process to job
        AssignProcessToJobObject(job, GetCurrentProcess())?;

        // 4. Create restricted token
        let mut restricted_token = HANDLE::default();
        CreateRestrictedToken(
            GetCurrentProcessToken(),
            DISABLE_MAX_PRIVILEGE,
            None,
            None,
            None,
            &mut restricted_token,
        )?;

        // 5. Impersonate restricted token
        ImpersonateLoggedOnUser(restricted_token)?;
    }

    Ok(())
}
```

### 3. Credential Isolation

```rust
pub struct KeyringStore {
    #[cfg(target_os = "linux")]
    backend: SecretServiceBackend,

    #[cfg(target_os = "macos")]
    backend: KeychainBackend,

    #[cfg(target_os = "windows")]
    backend: WinCredBackend,
}

impl KeyringStore {
    pub async fn store_credential(&self, key: &str, value: &str) -> Result<()> {
        // Encrypt before storing
        let encrypted = self.encrypt(value)?;

        // Store in platform keyring
        self.backend.set(key, &encrypted).await?;

        // Never log or return plaintext
        Ok(())
    }

    pub async fn retrieve_credential(&self, key: &str) -> Result<String> {
        let encrypted = self.backend.get(key).await?;
        let decrypted = self.decrypt(&encrypted)?;

        // Ensure sandboxed processes can't access this
        if self.is_sandboxed()? {
            return Err(anyhow!("Credential access denied in sandbox"));
        }

        Ok(decrypted)
    }
}
```

**Security Best Practices:**
- ✅ Never pass credentials via environment variables (visible in `ps`)
- ✅ Never log credentials (even in debug mode)
- ✅ Use platform keyring (encrypted at rest)
- ✅ Wipe memory after use (zeroize crate)
- ✅ Sandboxed processes can't access keyring

---

## Build & Distribution Strategy

### Multi-Platform Compilation Matrix

```
┌─────────────────────────────────────────────────────────────┐
│ Rust Compilation Targets                                     │
├───────────────────┬─────────────────────────────────────────┤
│ Linux x64         │ x86_64-unknown-linux-musl              │
│ Linux ARM64       │ aarch64-unknown-linux-musl             │
│ macOS x64         │ x86_64-apple-darwin                    │
│ macOS ARM64       │ aarch64-apple-darwin (Apple Silicon)   │
│ Windows x64       │ x86_64-pc-windows-msvc                 │
│ Windows ARM64     │ aarch64-pc-windows-msvc                │
└───────────────────┴─────────────────────────────────────────┘
```

**Why musl on Linux?**
- ✅ **Static linking**: No glibc dependency issues
- ✅ **Portability**: Works on all Linux distros (Ubuntu, Alpine, CentOS)
- ⚠️ **Trade-off**: Proc macros require glibc at build time (Bazel constraint)

### NPM Package Structure

```
@openai/codex/
├── package.json
├── bin/
│   └── codex.js                    # Platform-aware launcher
├── vendor/
│   ├── linux-x64/
│   │   └── codex                   # 50MB (stripped, compressed)
│   ├── linux-arm64/
│   │   └── codex
│   ├── darwin-x64/
│   │   └── codex
│   ├── darwin-arm64/
│   │   └── codex
│   ├── win32-x64/
│   │   └── codex.exe
│   └── win32-arm64/
│       └── codex.exe
└── README.md

Total package size: ~300MB (6 binaries)
```

**Installation:**
```bash
# Global installation
npm install -g @openai/codex

# Local installation
npm install @openai/codex

# Homebrew (macOS)
brew install --cask codex
```

### Release Process

```yaml
# .github/workflows/release.yml

name: Release

on:
  push:
    tags:
      - 'v*'

jobs:
  build-linux-x64:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Build with Bazel
        run: bazel build //codex-rs/exec:codex --config=release --platforms=//platforms:linux-x64
      - name: Strip binary
        run: strip bazel-bin/codex-rs/exec/codex
      - name: Upload artifact
        uses: actions/upload-artifact@v4
        with:
          name: codex-linux-x64
          path: bazel-bin/codex-rs/exec/codex

  # Similar jobs for other platforms...

  publish-npm:
    needs: [build-linux-x64, build-linux-arm64, build-darwin-x64, build-darwin-arm64, build-windows-x64, build-windows-arm64]
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Download all artifacts
        uses: actions/download-artifact@v4
      - name: Arrange binaries
        run: |
          mkdir -p codex-cli/vendor/{linux-x64,linux-arm64,darwin-x64,darwin-arm64,win32-x64,win32-arm64}
          cp codex-linux-x64/codex codex-cli/vendor/linux-x64/
          cp codex-linux-arm64/codex codex-cli/vendor/linux-arm64/
          # ... etc
      - name: Publish to npm
        run: |
          cd codex-cli
          npm version ${{ github.ref_name }}
          npm publish
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

### Binary Optimization

```toml
# Cargo.toml

[profile.release]
opt-level = 'z'           # Optimize for size
lto = true                # Link-time optimization
codegen-units = 1         # Single codegen unit (slower build, smaller binary)
panic = 'abort'           # No unwinding (smaller binary)
strip = true              # Strip symbols

[profile.release.package."*"]
opt-level = 'z'           # Apply to all dependencies
```

**Results:**
- Debug build: ~150MB
- Release build: ~50MB (67% reduction)
- After strip: ~40MB
- After UPX compression: ~15MB (optional, but slower startup)

---

## Key Takeaways

### 1. **Rust Core, Multi-Language Frontends**

**Philosophy:** "Write the hard parts in Rust, expose via easy interfaces"

- ✅ **Performance**: Rust's speed critical for parsing large codebases
- ✅ **Safety**: Memory safety prevents crashes in long-running agents
- ✅ **Portability**: Single codebase → all platforms
- ✅ **Accessibility**: TypeScript SDK, npm distribution, IDE plugins

### 2. **JSONL Streaming Protocol**

**Philosophy:** "Simplicity beats complexity"

- ✅ **Universal**: Every language can spawn processes + read stdout
- ✅ **Debuggable**: Human-readable with `tail -f` or `cat`
- ✅ **Streaming**: Natural async event flow
- ✅ **Backpressure**: stdout buffering provides flow control

**vs. Alternatives:**
- gRPC: Too complex, requires network stack
- HTTP API: Requires server, port management
- Binary protocol: Not debuggable

### 3. **MCP Integration**

**Philosophy:** "Adopt standards, don't reinvent"

- ✅ **Industry standard**: Linux Foundation backed
- ✅ **Ecosystem**: 97M+ monthly downloads
- ✅ **Interoperability**: Works with all major LLMs
- ✅ **Community tools**: Leverage existing MCP servers

### 4. **Progressive Sandboxing**

**Philosophy:** "Security by default, power when needed"

**Three tiers:**
1. **ReadOnly**: Safe exploration (default)
2. **WorkspaceWrite**: Balanced productivity
3. **DangerFullAccess**: Full control (requires approval)

**Platform-specific enforcement:**
- Linux: Landlock + seccomp
- macOS: App Sandbox
- Windows: Job Objects + tokens

### 5. **Session Persistence**

**Philosophy:** "Seamless experience across contexts"

- ✅ **Resume anywhere**: CLI → TUI → IDE
- ✅ **Crash recovery**: Restore after termination
- ✅ **Audit trail**: Complete action history
- ✅ **Experimentation**: Fork threads

### 6. **Bazel Build System**

**Philosophy:** "Reproducible builds at scale"

- ✅ **Hermetic**: Same inputs → same outputs
- ✅ **Multi-platform**: Single build command
- ✅ **Incremental**: Fast rebuilds
- ✅ **Remote cache**: Share artifacts across machines

### 7. **Agent-Native Design**

**Philosophy:** "Built for autonomous operation"

- ✅ **Tool use**: MCP + built-in tools
- ✅ **Human oversight**: Approval flows
- ✅ **Context awareness**: Git, codebase, history
- ✅ **Streaming feedback**: Real-time progress

---

## References

### Official Resources

- **Repository**: https://github.com/openai/codex
- **Documentation**: https://developers.openai.com/codex
- **NPM Package**: https://www.npmjs.com/package/@openai/codex
- **TypeScript SDK**: https://www.npmjs.com/package/@openai/codex-sdk

### Model Context Protocol

- [MCP Specification (v1.24.0)](https://modelcontextprotocol.io/specification/2025-11-25)
- [MCP on The New Stack](https://thenewstack.io/model-context-protocol-bridges-llms-to-the-apps-they-need/)
- [Introducing MCP - Simon Willison](https://simonwillison.net/2024/Nov/25/model-context-protocol/)
- [What is MCP in AI? - Snyk](https://snyk.io/articles/what-is-mcp-in-ai-everything-you-wanted-to-ask/)
- [MCP on Wikipedia](https://en.wikipedia.org/wiki/Model_Context_Protocol)
- [Understanding MCP - SambaNova](https://sambanova.ai/blog/understanding-mcp)
- [MCP GitHub Repository](https://github.com/modelcontextprotocol/modelcontextprotocol)

### Related Technologies

- **Rust**: https://www.rust-lang.org/
- **Tokio**: https://tokio.rs/
- **Ratatui**: https://ratatui.rs/
- **Bazel**: https://bazel.build/
- **Landlock**: https://landlock.io/
- **tree-sitter**: https://tree-sitter.github.io/tree-sitter/

### Security

- **seccomp**: https://www.kernel.org/doc/html/latest/userspace-api/seccomp_filter.html
- **macOS App Sandbox**: https://developer.apple.com/documentation/security/app_sandbox
- **Windows Job Objects**: https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects

---

## Appendix: Command Reference

### CLI Commands

```bash
# Installation
npm install -g @openai/codex
brew install --cask codex

# Authentication
codex login

# Start conversation
codex chat
codex "Write a CSV parser"

# Resume thread
codex resume <thread-id>

# View history
codex history

# Run in different modes
codex --sandbox read-only "Analyze this codebase"
codex --sandbox workspace-write "Refactor the API"
codex --sandbox danger-full-access "Install dependencies"

# Use specific model
codex --model o3-mini "Solve this algorithm problem"
codex --model gpt-4o "Generate documentation"

# Enable web search
codex --web-search "Find latest React patterns 2026"

# Configure
codex config set model gpt-4o
codex config set sandbox_mode workspace-write
codex config list
```

### SDK Usage

```typescript
import { Codex } from '@openai/codex-sdk';

// Initialize
const codex = new Codex({
  env: { CODEX_API_KEY: 'sk-...' },
  config: {
    model: 'gpt-4o',
    sandboxMode: 'workspace-write',
  }
});

// Start thread
const thread = codex.startThread();

// Run with streaming
for await (const event of thread.runStreamed('Write a CSV parser')) {
  console.log(event.type, event);
}

// Run blocking
const result = await thread.run('Write a CSV parser');
console.log(result.responseText);
console.log(result.usage);

// Resume thread
const existingThread = codex.resumeThread('abc123');
```

---

**End of Analysis**
