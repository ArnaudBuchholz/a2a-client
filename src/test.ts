import { ClientFactory, ClientFactoryOptions, RestTransportFactory } from '@a2a-js/sdk/client';
import { Role, Task, TaskState, taskStateToJSON } from '@a2a-js/sdk';

async function runClient() {
  const clientFactory = new ClientFactory(
    ClientFactoryOptions.createFrom(ClientFactoryOptions.default, {
      transports: [new RestTransportFactory()],
    })
  );
  const client = await clientFactory.createFromUrl('http://localhost:9090');
  const agentCard = await client.getAgentCard();
  console.log(`Connected to agent: ${agentCard.name}`);

  const stream = client.sendMessageStream({
    message: {
      messageId: crypto.randomUUID(),
      role: Role.ROLE_USER,
      parts: [{ content: { $case: 'text', value: 'Hello Agent! What can you do?' }, metadata: undefined, filename: '', mediaType: '' }],
      contextId: '',
      taskId: '',
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

  for await (const event of stream) {
    if (event.payload?.$case === 'statusUpdate') {
      const { state, message } = event.payload.value.status ?? {};
      const stateStr = taskStateToJSON(state ?? TaskState.TASK_STATE_UNSPECIFIED);
      const description = message?.parts?.[0]?.content?.$case === 'text' ? message.parts[0].content.value : '';
      console.log(`[Status Change]: ${stateStr}${description ? ` - ${description}` : ''}`);

      if (state === TaskState.TASK_STATE_COMPLETED || state === TaskState.TASK_STATE_FAILED) {
        break;
      }
    }

    if (event.payload?.$case === 'message') {
      const text = event.payload.value.parts?.[0]?.content;
      console.log(`[Agent Response]: ${text?.$case === 'text' ? text.value : '(no text)'}`);
    }

    if (event.payload?.$case === 'task') {
      const task = event.payload.value as Task;
      const state = task.status?.state;
      const terminalStates = [
        TaskState.TASK_STATE_COMPLETED,
        TaskState.TASK_STATE_FAILED,
        TaskState.TASK_STATE_CANCELED,
        TaskState.TASK_STATE_REJECTED,
        TaskState.TASK_STATE_INPUT_REQUIRED,
        TaskState.TASK_STATE_AUTH_REQUIRED,
      ];
      if (state !== undefined && terminalStates.includes(state)) {
        const statusMessage = task.status?.message;
        if (statusMessage) {
          const text = statusMessage.parts?.[0]?.content;
          console.log(`[Agent Response]: ${text?.$case === 'text' ? text.value : '(no text)'}`);
        }
        console.log(`[Task ${taskStateToJSON(state)}]: ${task.id}`);
        break;
      }
    }
  }
}

runClient().catch(console.error);
