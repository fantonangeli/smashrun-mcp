import { OAuthProvider, insufficientScope } from "@cloudflare/workers-oauth-provider";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createSmashrunServer } from "./index.js";
import { MCP_SCOPE, oauthHandler, type Env } from "./oauth.js";

const mcpHandler = {
  async fetch(request: Request, env: Env, ctx: any): Promise<Response> {
    if (!ctx.auth?.scope?.includes(MCP_SCOPE)) {
      return insufficientScope(ctx.auth, [MCP_SCOPE]);
    }

    if (request.method !== "POST") {
      return Response.json(
        { jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null },
        { status: 405, headers: { Allow: "POST" } }
      );
    }

    const server = createSmashrunServer(env.SMASHRUN_ACCESS_TOKEN);
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(transport);
    return transport.handleRequest(request);
  },
};

export default {
  async fetch(request: Request, env: Env, ctx: any): Promise<Response> {
    const origin = new URL(request.url).origin;
    const provider = new OAuthProvider<Env>({
      apiRoute: "/mcp",
      apiHandler: mcpHandler,
      defaultHandler: oauthHandler,
      authorizeEndpoint: "/authorize",
      tokenEndpoint: "/oauth/token",
      clientIdMetadataDocumentEnabled: true,
      scopesSupported: [MCP_SCOPE],
      requiredScopes: [MCP_SCOPE],
      resourceMetadata: {
        resource: `${origin}/mcp`,
        authorization_servers: [origin],
        bearer_methods_supported: ["header"],
        resource_name: "Smashrun MCP",
      },
    });
    return provider.fetch(request, env, ctx);
  },
};
