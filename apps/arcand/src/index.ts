/**
 * @arcan-os/arcand — Entry point
 */

import { createApp } from './app';
import { env } from './env';
import { createKernel } from './kernel';
import { logger } from './logger';

const kernel = await createKernel({
  dbPath: env.ARCAN_OS_DB,
  workspace: env.ARCAN_OS_WORKSPACE,
  model: env.ARCAN_OS_MODEL,
});

const app = createApp(kernel);

app.listen(env.ARCAN_OS_PORT, () => {
  logger.info(
    `🧠 Arcan OS arcand listening on http://localhost:${env.ARCAN_OS_PORT}`,
  );
  logger.info(`   Database: ${env.ARCAN_OS_DB}`);
  logger.info(`   Workspace: ${env.ARCAN_OS_WORKSPACE}`);
});
