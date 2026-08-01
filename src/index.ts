#!/usr/bin/env node
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

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

function startSpinner(): () => void {
  let i = 0;
  const timer = setInterval(() => {
    process.stdout.write(`\r${styleText('cyan', SPINNER_FRAMES[i % SPINNER_FRAMES.length])} thinking…`);
    i++;
  }, 80);
  return () => {
    clearInterval(timer);
    process.stdout.write('\r\x1b[2K');
  };
}

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

  const stopSpinner = startSpinner();
  let spinnerStopped = false;

  const ensureSpinnerStopped = () => {
    if (!spinnerStopped) {
      stopSpinner();
      spinnerStopped = true;
    }
  };

  try {
    for await (const event of stream) {
      ensureSpinnerStopped();

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
  } finally {
    ensureSpinnerStopped();
  }

  return { contextId: newContextId, taskId: newTaskId };
}

async function main() {
  const { positionals } = parseArgs({ allowPositionals: true });
  const url = positionals[0];
  if (!url) {
    console.error('Usage: a2a-client <agent-url>');
    process.exit(1);
  }

  const clientFactory = new ClientFactory(
    ClientFactoryOptions.createFrom(ClientFactoryOptions.default, {
      transports: [new RestTransportFactory()],
    })
  );
  const client = await clientFactory.createFromUrl(url);
  const agentCard = await client.getAgentCard();

  const width = 60;
  const line = '─'.repeat(width);
  const dim = (s: string) => styleText('dim', s);
  const bold = (s: string) => styleText('bold', s);
  const cyan = (s: string) => styleText('cyan', s);
  const yellow = (s: string) => styleText('yellow', s);

  console.log(cyan(`┌${line}┐`));
  console.log(cyan('│') + ' ' + bold(agentCard.name.padEnd(width - 1)) + cyan('│'));
  if (agentCard.version) {
    console.log(cyan('│') + ' ' + dim(`v${agentCard.version}`.padEnd(width - 1)) + cyan('│'));
  }
  if (agentCard.description) {
    const words = agentCard.description.split(' ');
    const lines: string[] = [];
    let current = '';
    for (const word of words) {
      if ((current + ' ' + word).trim().length > width - 2) {
        lines.push(current.trim());
        current = word;
      } else {
        current = (current + ' ' + word).trim();
      }
    }
    if (current) lines.push(current.trim());
    console.log(cyan(`├${line}┤`));
    for (const l of lines) {
      console.log(cyan('│') + ' ' + l.padEnd(width - 1) + cyan('│'));
    }
  }
  if (agentCard.skills.length > 0) {
    console.log(cyan(`├${line}┤`));
    console.log(cyan('│') + ' ' + bold('Skills'.padEnd(width - 1)) + cyan('│'));
    for (const skill of agentCard.skills) {
      const tags = skill.tags.length > 0 ? `  ${dim(`[${skill.tags.join(', ')}]`)}` : '';
      const nameLabel = `  • ${skill.name}`;
      const visibleLen = nameLabel.length + (skill.tags.length > 0 ? 2 + skill.tags.join(', ').length + 2 : 0);
      const pad = ' '.repeat(Math.max(0, width - 1 - visibleLen));
      console.log(cyan('│') + ' ' + yellow(nameLabel) + tags + pad + cyan('│'));
      if (skill.description) {
        const desc = `    ${skill.description}`;
        if (desc.length <= width - 1) {
          console.log(cyan('│') + ' ' + dim(desc.padEnd(width - 1)) + cyan('│'));
        }
      }
    }
  }
  console.log(cyan(`└${line}┘`));
  console.log('');
  console.log(dim('Type your message and press Enter. Type "exit" to quit.\n'));

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
