import { createServer as createHttpServer } from "node:http";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

export function serveHttp(createMcpServer: () => McpServer) {
  const host = process.env.MCP_HOST ?? "127.0.0.1";
  const port = Number(process.env.MCP_PORT ?? 3000);

  createHttpServer(async (req, res) => {
    if (new URL(req.url ?? "/", "http://localhost").pathname !== "/mcp") {
      res.writeHead(404).end();
      return;
    }

    const server = createMcpServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res);
    } catch (err) {
      console.error("[smashrun-mcp] HTTP request failed:", err);
      if (!res.headersSent) {
        res.writeHead(500).end();
      }
    } finally {
      await server.close();
    }
  }).listen(port, host, () => {
    console.error(
      `[smashrun-mcp] Smashrun MCP server running on Streamable HTTP at http://${host}:${port}/mcp`
    );
  });
}
