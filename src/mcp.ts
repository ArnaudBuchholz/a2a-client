import * as http from 'node:http';
import * as z from 'zod/v4';
import { McpServer, createMcpHandler } from '@modelcontextprotocol/server';
import { toNodeHandler, localhostHostValidation, localhostOriginValidation } from '@modelcontextprotocol/node';
import { createAgentSession, sendAndReceive, UUID } from './agent.js';

export async function startMcpServer(agentUrl: string, port: number): Promise<void> {
  console.log(`Connecting to agent at ${agentUrl}…`);
  const { client, agentCard } = await createAgentSession(agentUrl);

  const skillLines = agentCard.skills
    .map(s => `- ${s.name}${s.description ? `: ${s.description}` : ''}`)
    .join('\n');
  const toolDescription = [
    agentCard.description ?? agentCard.name,
    skillLines ? `\nSkills:\n${skillLines}` : '',
  ]
    .join('')
    .trim();

  console.log('[mcp] tool description exposed to MCP clients:');
  console.log('---');
  console.log(toolDescription);
  console.log('---');

  const handler = createMcpHandler(() => {
    const server = new McpServer({
      name: agentCard.name,
      version: agentCard.version ?? '0.0.0',
    });

    server.registerTool(
      'submit_prompt',
      {
        description: toolDescription,
        inputSchema: z.object({
          prompt: z.string().describe('The message to send to the agent'),
          contextId: z.string().optional().describe('Conversation context ID from a previous turn'),
          taskId: z.string().optional().describe('Task ID from a previous turn'),
        }),
      },
      async ({ prompt, contextId, taskId }) => {
        const resolvedContextId = (contextId ?? crypto.randomUUID()) as UUID;
        console.log(`[mcp] submit_prompt contextId=${resolvedContextId}${taskId ? ` taskId=${taskId}` : ''}`);
        console.log(`[mcp] prompt: ${prompt}`);
        const result = await sendAndReceive(client, prompt, resolvedContextId, taskId ?? '');
        console.log(`[mcp] response contextId=${result.contextId} taskId=${result.taskId}`);
        console.log(`[mcp] response: ${result.response}`);
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              response: result.response,
              contextId: result.contextId,
              taskId: result.taskId,
            }),
          }],
        };
      }
    );

    return server;
  });

  const nodeHandler = toNodeHandler(handler);
  const validateHost = localhostHostValidation();
  const validateOrigin = localhostOriginValidation();

  const httpServer = http.createServer((req, res) => {
    console.log(`[mcp] ${req.method} ${req.url} from ${req.socket.remoteAddress}`);
    if (!validateHost(req, res) || !validateOrigin(req, res)) return;
    void nodeHandler(req, res);
  });

  httpServer.listen(port, '127.0.0.1', () => {
    console.log(`MCP server running at http://127.0.0.1:${port}`);
    console.log(`Agent: ${agentCard.name}${agentCard.version ? ` v${agentCard.version}` : ''}`);
  });
}
