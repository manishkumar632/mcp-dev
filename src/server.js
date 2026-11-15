import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

export function createServer(){
  const server = new McpServer({
    name: "mcp-starter",
    version: "1.0.0",
  });

  server.registerTool(
    "echo",
    {
      description: "Repeat a message. Replace this example with a useful tool.",
      inputSchema: z.object({
        message: z.string().min(1).describe("The message to repeat"),
      }),
    },
    async ({ message }) => ({
      content: [{ type: "text", text: message }],
    }),
  );

  return server;
}