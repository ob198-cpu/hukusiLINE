import http from "node:http";

const listenPort = Number(process.env.WEBHOOK_GATEWAY_PORT || 8791);
const upstreamUrl = process.env.WEBHOOK_UPSTREAM_URL || "http://127.0.0.1:8790/webhook";
const maxBodyBytes = 1024 * 1024;

function send(res, status, body = "") {
  res.writeHead(status, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer"
  });
  res.end(body);
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBodyBytes) throw new Error("Request body too large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

const server = http.createServer(async (req, res) => {
  const pathname = new URL(req.url || "/", "http://localhost").pathname;
  if (req.method !== "POST" || pathname !== "/webhook") {
    send(res, 404, "Not found");
    return;
  }

  try {
    const body = await readBody(req);
    const upstream = await fetch(upstreamUrl, {
      method: "POST",
      headers: {
        "content-type": req.headers["content-type"] || "application/json",
        "x-line-signature": req.headers["x-line-signature"] || ""
      },
      body
    });
    const responseBody = await upstream.text();
    send(res, upstream.status, responseBody);
  } catch (error) {
    send(res, error.message === "Request body too large" ? 413 : 502, "Webhook gateway error");
  }
});

server.listen(listenPort, "127.0.0.1", () => {
  console.log(`LINE webhook-only gateway: http://127.0.0.1:${listenPort}/webhook`);
});
