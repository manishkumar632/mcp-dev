// commandTools.js
// Cross-platform (Windows / macOS / Linux) command tool for an MCP v2 server.
//
// Usage in your server file:
//   import { McpServer } from "@modelcontextprotocol/server";
//   import { serveStdio } from "@modelcontextprotocol/server/stdio";
//   import { registerCommandTools } from "./commandTools.js";
//
//   function createServer() {
//     const server = new McpServer({ name: "terminal", version: "1.0.0" });
//     registerCommandTools(server);
//     return server;
//   }
//   serveStdio(createServer);
//
// IMPORTANT: never use console.log in a stdio server, it corrupts the
// JSON-RPC stream. Use console.error for debugging.

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as z from "zod/v4";

const IS_WIN = process.platform === "win32";

// Default working directory. NOT a restriction: any directory may be passed as `cwd`.
const DEFAULT_CWD = path.resolve(process.env.MCP_CWD ?? process.cwd());

// Defaults, overridable per call (timeout_ms) or via environment variables.
const DEFAULT_TIMEOUT_MS = Number(process.env.MCP_TIMEOUT_MS ?? 120_000);
const MAX_TIMEOUT_MS = 60 * 60 * 1000; // hard ceiling: 1 hour
const MAX_OUTPUT_BYTES = Number(process.env.MCP_MAX_OUTPUT_BYTES ?? 4 * 1024 * 1024); // per stream

// On Windows these are .cmd/.bat wrappers that cannot be launched without a shell.
const WIN_CMD_WRAPPERS = new Set([
    "npm", "npx", "yarn", "pnpm", "flutter", "dart", "code", "gradlew", "mvn",
]);

// Characters that cmd.exe would interpret. We reject them when a shell is required.
const CMD_UNSAFE = /[&|<>^%"!`\r\n]/;

function needsWindowsShell(command) {
    if (!IS_WIN) return false;
    const base = path.basename(command).toLowerCase();
    if (/\.(cmd|bat)$/.test(base)) return true;
    return WIN_CMD_WRAPPERS.has(base.replace(/\.exe$/, ""));
}

function quoteForCmd(arg) {
    return /[\s]/.test(arg) ? `"${arg}"` : arg;
}

function killTree(child) {
    if (!child.pid) return;
    try {
        if (IS_WIN) {
            spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
                windowsHide: true,
                stdio: "ignore",
            });
        } else {
            process.kill(-child.pid, "SIGKILL"); // whole process group
        }
    } catch {
        try {
            child.kill("SIGKILL");
        } catch {
            /* already gone */
        }
    }
}

function fail(text) {
    return { isError: true, content: [{ type: "text", text }] };
}

function run({ command, args, cwd, timeoutMs }) {
    return new Promise((resolve) => {
        const useShell = needsWindowsShell(command);

        if (useShell) {
            for (const a of [command, ...args]) {
                if (CMD_UNSAFE.test(a)) {
                    return resolve(
                        fail(
                            `Argument contains characters not allowed for Windows batch commands: ${a}`
                        )
                    );
                }
            }
        }

        let child;
        try {
            child = spawn(command, useShell ? args.map(quoteForCmd) : args, {
                cwd,
                shell: useShell,
                windowsHide: true,
                detached: !IS_WIN, // own process group on Unix so we can kill the tree
                stdio: ["ignore", "pipe", "pipe"],
                env: process.env,
            });
        } catch (err) {
            return resolve(fail(`Failed to start: ${err.message}`));
        }

        let stdout = "";
        let stderr = "";
        let outBytes = 0;
        let errBytes = 0;
        let truncated = false;
        let timedOut = false;
        let spawnError = null;

        const collect = (chunk, which) => {
            const size = chunk.length;
            if (which === "out") {
                if (outBytes < MAX_OUTPUT_BYTES) stdout += chunk.toString("utf8");
                else truncated = true;
                outBytes += size;
            } else {
                if (errBytes < MAX_OUTPUT_BYTES) stderr += chunk.toString("utf8");
                else truncated = true;
                errBytes += size;
            }
        };

        child.stdout.on("data", (c) => collect(c, "out"));
        child.stderr.on("data", (c) => collect(c, "err"));

        const timer = setTimeout(() => {
            timedOut = true;
            killTree(child);
        }, timeoutMs);

        child.on("error", (err) => {
            spawnError = err;
        });

        child.on("close", (code, signal) => {
            clearTimeout(timer);

            if (spawnError) {
                const hint =
                    spawnError.code === "ENOENT"
                        ? ` Executable not found: "${command}". Check the name and PATH` +
                        (IS_WIN ? " (on Windows, shell builtins like dir/echo need 'powershell' or 'cmd')." : ".")
                        : "";
                return resolve(fail(`Failed to run: ${spawnError.message}.${hint}`));
            }

            const exitCode = code ?? (signal ? `signal ${signal}` : 1);
            let text =
                `exit=${exitCode}\n` +
                `stdout:\n${stdout}\n` +
                `stderr:\n${stderr}`;
            if (truncated) text += `\n[output truncated at ${MAX_OUTPUT_BYTES} bytes per stream]`;
            if (timedOut) text += `\n[killed after ${timeoutMs / 1000}s timeout]`;

            resolve({
                isError: timedOut || code !== 0,
                content: [{ type: "text", text }],
            });
        });
    });
}

function platformHint() {
    const base = `Host OS: ${process.platform} ${os.release()}. `;
    return IS_WIN
        ? base +
        "Shell builtins (dir, echo, type) and pipes need: command='powershell', " +
        "args=['-NoProfile','-Command','<script>']. "
        : base +
        "For pipes, redirects or && use: command='bash' (or 'sh'), args=['-c','<script>']. ";
}

export function registerCommandTools(server) {
    server.registerTool(
        "shell_exec",
        {
            description:
                "Run a command on this machine and return exit code, stdout and stderr. " +
                platformHint() +
                "Put the executable name or path in `command` and its arguments in `args` " +
                "(one per array item). Commands run directly, not through a shell, so pipes, " +
                "redirects and && are not interpreted unless you invoke a shell yourself. " +
                `Any working directory is allowed (default: ${DEFAULT_CWD}). ` +
                `Default timeout ${DEFAULT_TIMEOUT_MS / 1000}s (override with timeout_ms), ` +
                `output capped at ${MAX_OUTPUT_BYTES} bytes per stream.`,
            inputSchema: z.object({
                command: z.string().min(1).describe("Name or path of an executable on this machine"),
                args: z
                    .array(z.string())
                    .default([])
                    .describe("Arguments passed to the executable, one per array item"),
                cwd: z
                    .string()
                    .optional()
                    .describe("Working directory, absolute or relative to the default directory"),
                timeout_ms: z
                    .number()
                    .int()
                    .positive()
                    .optional()
                    .describe("Timeout in milliseconds (max 3600000)"),
            }),
        },
        async ({ command, args, cwd, timeout_ms }) => {
            const workDir = path.resolve(DEFAULT_CWD, cwd ?? ".");
            try {
                if (!fs.statSync(workDir).isDirectory()) {
                    return fail(`cwd is not a directory: ${workDir}`);
                }
            } catch {
                return fail(`cwd does not exist: ${workDir}`);
            }

            const timeoutMs = Math.min(timeout_ms ?? DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS);
            return run({ command, args, cwd: workDir, timeoutMs });
        }
    );
}