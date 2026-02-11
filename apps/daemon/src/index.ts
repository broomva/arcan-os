/**
 * @agent-os/daemon — Entry point
 */

import { createKernel } from './kernel';
import { createApp } from './app';

const PORT = parseInt(process.env.AGENT_OS_PORT ?? '4200', 10);
const DB_PATH = process.env.AGENT_OS_DB ?? ':memory:';
const WORKSPACE = process.env.AGENT_OS_WORKSPACE ?? process.cwd();
const MODEL = process.env.AGENT_OS_MODEL; // Optional

const kernel = await createKernel({
  dbPath: DB_PATH,
  workspace: WORKSPACE,
  model: MODEL,
});

const app = createApp(kernel);

app.listen(PORT, () => {
  console.log(`🧠 Agent OS daemon listening on http://localhost:${PORT}`);
  console.log(`   Database: ${DB_PATH}`);
  console.log(`   Workspace: ${WORKSPACE}`);
});
