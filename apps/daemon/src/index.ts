/**
 * @arcan-os/daemon — Entry point
 */

import { createApp } from './app';
import { env } from './env';
import { createKernel } from './kernel';
import { logger } from './logger';

const kernel = await createKernel({
  dbPath: env.AGENT_OS_DB,
  workspace: env.AGENT_OS_WORKSPACE,
  model: env.AGENT_OS_MODEL,
});

const app = createApp(kernel);

app.listen(env.AGENT_OS_PORT, () => {
  logger.info(
    `🧠 Agent OS daemon listening on http://localhost:${env.AGENT_OS_PORT}`,
  );
  logger.info(`   Database: ${env.AGENT_OS_DB}`);
  logger.info(`   Workspace: ${env.AGENT_OS_WORKSPACE}`);
});
