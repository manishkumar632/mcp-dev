# mcp-dev

A JavaScript MCP server with a greeting tool and a small allowlist of local
diagnostic commands.

## Requirements

- Node.js 20 or newer
- npm

## Install and run

```sh
npm install
npm start
```

The server uses stdio, so it waits for an MCP client and may appear idle when
started directly. Do not write logs to stdout; it is reserved for MCP messages.

For automatic restarts while editing:

```sh
npm run dev
```

## Test with MCP Inspector

```sh
npm run inspect
```

The Inspector launches the server. In its browser UI, connect, open **Tools**,
and try:

- `greet` with `{ "name": "Sam" }`
- `run-diagnostic` with `{ "commandId": "node-version" }`
- `run-diagnostic` with `{ "commandId": "git-version" }`

The diagnostic tool deliberately accepts only these approved command IDs; it
does not execute arbitrary command strings.