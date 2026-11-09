// Local dev server (run with `npm run dev -w server`, i.e. `tsx
// src/dev-server.ts`). Loads ../.env via dotenv if present, listens on
// PORT (default 8787), and routes every /api/* request to
// handleApiRequest, converting between node:http and the Web
// Request/Response API. No auth bypasses — it is the same code path as
// the Netlify function.

import dotenv from "dotenv";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { handleApiRequest } from "./router";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const port = Number(process.env.PORT ?? 8787);

const server = http.createServer(async (nodeReq, nodeRes) => {
  try {
    const url = `http://localhost:${port}${nodeReq.url ?? "/"}`;
    const headers = new Headers();
    for (const [key, value] of Object.entries(nodeReq.headers)) {
      if (typeof value === "string") headers.set(key, value);
      else if (Array.isArray(value)) headers.set(key, value.join(", "));
    }
    const chunks: Buffer[] = [];
    for await (const chunk of nodeReq) chunks.push(chunk as Buffer);
    const body = chunks.length > 0 ? Buffer.concat(chunks) : undefined;
    const init: RequestInit = { method: nodeReq.method, headers };
    if (body && nodeReq.method !== "GET" && nodeReq.method !== "HEAD") {
      init.body = body;
    }
    const res = await handleApiRequest(new Request(url, init));
    const text = await res.text();
    nodeRes.writeHead(
      res.status,
      Object.fromEntries(res.headers.entries()),
    );
    nodeRes.end(text);
    console.log(`${nodeReq.method} ${new URL(url).pathname} ${res.status}`);
  } catch (err) {
    console.error(err);
    if (!nodeRes.headersSent) {
      nodeRes.writeHead(500, { "Content-Type": "application/json" });
    }
    nodeRes.end(JSON.stringify({ error: "Something went wrong." }));
  }
});

server.listen(port, () => {
  console.log(`DealRate API dev server on http://localhost:${port}`);
});
