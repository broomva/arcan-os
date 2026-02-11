import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

export const env = createEnv({
  server: {
    AGENT_OS_PORT: z.coerce.number().default(4200),
    AGENT_OS_DB: z.string().default(':memory:'),
    AGENT_OS_WORKSPACE: z.string().default(process.cwd()),
    AGENT_OS_MODEL: z.string().optional(),
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace'])
      .default('info'),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
