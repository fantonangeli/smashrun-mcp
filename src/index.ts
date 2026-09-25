#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { serveHttp } from "./http.js";
import { z } from "zod";

const BASE_URL = "https://api.smashrun.com/v1";

function getToken(): string {
  const token = process.env.SMASHRUN_ACCESS_TOKEN;
  if (!token) {
    throw new Error(
      'SMASHRUN_ACCESS_TOKEN environment variable is not set. ' +
        'Get a token at https://api.smashrun.com/explorer (enter client id "client" and connect), ' +
        "then set it in your MCP server config."
    );
  }
  return token;
}

async function smashrunGet(
  path: string,
  params?: Record<string, string | number | undefined>
): Promise<unknown> {
  const url = new URL(`${BASE_URL}${path}`);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }
  }
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${getToken()}`,
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    let hint = "";
    if (res.status === 401) {
      hint =
        " Your access token is invalid or expired. User-level tokens expire after ~60 days; " +
        "get a new one at https://api.smashrun.com/explorer.";
    } else if (res.status === 429) {
      hint = " Rate limit exceeded (user-level tokens allow 250 requests/hour).";
    }
    throw new Error(`Smashrun API error ${res.status} ${res.statusText}: ${body}${hint}`);
  }
  return res.json();
}

function jsonResult(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}

function errorResult(err: unknown) {
  return {
    content: [
      { type: "text" as const, text: err instanceof Error ? err.message : String(err) },
    ],
    isError: true,
  };
}

async function run(fn: () => Promise<unknown>) {
  try {
    return jsonResult(await fn());
  } catch (err) {
    return errorResult(err);
  }
}

function createSmashrunServer() {
  const server = new McpServer({
    name: "smashrun",
    version: "1.0.0",
  });

server.registerTool(
  "get_user_info",
  {
    title: "Get user info",
    description:
      "Get profile and settings of the authenticated Smashrun user: name, username, distance/weight units, " +
      "heart rate settings, follower counts, time zone, date of last run, and when run data last changed.",
    inputSchema: {},
  },
  async () => run(() => smashrunGet("/my/userinfo"))
);

server.registerTool(
  "list_activities",
  {
    title: "List activities",
    description:
      "List the authenticated user's runs (newest first) with paging. " +
      "Styles: 'summary' (default), 'briefs' (minimal fields), 'ids' (IDs only), " +
      "'extended' (includes badge-related fields). Use fromDateUTC to fetch only new/updated runs since a date.",
    inputSchema: {
      page: z.number().int().min(0).optional().describe("Zero-based page number (default 0)"),
      count: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .describe("Number of runs per page (default 25, max 100)"),
      fromDateUTC: z
        .number()
        .int()
        .optional()
        .describe("Unix timestamp (seconds); only return runs created or updated since this date"),
      style: z
        .enum(["summary", "briefs", "ids", "extended"])
        .optional()
        .describe("Level of detail to return (default 'summary')"),
    },
  },
  async ({ page, count, fromDateUTC, style }) =>
    run(() => {
      const suffix = style && style !== "summary" ? `/${style}` : "";
      return smashrunGet(`/my/activities/search${suffix}`, {
        page: page ?? 0,
        count: count ?? 25,
        fromDateUTC,
      });
    })
);

server.registerTool(
  "get_activity",
  {
    title: "Get activity details",
    description:
      "Get the full details of a single run by its activity ID, including distance, duration, pace, " +
      "heart rate, cadence, weather, and per-second recording data if available.",
    inputSchema: {
      activityId: z.union([z.string(), z.number()]).describe("The Smashrun activity (run) ID"),
    },
  },
  async ({ activityId }) => run(() => smashrunGet(`/my/activities/${activityId}`))
);

server.registerTool(
  "get_activity_notables",
  {
    title: "Get activity notables",
    description:
      "Get the notables for a run: achievements comparing it against all prior runs " +
      "(e.g. fastest 5 km in 3 months, longest run ever).",
    inputSchema: {
      activityId: z.union([z.string(), z.number()]).describe("The Smashrun activity (run) ID"),
    },
  },
  async ({ activityId }) => run(() => smashrunGet(`/my/activities/${activityId}/notables`))
);

server.registerTool(
  "get_activity_splits",
  {
    title: "Get activity splits",
    description:
      "Get per-kilometer or per-mile splits for a run, with speed and average heart rate (if available).",
    inputSchema: {
      activityId: z.union([z.string(), z.number()]).describe("The Smashrun activity (run) ID"),
      unit: z.enum(["km", "mi"]).optional().describe("Split unit: 'km' or 'mi' (default 'km')"),
    },
  },
  async ({ activityId, unit }) =>
    run(() => smashrunGet(`/my/activities/${activityId}/splits/${unit ?? "km"}`))
);

server.registerTool(
  "get_activity_tags",
  {
    title: "Get activity tags",
    description:
      "Get all tags applied to a run as an array of strings, including built-in tags " +
      "(e.g. 'long run', 'negative split') and user-added tags.",
    inputSchema: {
      activityId: z.union([z.string(), z.number()]).describe("The Smashrun activity (run) ID"),
    },
  },
  async ({ activityId }) => run(() => smashrunGet(`/my/activities/${activityId}/tags`))
);

server.registerTool(
  "get_activity_polyline",
  {
    title: "Get activity route polyline",
    description:
      "Get the GPS route of a run as a polyline. Styles: 'google' (encoded polyline, default), " +
      "'svg', or 'geojson'.",
    inputSchema: {
      activityId: z.union([z.string(), z.number()]).describe("The Smashrun activity (run) ID"),
      style: z
        .enum(["google", "svg", "geojson"])
        .optional()
        .describe("Polyline format (default 'google')"),
    },
  },
  async ({ activityId, style }) =>
    run(() => {
      const suffix = style && style !== "google" ? `/${style}` : "";
      return smashrunGet(`/my/activities/${activityId}/polyline${suffix}`);
    })
);

server.registerTool(
  "get_badges",
  {
    title: "Get earned badges",
    description: "Get all badges the authenticated user has earned on Smashrun.",
    inputSchema: {},
  },
  async () => run(() => smashrunGet("/my/badges"))
);

server.registerTool(
  "get_stats",
  {
    title: "Get aggregate stats",
    description:
      "Get aggregate running stats (totals, averages) for the authenticated user. " +
      "Omit year and month for all-time stats, pass year only for a yearly view, " +
      "or pass year and month for a monthly view.",
    inputSchema: {
      year: z.number().int().optional().describe("Year, e.g. 2025"),
      month: z
        .number()
        .int()
        .min(1)
        .max(12)
        .optional()
        .describe("Month 1-12 (requires year)"),
    },
  },
  async ({ year, month }) =>
    run(() => {
      if (month !== undefined && year === undefined) {
        throw new Error("month cannot be specified without year");
      }
      let path = "/my/stats";
      if (year !== undefined) path += `/${year}`;
      if (month !== undefined) path += `/${month}`;
      return smashrunGet(path);
    })
);

server.registerTool(
  "get_goals",
  {
    title: "Get goals",
    description:
      "Get the user's running goals for a year, or a specific month if given (January = 1). " +
      "A goal can contain a text description and/or a target distance. Returns null if no goal is set.",
    inputSchema: {
      year: z.number().int().describe("Year, e.g. 2025"),
      month: z
        .number()
        .int()
        .min(1)
        .max(12)
        .optional()
        .describe("Month 1-12; omit for the yearly goal"),
    },
  },
  async ({ year, month }) =>
    run(() => {
      let path = `/my/goals/${year}`;
      if (month !== undefined) path += `/${month}`;
      return smashrunGet(path);
    })
);

server.registerTool(
  "get_weight",
  {
    title: "Get body weight",
    description:
      "Get the user's body weight recordings. Set latestOnly to true to return only the most recent recording.",
    inputSchema: {
      latestOnly: z
        .boolean()
        .optional()
        .describe("If true, return only the most recent weight recording (default false)"),
    },
  },
  async ({ latestOnly }) =>
    run(() => smashrunGet(latestOnly ? "/my/body/weight/latest" : "/my/body/weight"))
);

  return server;
}

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
