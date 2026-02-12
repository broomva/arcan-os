// @ts-nocheck

import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { AgentClient } from '../src/client/agent-client.js';

const TARGET_FILE = 'hello-e2e.txt';
const TARGET_PATH = join(process.cwd(), TARGET_FILE);

async function main() {
  console.log('--- Starting Tool Execution E2E Test ---');

  // 1. cleanup
  if (existsSync(TARGET_PATH)) {
    unlinkSync(TARGET_PATH);
    console.log('Cleaned up existing file.');
  }

  // 2. Initialize client
  const client = new AgentClient('http://localhost:4200');
  const sessionId = `e2e-test-session-${Date.now()}`;

  console.log(`Session ID: ${sessionId}`);

  // 3. Send request
  const prompt = `Create a file named "${TARGET_FILE}" with the content "Hello Agent OS E2E".`;
  console.log(`Prompt: ${prompt}`);
  let runId: string | undefined;
  try {
    const res = await client.createRun({
      sessionId,
      prompt,
    });
    runId = res.runId;
    console.log('Run response:', JSON.stringify(res, null, 2));
    console.log('Run ID:', res.runId);

    if (!res.runId) {
      console.error('Create Run Failed: runId is missing');
      process.exit(1);
    }
    runId = res.runId;
  } catch (e: unknown) {
    console.error('Create Run Failed:', e);
    if (e instanceof Error && 'data' in e) {
      console.error('Response data:', (e as Record<string, unknown>).data);
    }
    process.exit(1);
  }

  // 4. Poll/Stream for completion
  let toolCalled = false;
  for await (const event of client.connectToRun(runId)) {
    if (event.type === 'tool.call') {
      console.log('Tool called:', event.payload.toolId);
      toolCalled = true;
    }

    if (event.type === 'output.message') {
      console.log('Agent:', event.payload.content);
    }

    console.log(
      `[Test] Stream received event: ${event.type} id=${event.eventId}`,
    );

    if (event.type === 'run.completed' || event.type === 'run.failed') {
      if (event.type === 'run.failed') {
        throw new Error('Run failed!');
      }
      break;
    }
  }

  // 5. Verify
  if (!toolCalled) {
    console.error('FAILED: No tool was called.');
    process.exit(1);
  }

  if (existsSync(TARGET_PATH)) {
    const content = readFileSync(TARGET_PATH, 'utf-8');
    if (content.includes('Hello Agent OS E2E')) {
      console.log('SUCCESS: File created with correct content.');
      // cleanup
      unlinkSync(TARGET_PATH);
      process.exit(0);
    } else {
      console.error(`FAILED: File content mismatch. Got: "${content}"`);
      process.exit(1);
    }
  } else {
    console.error('FAILED: File was not created.');
    process.exit(1);
  }
}

main();
