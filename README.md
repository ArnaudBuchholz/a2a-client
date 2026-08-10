# a2a-client

Agent client using the [Agent2Agent (A2A)](https://google.github.io/A2A/) protocol.

Supports two modes from the same binary:

- **Interactive CLI** — talk to an A2A agent directly in the terminal
- **MCP server** — expose the agent as a [Model Context Protocol](https://modelcontextprotocol.io/) tool so any MCP-compatible client (Joule Desktop, Claude Desktop, Cursor, etc.) can use it

## Prerequisites

The target agent must be running and reachable before launching `a2a-client`.

## Installation

```bash
npm install -g a2a-client
```

## Usage

### Interactive CLI

```bash
a2a-client <agent-url>
```

Example:

```bash
a2a-client http://localhost:41241
```

At startup the agent card (name, version, description, skills) is displayed. Then type messages and press **Enter** to send them. The conversation context is preserved across turns.

**Keyboard shortcuts**

| Key | Action |
|-----|--------|
| `/` | Open command picker |
| `Ctrl+C` | Quit |

**Commands** (type `/` to open the picker)

| Command | Description |
|---------|-------------|
| `/exit` | Close the session and quit |
| `/new` | Start a fresh conversation (new context ID) |

### MCP server

```bash
a2a-client <agent-url> --port <n>
```

Example:

```bash
a2a-client http://localhost:41241 --port 3000
```

This connects to the agent, fetches its card, then starts an HTTP MCP server on `http://127.0.0.1:<port>`. The server exposes a single tool `submit_prompt` whose description is built from the agent card.

**Tool: `submit_prompt`**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `prompt` | string | yes | The message to send to the agent |
| `contextId` | string | no | Context ID from a previous turn (for multi-turn conversations) |
| `taskId` | string | no | Task ID from a previous turn |

The tool returns a JSON object:

```json
{
  "response": "<agent reply>",
  "contextId": "<uuid>",
  "taskId": "<string>"
}
```

Pass `contextId` and `taskId` from one turn into the next to maintain conversation state across stateless MCP calls.

#### Connecting Claude Desktop

Add this to your Claude Desktop MCP config (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "my-agent": {
      "command": "a2a-client",
      "args": ["http://localhost:41241", "--port", "3000"],
      "transport": "http",
      "url": "http://127.0.0.1:3000"
    }
  }
}
```

## End-to-end flow

### CLI mode

```
a2a-client                              agent
│                                           │
│── GET /.well-known/agent-card.json ──────▶│
│◀─ { name, version, description, skills } ─│
│   (rendered as the startup box)           │
│                                           │
│── POST /a2a  { message/send, stream } ───▶│
│◀─ SSE: statusUpdate / task events ────────│
│   (spinner → "Agent: <response>")         │
│                                           │
│── POST /a2a  { same contextId/taskId } ──▶│  ← next turn
│◀─ SSE: ...                                │
```

### MCP server mode

```
MCP client          a2a-client (MCP server)         agent
│                           │                            │
│── initialize ────────────▶│                            │
│◀─ { tools: [submit_prompt] }                           │
│                           │── GET /agent-card ────────▶│
│                           │◀─ { name, description… } ──│
│                           │                            │
│── tools/call ────────────▶│                            │
│   submit_prompt(prompt)   │── POST /a2a (stream) ─────▶│
│                           │◀─ SSE events ──────────────│
│◀─ { response, contextId, taskId }                      │
│                           │                            │
│── tools/call ────────────▶│                            │
│   submit_prompt(prompt,   │── POST /a2a (same context)▶│
│     contextId, taskId)    │◀─ SSE events ──────────────│
│◀─ { response, contextId, taskId }                      │
```
