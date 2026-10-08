import {
  AuthorizationError,
  CimdFetchError,
  authorizationErrorRedirect,
  type AuthRequest,
  type ConsentDescription,
  type OAuthHelpers,
} from "@cloudflare/workers-oauth-provider";

export const MCP_SCOPE = "mcp:read";
const CHATGPT_CLIENT_ID = "https://chatgpt.com/oauth/client.json";

export interface Env {
  OAUTH_KV: any;
  OAUTH_PROVIDER?: OAuthHelpers;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  ALLOWED_GITHUB_USER_ID: string;
  SMASHRUN_ACCESS_TOKEN: string;
}

function oauth(env: Env): OAuthHelpers {
  if (!env.OAUTH_PROVIDER) throw new Error("OAuth provider unavailable.");
  return env.OAUTH_PROVIDER;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

function consentPage(details: ConsentDescription, handle: string): string {
  return `<!doctype html>
<meta charset="utf-8">
<title>Authorize Smashrun MCP</title>
<h1>Allow ${escapeHtml(details.clientName)}${details.clientDomain ? ` (${escapeHtml(details.clientDomain)})` : ""}?</h1>
<p>Access: <strong>${MCP_SCOPE}</strong></p>
<p>Access will be sent to <strong>${escapeHtml(details.redirectHost)}</strong>.</p>
${details.redirectIsLoopback ? "<p><strong>The callback is a local application.</strong></p>" : ""}
<form method="post" action="/authorize">
<input type="hidden" name="handle" value="${escapeHtml(handle)}">
<button name="decision" value="approve">Allow</button>
<button name="decision" value="deny">Deny</button>
</form>`;
}

async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function callbackUrl(request: Request): string {
  return `${new URL(request.url).origin}/callback`;
}

function oauthRedirect(
  request: AuthRequest,
  headers: Headers,
  code: "access_denied" | "server_error",
  description: string
): Response {
  headers.set("Location", authorizationErrorRedirect(request, code, description));
  return new Response(null, { status: 302, headers });
}

function errorResponse(error: unknown): Response {
  if (error instanceof AuthorizationError) {
    if (error.redirectTo) return Response.redirect(error.redirectTo, 302);
    return new Response(error.description, { status: 400 });
  }
  if (error instanceof CimdFetchError) {
    return new Response("OAuth client metadata could not be verified.", { status: 400 });
  }
  console.error(error);
  return new Response("OAuth authorization failed.", { status: 500 });
}

async function startGitHubLogin(
  request: Request,
  env: Env,
  authRequest: AuthRequest,
  headers: Headers
): Promise<Response> {
  const verifier = `${crypto.randomUUID()}${crypto.randomUUID()}`;
  const upstream = await oauth(env).beginUpstream(authRequest, { data: { verifier }, headers });
  const github = new URL("https://github.com/login/oauth/authorize");
  github.searchParams.set("client_id", env.GITHUB_CLIENT_ID);
  github.searchParams.set("redirect_uri", callbackUrl(request));
  github.searchParams.set("state", upstream.state);
  github.searchParams.set("code_challenge", await pkceChallenge(verifier));
  github.searchParams.set("code_challenge_method", "S256");
  upstream.headers.set("Location", github.toString());
  return new Response(null, { status: 302, headers: upstream.headers });
}

async function authorize(request: Request, env: Env): Promise<Response> {
  const provider = oauth(env);

  if (request.method === "GET") {
    if (new URL(request.url).searchParams.get("client_id") !== CHATGPT_CLIENT_ID) {
      return Response.json(
        { error: "unauthorized_client", error_description: "Only ChatGPT is allowed." },
        { status: 400 }
      );
    }

    const authRequest = await provider.parseAuthRequest(request);
    const details = await provider.describeConsent(authRequest);
    const consent = await provider.beginConsent(authRequest);
    consent.headers.set("Content-Type", "text/html; charset=utf-8");
    return new Response(consentPage(details, consent.handle), { headers: consent.headers });
  }

  if (request.method === "POST") {
    const form = await request.formData();
    const handle = String(form.get("handle") ?? "");
    if (form.get("decision") !== "approve") {
      const denied = await provider.denyConsent(request, handle);
      return new Response(null, { status: 302, headers: denied.headers });
    }

    const approved = await provider.approveConsent(request, handle, { scope: [MCP_SCOPE] });
    if (approved.request.clientId !== CHATGPT_CLIENT_ID) {
      return oauthRedirect(approved.request, approved.headers, "access_denied", "OAuth client not allowed.");
    }
    return startGitHubLogin(request, env, approved.request, approved.headers);
  }

  return new Response(null, { status: 405, headers: { Allow: "GET, POST" } });
}

async function githubUserId(request: Request, env: Env, code: string, verifier: string): Promise<string | undefined> {
  const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: callbackUrl(request),
      code_verifier: verifier,
    }),
  });
  const token = (await tokenResponse.json()) as { access_token?: string };
  if (!tokenResponse.ok || !token.access_token) return undefined;

  const userResponse = await fetch("https://api.github.com/user", {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token.access_token}`,
      "User-Agent": "smashrun-mcp",
    },
  });
  const user = (await userResponse.json()) as { id?: number };
  return userResponse.ok && user.id !== undefined ? String(user.id) : undefined;
}

async function callback(request: Request, env: Env): Promise<Response> {
  const provider = oauth(env);
  const resumed = await provider.finishUpstream<{ verifier: string }>(request);
  const params = new URL(request.url).searchParams;

  if (params.has("error")) {
    return oauthRedirect(resumed.request, resumed.headers, "access_denied", "GitHub authorization was denied.");
  }

  const code = params.get("code");
  if (!code) {
    return oauthRedirect(resumed.request, resumed.headers, "server_error", "GitHub did not return a code.");
  }

  const userId = await githubUserId(request, env, code, resumed.data.verifier);
  if (!userId) {
    return oauthRedirect(resumed.request, resumed.headers, "server_error", "GitHub sign-in failed.");
  }
  if (userId !== env.ALLOWED_GITHUB_USER_ID) {
    return oauthRedirect(resumed.request, resumed.headers, "access_denied", "GitHub account not authorized.");
  }

  const { redirectTo } = await provider.completeAuthorization({
    request: resumed.request,
    userId,
    metadata: { provider: "github" },
    scope: [MCP_SCOPE],
    props: {},
  });
  resumed.headers.set("Location", redirectTo);
  return new Response(null, { status: 302, headers: resumed.headers });
}

export const oauthHandler = {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      const path = new URL(request.url).pathname;
      if (path === "/authorize") return await authorize(request, env);
      if (path === "/callback" && request.method === "GET") return await callback(request, env);
      return new Response(null, { status: 404 });
    } catch (error) {
      return errorResponse(error);
    }
  },
};
