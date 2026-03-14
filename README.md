# openintern3

English | [简体中文](./README.zh-CN.md)

`openintern3` is a plugin-first workflow engine inspired by microkernel design.

The kernel stays small. Plugins own runtime state, capabilities, SDK integration, and business logic. Cross-plugin coordination happens through the event bus and the capability registry/invoker.

## Current Status

The project is runnable and already supports:

- Plugin lifecycle management through `Application`
- Capability registration and invocation
- Event bus based channel routing
- Interactive CLI with persistent history in `.openintern3/history`
- Agent sessions persisted in `.openintern3/agent/sessions`
- Channel integrations for WhatsApp and WeCom
- Optional Feishu plugin implementation in the repo
- Web search capability
- Terminal execution capability
- Cron scheduling capability
- Echo test capability

## Architecture

- `src/kernel/`: plugin lifecycle, event bus, logger, capability base types
- `src/service/`: capability registry and invocation services
- `src/application.ts`: mounts plugins and registers capabilities
- `src/index.ts`: CLI entrypoint
- `plugins/*`: isolated runtime units

Core rules:

- Everything is a plugin
- The kernel does not implement business features
- Plugins expose capabilities
- Plugins should collaborate through capabilities and events

## Default Plugins

The current entrypoint loads these plugins by default:

- `echo`
- `cron`
- `web-search`
- `agent`
- `terminals`
- `whatsapp`
- `wecom`

`feishu` exists in the repository, but it is not enabled in the current default `src/index.ts`.

## Current Capabilities

Loaded by default:

- `echo.ping`
- `cron.add`
- `cron.delete`
- `cron.list`
- `web_search.search`
- `agent.spawn`
- `terminals.start`
- `terminals.list`
- `terminals.tail`
- `terminals.kill`
- `terminals.exec`
- `whatsapp.start`
- `whatsapp.stop`
- `whatsapp.status`
- `whatsapp.send_message`
- `whatsapp.pull_messages`
- `wecom.start`
- `wecom.stop`
- `wecom.status`
- `wecom.send_message`
- `wecom.pull_messages`

Implemented in the repo but not loaded by default:

- `feishu.start`
- `feishu.stop`
- `feishu.status`
- `feishu.send_message`
- `feishu.pull_messages`

## Features By Plugin

### Agent

- Receives channel messages from the `channel` namespace
- Runs multi-step tool/capability loops
- Persists session history on disk
- Supports provider-side tool calling
- Streams user-visible progress messages back to CLI and channels
- Supports subagent spawning through `agent.spawn`

### Terminals

- Starts background shell processes
- Executes one-shot commands
- Stores terminal output under `.openintern3/terminals/output`
- Lists, tails, and kills managed processes

### Web Search

- Exposes a web search capability for the agent

### WhatsApp

- QR login flow
- Auth state under `.openintern3/whatsapp/auth`
- Media saved under `.openintern3/whatsapp/media`
- Inbound messages forwarded to the agent through the event bus

### WeCom

- WebSocket based bot connection
- Media saved under `.openintern3/wecom/media`
- Inbound messages forwarded to the agent through the event bus

### Feishu

- Plugin implementation is present
- Start/stop/status/send/pull capabilities are implemented
- Not enabled in the current default entrypoint

## Run

Install root dependencies:

```bash
bun install
```

Start the CLI:

```bash
bun run dev
```

You can also use:

```bash
bun run start
```

## CLI

Useful commands:

```text
/help
/plugin list
/plugin get agent
/plugin wecom start
/plugin whatsapp start
/plugin terminals exec "uname -a"
```

CLI history is appended to:

```text
.openintern3/history
```

## Environment

Common agent/provider variables:

```env
AGENT_PROVIDER_API_KEY=...
AGENT_PROVIDER_API_BASE=...
AGENT_PROVIDER_DEFAULT_MODEL=...
```

Example channel variables:

```env
WHATSAPP_ENABLED=true
WECOM_ENABLED=true
WECOM_BOT_ID=...
WECOM_SECRET=...
```

See plugin source files for the full set of optional environment variables.

## Type Check

```bash
./node_modules/.bin/tsc --noEmit
```
