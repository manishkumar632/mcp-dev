// index.js
import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";
import { registerCommandTools } from "./tools/registerCommandTools.js";
import { registerDemoTool } from "./tools/toolRegistry.js";

function createServer() {
  const server = new McpServer({ name: "my-server", version: "1.0.0" });

  server.registerTool(
    "greet",
    {
      description: "Greet someone by name",
      inputSchema: z.object({ name: z.string() }),
    },
    async ({ name }) => ({
      content: [{ type: "text", text: `Hello, ${name}!` }],
    }),
  );

  registerCommandTools(server);
  server.registerTool(
  "register-demo-tool",
  {
    description: "Register a demo tool that returns a configured message.",
    inputSchema: z.object({
      name: z.string().regex(/^demo_[a-z0-9_-]{1,32}$/),
      message: z.string().min(1).max(200),
    }),
  },
  async ({ name, message }) => {
    try {
      registerDemoTool(server, name, message);
      return {
        content: [{ type: "text", text: `Registered tool "${name}".` }],
      };
    } catch (error) {
      return {
        content: [{
          type: "text",
          text: error instanceof Error ? error.message : String(error),
        }],
        isError: true,
      };
    }
  },
);


  return server;
}

void serveStdio(createServer);
