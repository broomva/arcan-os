import { Box, Text } from 'ink';
import { useEffect, useState } from 'react';
import zod from 'zod';
import { Chat } from '../components/Chat.js';
import { ClientProvider } from '../context/client-context.js';

export const options = zod.object({
  sessionId: zod.string().optional().describe('Session ID to resume or create'),
});

type Props = {
  options: zod.infer<typeof options>;
};

export default function Index({ options }: Props) {
  const [daemonReady, setDaemonReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sessionId = options.sessionId || crypto.randomUUID();

  useEffect(() => {
    const checkAndStartDaemon = async () => {
      const baseUrl = 'http://localhost:4200';

      // Check if daemon is already running
      try {
        const response = await fetch(`${baseUrl}/v1/health`);
        if (response.ok) {
          setDaemonReady(true);
          return;
        }
      } catch {
        // Daemon not running, try to start it
      }

      // Try to spawn the daemon
      try {
        const { spawn } = await import('node:child_process');
        const { existsSync, readFileSync } = await import('node:fs');
        const { join, dirname } = await import('node:path');
        const { fileURLToPath } = await import('node:url');

        // Try different ways to locate arcand
        let daemonCmd: string;
        let daemonArgs: string[] = [];
        const envVars: NodeJS.ProcessEnv = { ...process.env };

        // First try the installed command
        try {
          const { execSync } = await import('node:child_process');
          execSync('which arcand', { stdio: 'ignore' });
          daemonCmd = 'arcand';
        } catch {
          // Not installed globally, try development paths
          const __dirname = dirname(fileURLToPath(import.meta.url));
          const monorepoRoot = join(__dirname, '../../../..');
          const binPath = join(monorepoRoot, 'packages/agent-os/bin/arcand.js');
          const srcPath = join(monorepoRoot, 'apps/arcand/src/index.ts');
          const envPath = join(monorepoRoot, 'apps/arcand/.env');

          // Load .env file if in development
          if (existsSync(envPath)) {
            const envContent = readFileSync(envPath, 'utf-8');
            const envLines = envContent.split('\n');
            for (const line of envLines) {
              const trimmed = line.trim();
              if (trimmed && !trimmed.startsWith('#')) {
                const [key, ...valueParts] = trimmed.split('=');
                if (key && valueParts.length > 0) {
                  let value = valueParts.join('=').trim();
                  // Remove surrounding quotes if present
                  if (
                    (value.startsWith('"') && value.endsWith('"')) ||
                    (value.startsWith("'") && value.endsWith("'"))
                  ) {
                    value = value.slice(1, -1);
                  }
                  envVars[key.trim()] = value;
                }
              }
            }
          }

          if (existsSync(binPath)) {
            daemonCmd = 'node';
            daemonArgs = [binPath];
          } else if (existsSync(srcPath)) {
            daemonCmd = 'bun';
            daemonArgs = ['run', srcPath];
          } else {
            throw new Error('Could not locate arcand binary');
          }
        }

        // Spawn arcand in background
        const daemon = spawn(daemonCmd, daemonArgs, {
          detached: true,
          stdio: 'ignore',
          env: envVars,
        });

        daemon.unref(); // Allow parent to exit independently

        // Wait for daemon to be ready
        let attempts = 0;
        const maxAttempts = 30; // 15 seconds max

        while (attempts < maxAttempts) {
          await new Promise((resolve) => setTimeout(resolve, 500));
          try {
            const response = await fetch(`${baseUrl}/v1/health`);
            if (response.ok) {
              setDaemonReady(true);
              return;
            }
          } catch {
            // Not ready yet
          }
          attempts++;
        }

        setError('Daemon failed to start within 15 seconds');
      } catch (err) {
        setError(
          `Failed to start daemon: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    };

    checkAndStartDaemon();
  }, []);

  if (error) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color="red">Error: {error}</Text>
        <Text>Try running `arcand` manually in another terminal.</Text>
      </Box>
    );
  }

  if (!daemonReady) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color="yellow">Starting Arcan OS daemon...</Text>
      </Box>
    );
  }

  return (
    <ClientProvider>
      <Chat sessionId={sessionId} />
    </ClientProvider>
  );
}
