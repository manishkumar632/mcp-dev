import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as z from "zod/v4";

const execFileAsync = promisify(execFile);

const allowedCommands = {
  "node-version": {
    file: process.execPath,
    args: ["--version"],
  },
  "git-version": {
    file: "git",
    args: ["--version"],
  },
};

export function registerCommandTools(server) {
  server.registerTool(
    "run-diagnostic",
    {
      description: "Run an approved, read-only local diagnostic.",
      inputSchema: z.object({
        commandId: z.enum(["node-version", "git-version"]),
      }),
    },
    async ({ commandId }) => {
      const { file, args } = allowedCommands[commandId];

      try {
        const { stdout, stderr } = await execFileAsync(file, args, {
          cwd: process.cwd(),
          encoding: "utf8",
          timeout: 5_000,
          maxBuffer: 16 * 1024,
          windowsHide: true,
          shell: false,
        });

        const output = [
          stdout.trim(),
          stderr.trim() && `stderr: ${stderr.trim()}`,
        ]
          .filter(Boolean)
          .join("\n");

        return {
          content: [{ type: "text", text: output || "(no output)" }],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);

        return {
          content: [{ type: "text", text: `Diagnostic failed: ${message}` }],
          isError: true,
        };
      }
    },
  );
}
