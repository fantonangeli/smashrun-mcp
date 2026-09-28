#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { serveHttp } from "./http.js";
import { createSmashrunServer } from "./index.js";

async function main() {
  if (!process.env.SMASHRUN_ACCESS_TOKEN) {
    console.error(
      "[smashrun-mcp] Warning: SMASHRUN_ACCESS_TOKEN is not set; tool calls will fail until it is provided."
    );
  }
  const transportArg = process.argv.indexOf("--transport");
  const transportName = transportArg >= 0 ? process.argv[transportArg + 1] : "stdio";

  if (transportName === "http") {
    serveHttp(createSmashrunServer);
    return;
  }
  if (transportName !== "stdio") {
    throw new Error(`Unsupported transport: ${transportName}`);
  }

  const server = createSmashrunServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[smashrun-mcp] Smashrun MCP server running on stdio");
}

main().catch((err) => {
  console.error("[smashrun-mcp] Fatal error:", err);
  process.exit(1);
});
