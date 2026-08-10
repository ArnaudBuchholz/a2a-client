import * as readline from 'node:readline';
import { styleText } from 'node:util';
import { marked } from 'marked';
import TerminalRenderer from 'marked-terminal';
import { Client } from '@a2a-js/sdk/client';
import { createAgentSession, sendAndReceive as coreSendAndReceive, UUID } from './agent.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
marked.setOptions({ renderer: new TerminalRenderer() as any });

function renderMarkdown(text: string): string {
  return marked(text) as string;
}

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

async function sendAndReceive(client: Client, userText: string, contextId: UUID, taskId: string): Promise<{ contextId: UUID; taskId: string }> {
  const stopSpinner = startSpinner();
  try {
    const result = await coreSendAndReceive(client, userText, contextId, taskId);
    stopSpinner();
    process.stdout.write(`\n${styleText('yellow', 'Agent:')}\n${renderMarkdown(result.response)}\n`);
    return { contextId: result.contextId, taskId: result.taskId };
  } catch (err) {
    stopSpinner();
    throw err;
  }
}

interface Command {
  name: string;
  description: string;
  handler: () => void;
}

function getMatches(commands: Command[], query: string): Command[] {
  const lower = query.toLowerCase();
  return commands.filter(c => c.name.toLowerCase().includes(lower));
}

async function runSlashPicker(rl: readline.Interface, commands: Command[]): Promise<Command | null> {
  return new Promise<Command | null>(resolve => {
    let query = '';
    let selectedIndex = 0;

    const drawOverlay = () => {
      const matches = getMatches(commands, query);

      // Save cursor at prompt line, draw overlay below, restore
      process.stdout.write('\x1b7');
      process.stdout.write('\n\x1b[J');

      if (matches.length === 0) {
        process.stdout.write(styleText('dim', '  (no commands match)') + '\x1b[K');
      } else {
        for (let i = 0; i < matches.length; i++) {
          const cmd = matches[i];
          const line = `  ${cmd.name}  —  ${cmd.description}`;
          if (i === selectedIndex) {
            process.stdout.write(`\x1b[7m${line}\x1b[27m\x1b[K`);
          } else {
            process.stdout.write(line + '\x1b[K');
          }
          if (i < matches.length - 1) process.stdout.write('\n');
        }
      }

      process.stdout.write('\x1b8');
      readline.cursorTo(process.stdout, 0);
      process.stdout.write('\x1b[2K' + styleText('yellow', 'You: ') + '/' + query);
    };

    const eraseOverlay = () => {
      process.stdout.write('\x1b8');
      process.stdout.write('\n\x1b[J'); // erase from here to end of screen
      process.stdout.write('\x1b8');
    };

    const cleanup = (result: Command | null) => {
      eraseOverlay();
      readline.cursorTo(process.stdout, 0);
      process.stdout.write('\x1b[2K');
      process.stdout.write('\x1b[?25h');
      process.stdin.off('keypress', onKeypress);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      resolve(result);
    };

    const onKeypress = (_chunk: string, key: readline.Key) => {
      if (!key) return;

      if (key.ctrl && key.name === 'c') {
        cleanup(null);
        rl.close();
        process.exit(0);
      }

      if (key.name === 'escape') {
        cleanup(null);
        return;
      }

      const matches = getMatches(commands, query);

      if (key.name === 'return') {
        cleanup(matches[selectedIndex] ?? null);
        return;
      }

      if (key.name === 'up') {
        selectedIndex = Math.max(0, selectedIndex - 1);
        drawOverlay();
        return;
      }

      if (key.name === 'down') {
        selectedIndex = Math.min(Math.max(0, matches.length - 1), selectedIndex + 1);
        drawOverlay();
        return;
      }

      if (key.name === 'backspace') {
        if (query === '') {
          cleanup(null);
        } else {
          query = query.slice(0, -1);
          selectedIndex = 0;
          drawOverlay();
        }
        return;
      }

      if (key.sequence && !key.ctrl && !key.meta && key.sequence.length === 1) {
        query += key.sequence;
        selectedIndex = 0;
        drawOverlay();
      }
    };

    readline.emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdout.write('\x1b[?25l');
    process.stdin.on('keypress', onKeypress);
    drawOverlay();
  });
}

function printAgentCard(agentCard: Awaited<ReturnType<Client['getAgentCard']>>): void {
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
      const tags = skill.tags && skill.tags.length > 0 ? `  ${dim(`[${skill.tags.join(', ')}]`)}` : '';
      const nameLabel = `  • ${skill.name}`;
      const visibleLen = nameLabel.length + (skill.tags && skill.tags.length > 0 ? 2 + skill.tags.join(', ').length + 2 : 0);
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
  console.log(styleText('dim', 'Type your message and press Enter. Type / for commands.\n'));
}

export async function startCli(agentUrl: string): Promise<void> {
  let client: Client;
  let agentCard: Awaited<ReturnType<Client['getAgentCard']>>;
  try {
    ({ client, agentCard } = await createAgentSession(agentUrl));
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    const detail = code ? ` (${code})` : '';
    console.error(styleText('red', `Cannot connect to agent at ${agentUrl}${detail}`));
    process.exit(1);
  }

  printAgentCard(agentCard);

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: false });

  let contextId: UUID = crypto.randomUUID();
  let taskId = '';

  const COMMANDS: Command[] = [
    { name: '/exit', description: 'Close the session and quit', handler: () => { rl.close(); process.exit(0); } },
    {
      name: '/new',
      description: 'Start a new conversation (fresh context)',
      handler: () => {
        contextId = crypto.randomUUID();
        taskId = '';
        console.log(styleText('dim', 'New conversation started.\n'));
      },
    },
  ];

  const prompt = () => {
    const ctx = contextId ? styleText('dim', ` [${contextId.slice(0, 8)}]`) : '';
    process.stdout.write(styleText('yellow', 'You') + ctx + styleText('yellow', ': '));
  };

  const ask = () => {
    if (!process.stdin.isTTY) return;

    prompt();
    let lineBuffer = '';

    readline.emitKeypressEvents(process.stdin);

    const onKey = async (_chunk: string, key: readline.Key) => {
      if (!key) return;

      if (key.ctrl && key.name === 'c') {
        rl.close();
        process.exit(0);
      }

      if (key.name === 'return') {
        process.stdin.off('keypress', onKey);
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdout.write('\n');
        const text = lineBuffer.trim();
        if (!text) { ask(); return; }
        try {
          ({ contextId, taskId } = await sendAndReceive(client, text, contextId, taskId));
        } catch (err) {
          console.error('Error:', err);
        }
        ask();
        return;
      }

      if (key.name === 'backspace') {
        if (lineBuffer.length > 0) {
          lineBuffer = lineBuffer.slice(0, -1);
          readline.moveCursor(process.stdout, -1, 0);
          process.stdout.write('\x1b[K');
        }
        return;
      }

      if (lineBuffer === '' && key.sequence === '/') {
        process.stdin.off('keypress', onKey);
        process.stdin.setRawMode(false);
        process.stdin.pause();
        readline.cursorTo(process.stdout, 0);
        process.stdout.write('\x1b[2K');

        const command = await runSlashPicker(rl, COMMANDS);
        if (command) {
          command.handler();
        }
        ask();
        return;
      }

      if (key.sequence && !key.ctrl && !key.meta) {
        lineBuffer += key.sequence;
        process.stdout.write(key.sequence);
      }
    };

    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on('keypress', onKey);
  };

  ask();
}
