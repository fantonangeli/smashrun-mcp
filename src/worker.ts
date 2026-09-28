import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createSmashrunServer } from "./index.js";

export default {
  async fetch(request: Request): Promise<Response> {
    if (new URL(request.url).pathname !== "/mcp") {
      return new Response(null, { status: 404 });
    }

    if (request.method !== "POST") {
      return Response.json(
        { jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null },
        {
          status: 405,
          headers: { Allow: "POST" },
        }
      );
    }

    const server = createSmashrunServer();
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });

    await server.connect(transport);
    return transport.handleRequest(request);
  },
};
