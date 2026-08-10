#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { startCli } from './cli.js';
import { startMcpServer } from './mcp.js';

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    port: { type: 'string', short: 'p' },
  },
});

const url = positionals[0];
if (!url) {
  console.error('Usage: a2a-client <agent-url> [--port <n>]');
  process.exit(1);
}

if (values.port !== undefined) {
  const port = parseInt(values.port, 10);
  startMcpServer(url, port).catch(err => {
    const code = (err as NodeJS.ErrnoException).code;
    const detail = code ? ` (${code})` : '';
    console.error(`Cannot start MCP server: ${(err as Error).message}${detail}`);
    process.exit(1);
  });
} else {
  startCli(url).catch(console.error);
}
