import { ClientFactory, ClientFactoryOptions, RestTransportFactory } from '@a2a-js/sdk/client';
import { Client } from '@a2a-js/sdk/client';
import { AgentCard } from '@a2a-js/sdk';
import { Role, Task, TaskState } from '@a2a-js/sdk';

export type UUID = `${string}-${string}-${string}-${string}-${string}`;

export const TERMINAL_STATES = new Set([
  TaskState.TASK_STATE_COMPLETED,
  TaskState.TASK_STATE_FAILED,
  TaskState.TASK_STATE_CANCELED,
  TaskState.TASK_STATE_REJECTED,
  TaskState.TASK_STATE_INPUT_REQUIRED,
  TaskState.TASK_STATE_AUTH_REQUIRED,
]);

export interface AgentSession {
  client: Client;
  agentCard: AgentCard;
}

export interface SendResult {
  contextId: UUID;
  taskId: string;
  response: string;
}

export async function createAgentSession(url: string): Promise<AgentSession> {
  const clientFactory = new ClientFactory(
    ClientFactoryOptions.createFrom(ClientFactoryOptions.default, {
      transports: [new RestTransportFactory()],
    })
  );
  const client = await clientFactory.createFromUrl(url);
  const agentCard = await client.getAgentCard();
  return { client, agentCard };
}

export async function sendAndReceive(
  client: Client,
  userText: string,
  contextId: UUID,
  taskId: string
): Promise<SendResult> {
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
  let response = '';

  for await (const event of stream) {
    if (event.payload?.$case === 'task') {
      const task = event.payload.value as Task;
      newContextId = (task.contextId as UUID) || newContextId;
      newTaskId = task.id || newTaskId;

      const state = task.status?.state;
      if (state !== undefined && TERMINAL_STATES.has(state)) {
        const text = task.status?.message?.parts?.[0]?.content;
        response = text?.$case === 'text' ? text.value : '(no text)';
        break;
      }
    }

    if (event.payload?.$case === 'statusUpdate') {
      const update = event.payload.value;
      newContextId = (update.contextId as UUID) || newContextId;
      newTaskId = update.taskId || newTaskId;

      const { state, message } = update.status ?? {};
      if (state !== undefined && TERMINAL_STATES.has(state)) {
        const text = message?.parts?.[0]?.content;
        response = text?.$case === 'text' ? text.value : '(no text)';
        break;
      }
    }

    if (event.payload?.$case === 'message') {
      const text = event.payload.value.parts?.[0]?.content;
      response = text?.$case === 'text' ? text.value : '(no text)';
    }
  }

  return { contextId: newContextId, taskId: newTaskId, response };
}
