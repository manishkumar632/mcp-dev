import { createMcpExpressApp } from "@modelcontextprotocol/express";
import { toNodeHandler } from "@modelcontextprotocol/node";
import {
    createMcpHandler,
    localhostAllowedHostnames,
    localhostAllowedOrigins,
} from "@modelcontextprotocol/server";
import { createServer } from "./server.js";

const host = "0.0.0.0";
const port = Number(process.env.PORT ?? "5000");

if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`PORT must be a valid TCP port, received: ${process.env.PORT}`);
}

function splitList(value) {
    return (value ?? "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
}

function parseAllowedOrigins(value) {
    return splitList(value).map((origin) => {
        let url;
        try {
            url = new URL(origin);
        } catch {
            throw new Error(
                `MCP_ALLOWED_ORIGINS must contain full origins such as https://agent.example; received: ${origin}`,
            );
        }

        if (
            (url.protocol !== "https:" && url.hostname !== "localhost" &&
                url.hostname !== "127.0.0.1" && url.hostname !== "[::1]") ||
            url.username ||
            url.password ||
            url.pathname !== "/" ||
            url.search ||
            url.hash
        ) {
            throw new Error(
                `MCP_ALLOWED_ORIGINS must be HTTPS origins (HTTP is allowed for localhost): ${origin}`,
            );
        }

        return url;
    });
}

const configuredOrigins = parseAllowedOrigins(
    process.env.MCP_ALLOWED_ORIGINS,
);
const originHostnames = configuredOrigins.map((origin) => origin.hostname);
const allowedHosts = [
    ...new Set([
        ...localhostAllowedHostnames(),
        ...splitList(process.env.REPLIT_DEV_DOMAIN),
        ...splitList(process.env.MCP_ALLOWED_HOSTS),
    ]),
];
const allowedOrigins = [
    ...new Set([...localhostAllowedOrigins(), ...originHostnames]),
];

const app = createMcpExpressApp({
    host,
    allowedHosts,
    allowedOrigins,
});

const handler = createMcpHandler(createServer);
const nodeHandler = toNodeHandler(handler);

app.use((req, res, next) => {
    const origin = req.get("Origin");
    if (origin) {
        let requestOrigin;
        try {
            requestOrigin = new URL(origin);
        } catch {
            res.sendStatus(403);
            return;
        }

        const isLocalOrigin =
            requestOrigin.hostname === "localhost" ||
            requestOrigin.hostname === "127.0.0.1" ||
            requestOrigin.hostname === "[::1]";
        const isConfiguredOrigin = configuredOrigins.some(
            (configured) => configured.origin === requestOrigin.origin,
        );

        if (!isLocalOrigin && !isConfiguredOrigin) {
            res.sendStatus(403);
            return;
        }

        res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader("Vary", "Origin");
        res.setHeader(
            "Access-Control-Allow-Methods",
            "GET, POST, DELETE, OPTIONS",
        );
        res.setHeader(
            "Access-Control-Allow-Headers",
            "Accept, Authorization, Content-Type, Last-Event-ID, MCP-Protocol-Version, Mcp-Session-Id",
        );
        res.setHeader(
            "Access-Control-Expose-Headers",
            "MCP-Protocol-Version, Mcp-Session-Id, Last-Event-ID",
        );
    }

    if (req.method === "OPTIONS") {
        res.sendStatus(204);
        return;
    }

    next();
});

app.get("/", (_req, res) => {
    res.json({
        name: "mcp-starter",
        status: "ready",
        transport: "Streamable HTTP",
        endpoint: "/mcp",
    });
});

app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
});

app.all("/mcp", (req, res) => {
    void nodeHandler(req, res, req.body);
});

const httpServer = app.listen(port, host, () => {
    console.error(
        `mcp-starter Streamable HTTP server listening on ${host}:${port}/mcp`,
    );
});

async function shutdown() {
    await handler.close();
    await new Promise((resolve, reject) => {
        httpServer.close((error) => (error ? reject(error) : resolve()));
    });
}

process.once("SIGINT", () => {
    void shutdown().catch((error) => {
        console.error("Failed to shut down MCP server cleanly:", error);
        process.exitCode = 1;
    });
});
process.once("SIGTERM", () => {
    void shutdown().catch((error) => {
        console.error("Failed to shut down MCP server cleanly:", error);
        process.exitCode = 1;
    });
});
