import type { IncomingMessage } from "http";
import { createProxyMiddleware } from "http-proxy-middleware";
import { env } from "../config/env";

/** The Royal Touch MCP server (its own Cloud Run service) is published under this backend's
 *  /mcp, so ChatGPT sees one host: {backend}/mcp is the MCP endpoint, {backend}/mcp/login the
 *  login page. The MCP server serves the same paths at its root, so /mcp is stripped.
 *
 *  OAuth discovery lives at the host root with the resource path appended (RFC 8414 / RFC 9728),
 *  so these two are forwarded too. The authorization-server one is served by the MCP SDK
 *  without the /mcp suffix; the protected-resource one with it. */
const AUTH_SERVER_METADATA = "/.well-known/oauth-authorization-server/mcp";
const RESOURCE_METADATA = "/.well-known/oauth-protected-resource/mcp";
const MCP_PREFIX = /^\/mcp(?=\/|\?|$)/;

function isMcpPath(path: string): boolean {
  return MCP_PREFIX.test(path) || path === AUTH_SERVER_METADATA || path === RESOURCE_METADATA;
}

function rewrite(path: string): string {
  if (path.startsWith(AUTH_SERVER_METADATA)) return "/.well-known/oauth-authorization-server";
  if (path.startsWith(RESOURCE_METADATA)) return path;
  const rest = path.replace(MCP_PREFIX, "");
  return rest.startsWith("/") ? rest : `/${rest}`;
}

/** Cloud Run appends the caller's address as the last X-Forwarded-For entry; earlier entries
 *  come from the client and can be forged. */
function clientIp(req: IncomingMessage): string {
  const forwarded = req.headers["x-forwarded-for"];
  const last = (Array.isArray(forwarded) ? forwarded.join(",") : forwarded ?? "").split(",").pop()?.trim();
  return last || req.socket.remoteAddress || "";
}

/** Must be mounted before cors and the body parsers: the MCP server answers its own CORS, and
 *  the request body has to reach it as an unread stream. */
export function mcpProxy() {
  return createProxyMiddleware({
    target: env.mcpServerUrl,
    changeOrigin: true,
    pathFilter: (path) => isMcpPath(path),
    pathRewrite: (path) => rewrite(path),
    on: {
      // The MCP server rate-limits failed logins per address; without this every request
      // would look like it came from the backend. The secret is what lets it trust the header.
      proxyReq: (proxyReq, req) => {
        proxyReq.setHeader("x-client-ip", clientIp(req));
        proxyReq.setHeader("x-proxy-secret", env.mcpProxySecret);
      },
    },
  });
}
