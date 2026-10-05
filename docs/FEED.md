# Cubicle feed format

Cubicle can show agents from any system that can produce this JSON. Point it at a file or a URL:

```bash
cubicle --source ./agents.json
cubicle --source http://localhost:8080/agents
```

The file is re-read (or the URL re-fetched) every 4 seconds. Only `GET` is ever made; Cubicle never writes to the source.

## Shape

```json
{
  "company": "Acme Bots",
  "agents": [
    { "id": "writer",  "name": "Writer",  "role": "Copywriter", "status": "running", "task": { "id": "DOC-12", "title": "Draft launch post", "url": "https://example.com/DOC-12" } },
    { "id": "qa",      "name": "QA",      "status": "waiting", "task": "Approve deploy to staging?" },
    { "id": "scraper", "name": "Scraper", "status": "error",   "error": "HTTP 429 from target site" },
    { "id": "intern",  "name": "Intern",  "status": "idle" }
  ]
}
```

A bare array of agents is accepted too.

| Field | Required | Notes |
| --- | --- | --- |
| `id` | yes | Stable identifier; the character keeps its look and desk while the id stays the same. Falls back to `name`. |
| `name` | yes | Shown above the character and on the card. |
| `role` | no | Shown on the card. |
| `status` | yes | One of `running`, `idle`, `error`, `paused`, `waiting`. Aliases: `working`/`busy`/`active` → running; `done`/`finished` → idle; `failed` → error; `sleeping`/`stopped`/`offline` → paused; `blocked`/`needs_input`/`permission` → waiting. Unknown values count as idle. |
| `task` | no | A string, or `{ "id", "title", "url" }`. Shown in the bubble while typing and on the card; `url` makes it a link. |
| `error` | no | Text shown on the card when `status` is `error`. |
| `completedAt` | no | Timestamp (ISO date or milliseconds since epoch) of the last successfully completed turn. Keep it until the next success; initialize it to `null`. Telegram detects a new timestamp even if a short turn finishes between polls. Do not change it for failures, cancellation or inactivity. If omitted, completion is inferred only from an observed `running` → `idle` transition. |
| `parent` | no | The `id` of the agent that started this one (a subagent). When it appears, an envelope flies from the parent's desk to it. |
| `recent` | no | The last steps, oldest first: `[[startedAtMs, "Bash: npm test", durationMs], ...]` (duration optional while a step runs). Shown as "Last steps" on the card; at most 10 are kept, and `--redact` cuts each to the tool name. |
| `since` | no | Creation timestamp (any sortable value). Decides desk order; defaults to array order. |
| `company` | no | Top-level; shown in the header. |

## Status → behaviour

| Status | In the office |
| --- | --- |
| `running` | At the desk, monitor on, typing; bubble shows the task |
| `waiting` | At the desk, hand up, amber blinking monitor; bubble "✋ needs you" |
| `error` | Slumped at the desk, red flashing monitor; error text on the card |
| `idle` | Wanders the lounge; "✓ done" right after a run |
| `paused` | In the lounge, "zZ" |

## Writing a feed from a script

Any language works. Write to a temp file and rename it so Cubicle never reads a half-written file:

```python
import json, os
feed = {"company": "My crew", "agents": [{"id": "a1", "name": "Alpha", "status": "running", "task": "Indexing"}]}
with open("agents.json.tmp", "w") as f:
    json.dump(feed, f)
os.replace("agents.json.tmp", "agents.json")
```
