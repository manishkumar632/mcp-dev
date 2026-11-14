import * as z from "zod/v4";

const demoTools = new Map();

export function registerDemoTool(server, name, message) {
    if (!/^demo_[a-z0-9_-]{1,32}$/.test(name)) {
        throw new Error("Tool names must start with demo_ and contain only lowercase letters, numbers, _ or -.");
    }

    if (demoTools.has(name)) {
        throw new Error(`Tool "${name}" is already registered.`);
    }

    if (typeof message !== "string" || message.length === 0 || message.length > 200) {
        throw new Error("Message must be between 1 and 200 characters.");
    }

    const registration = server.registerTool(
        name,
        {
            description: "Return a configured demo message.",
            inputSchema: z.strictObject({}),
        },
        async () => ({
            content: [{ type: "text", text: message }],
        }),
    );

    demoTools.set(name, registration);
    return name;
}