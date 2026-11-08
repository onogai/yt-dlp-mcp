import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer, initialize } from "./index.mjs";

const port = Number(process.env.PORT || 8770);
const maxBodyBytes = 1024 * 1024;

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.url === "/health" && req.method === "GET") {
    res.writeHead(200, { "content-type": "text/plain" }).end("ok");
    return;
  }
  if (req.url !== "/mcp" || req.method !== "POST") {
    res.writeHead(404).end();
    return;
  }
  // The gateway is the only intended client on the private Compose network.
  if (req.headers.host !== `ytdlp:${port}` || req.headers.origin) {
    res.writeHead(403).end();
    return;
  }
  const length = Number(req.headers["content-length"]);
  if (Number.isFinite(length) && length > maxBodyBytes) {
    res.writeHead(413).end();
    return;
  }
  let bytes = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > maxBodyBytes) {
      res.writeHead(413).end();
      return;
    }
    chunks.push(chunk);
  }
  let body: unknown;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    res.writeHead(400).end();
    return;
  }
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  const server = createServer();
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  } finally {
    await transport.close();
    await server.close();
  }
}

async function startHttpServer(): Promise<void> {
  await initialize();
  createHttpServer((req, res) => {
    handle(req, res).catch((error: unknown) => {
      console.error("MCP request failed", error);
      if (!res.headersSent) res.writeHead(500).end();
    });
  }).listen(port, "0.0.0.0");
}

startHttpServer().catch(console.error);
