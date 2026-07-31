import * as readline from 'node:readline';
import { parseArgs, styleText } from 'node:util';
import { marked } from 'marked';
import TerminalRenderer from 'marked-terminal';
import { ClientFactory, ClientFactoryOptions, RestTransportFactory } from '@a2a-js/sdk/client';
import { Client } from '@a2a-js/sdk/client';
import { Role, Task, TaskState } from '@a2a-js/sdk';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
marked.setOptions({ renderer: new TerminalRenderer() as any });

function renderMarkdown(text: string): string {
  return marked(text) as string;
}

const TERMINAL_STATES = new Set([
  TaskState.TASK_STATE_COMPLETED,
  TaskState.TASK_STATE_FAILED,
  TaskState.TASK_STATE_CANCELED,
  TaskState.TASK_STATE_REJECTED,
  TaskState.TASK_STATE_INPUT_REQUIRED,
  TaskState.TASK_STATE_AUTH_REQUIRED,
]);

async function sendAndReceive(client: Client, userText: string, contextId: string, taskId: string): Promise<{ contextId: string; taskId: string }> {
  const stream = client.sendMessageStream({
    message: {
      messageId: crypto.randomUUID(),
      role: Role.ROLE_USER,
      parts: [{ content: { $case: 'text', value: userText }, metadata: undefined, filename: '', mediaType: '' }],
      contextId,
      taskId,
      metadata: undefined,
      extensions: [],
      referenceTaskIds: [],
    },
    configuration: {
      acceptedOutputModes: ['text/plain'],
      taskPushNotificationConfig: undefined,
      returnImmediately: false,
    },
    tenant: '',
    metadata: undefined,
  });

  let newContextId = contextId;
  let newTaskId = taskId;

  for await (const event of stream) {
    if (event.payload?.$case === 'task') {
      const task = event.payload.value as Task;
      newContextId = task.contextId || newContextId;
      newTaskId = task.id || newTaskId;

      const state = task.status?.state;
      if (state !== undefined && TERMINAL_STATES.has(state)) {
        const text = task.status?.message?.parts?.[0]?.content;
        const response = text?.$case === 'text' ? text.value : '(no text)';
        process.stdout.write(`\n${styleText('yellow', 'Agent:')}\n${renderMarkdown(response)}\n`);
        break;
      }
    }

    if (event.payload?.$case === 'statusUpdate') {
      const update = event.payload.value;
      newContextId = update.contextId || newContextId;
      newTaskId = update.taskId || newTaskId;

      const { state, message } = update.status ?? {};
      if (state !== undefined && TERMINAL_STATES.has(state)) {
        const text = message?.parts?.[0]?.content;
        const response = text?.$case === 'text' ? text.value : '(no text)';
        process.stdout.write(`\n${styleText('yellow', 'Agent:')}\n${renderMarkdown(response)}\n`);
        break;
      }
    }

    if (event.payload?.$case === 'message') {
      const text = event.payload.value.parts?.[0]?.content;
      const response = text?.$case === 'text' ? text.value : '(no text)';
      process.stdout.write(`\nAgent:\n${renderMarkdown(response)}\n`);
    }
  }

  return { contextId: newContextId, taskId: newTaskId };
}

async function main() {
  const { positionals } = parseArgs({ allowPositionals: true });
  const url = positionals[0];
  if (!url) {
    console.error('Usage: tsx src/test.ts <agent-url>');
    process.exit(1);
  }

  const clientFactory = new ClientFactory(
    ClientFactoryOptions.createFrom(ClientFactoryOptions.default, {
      transports: [new RestTransportFactory()],
    })
  );
  const client = await clientFactory.createFromUrl(url);
  const agentCard = await client.getAgentCard();
  console.log(`Connected to: ${agentCard.name}`);
  console.log('Type your message and press Enter. Type "exit" to quit.\n');

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  let contextId = '';
  let taskId = '';

  const ask = () => {
    rl.question(styleText('yellow', 'You: '), async (input: string) => {
      const text = input.trim();
      if (text.toLowerCase() === 'exit') {
        rl.close();
        return;
      }
      if (!text) {
        ask();
        return;
      }
      try {
        ({ contextId, taskId } = await sendAndReceive(client, text, contextId, taskId));
      } catch (err) {
        console.error('Error:', err);
      }
      ask();
    });
  };

  ask();
}

main().catch(console.error);
