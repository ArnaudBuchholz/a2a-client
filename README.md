# a2a-client

Agent client using agent2agent protocol

## Usage

* The agent **must** be running **before** the client is invoked
* `a2a-client <agent URL>`
* say `exit` to quit the client

## End-to-end flow

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
