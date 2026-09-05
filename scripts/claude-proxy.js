#!/usr/bin/env node
/**
 * Claude CLI Proxy — run this on your HOST machine (where `claude` is installed and logged in).
 * The Dockerized API calls it at http://host.docker.internal:3099.
 *
 *   node scripts/claude-proxy.js
 *
 * Env:
 *   CLAUDE_PROXY_PORT   default 3099
 *   CLAUDE_PROXY_HOST   default 127.0.0.1 (works with Docker Desktop on macOS/Windows).
 *                       On Linux set 0.0.0.0 so host-gateway can reach it, and set a token.
 *   CLAUDE_PROXY_TOKEN  optional shared secret; clients must send  Authorization: Bearer <token>
 *   CLAUDE_CLI_PATH     optional default path to the claude binary (request may override)
 *   CLAUDE_PROXY_TIMEOUT_MS default 600000
 *
 * Endpoints:
 *   GET  /health   -> { ok, bin, version }
 *   POST /run      -> body { model, cliPath?, systemPrompt, prompt, jsonSchema?, image?: { data, mediaType } }
 *                     returns the raw `claude -p --output-format json` envelope plus { bin }
 *                     or { error: { code, message } } with a 4xx/5xx status.
 */
import { execFile } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";

const PORT = Number(process.env.CLAUDE_PROXY_PORT ?? 3099);
const HOST = process.env.CLAUDE_PROXY_HOST ?? "127.0.0.1";
const TOKEN = process.env.CLAUDE_PROXY_TOKEN ?? "";
const TIMEOUT_MS = Number(process.env.CLAUDE_PROXY_TIMEOUT_MS ?? 10 * 60 * 1000);
const MAX_BODY = 40 * 1024 * 1024;

const IMAGE_FILE = { "image/jpeg": "artwork.jpg", "image/png": "artwork.png", "image/webp": "artwork.webp", "image/gif": "artwork.gif" };

function executable(p) {
  try {
    accessSync(p, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function resolveClaude(explicit) {
  if (explicit) return executable(explicit) ? explicit : null;
  const dirs = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
  const candidates = [
    ...dirs.map((d) => path.join(d, "claude")),
    path.join(os.homedir(), ".local", "bin", "claude"),
    path.join(os.homedir(), ".claude", "local", "claude"),
    "/opt/homebrew/bin/claude",
    "/usr/local/bin/claude",
  ];
  return candidates.find(executable) ?? null;
}

function run(bin, args, cwd, timeoutMs) {
  return new Promise((resolve, reject) => {
    const { CLAUDECODE, CLAUDE_CODE_ENTRYPOINT, ...env } = process.env; // allow nesting under a Claude Code session
    execFile(bin, args, { cwd, env, timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024, killSignal: "SIGKILL" }, (err, stdout, stderr) => {
      if (err && err.code === "ENOENT") return reject(Object.assign(new Error(`cannot execute ${bin}`), { code: "ENOENT" }));
      if (err && err.killed) return reject(Object.assign(new Error("timeout"), { code: "ETIMEDOUT" }));
      resolve({ stdout: String(stdout), stderr: String(stderr), code: err ? (typeof err.code === "number" ? err.code : 1) : 0 });
    });
  });
}

class ProxyError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function handleRun(body) {
  const { model, cliPath, systemPrompt, prompt, jsonSchema, image } = body ?? {};
  if (!prompt || !systemPrompt) throw new ProxyError(400, "bad_request", "prompt and systemPrompt are required");
  const explicit = cliPath || process.env.CLAUDE_CLI_PATH || null;
  const bin = resolveClaude(explicit);
  if (!bin) {
    throw new ProxyError(
      502,
      "claude_cli_missing",
      explicit ? `No executable found at ${explicit} on the proxy host.` : "claude CLI not found on the proxy host. Install Claude Code or set CLAUDE_CLI_PATH.",
    );
  }
  const dir = await mkdtemp(path.join(os.tmpdir(), "artlyrics-proxy-"));
  try {
    if (image?.data && IMAGE_FILE[image.mediaType]) {
      await writeFile(path.join(dir, IMAGE_FILE[image.mediaType]), Buffer.from(image.data, "base64"));
    }
    const args = ["-p", prompt, "--output-format", "json", "--tools", "Read", "--no-session-persistence", "--strict-mcp-config", "--system-prompt", systemPrompt];
    if (model) args.push("--model", model);
    if (jsonSchema) args.push("--json-schema", JSON.stringify(jsonSchema));

    let out;
    try {
      out = await run(bin, args, dir, TIMEOUT_MS);
    } catch (err) {
      if (err.code === "ETIMEDOUT") throw new ProxyError(504, "claude_cli_timeout", "The claude CLI did not finish in time.");
      throw new ProxyError(502, "claude_cli_error", err.message);
    }
    let parsed;
    try {
      parsed = JSON.parse(out.stdout.trim());
    } catch {
      const detail = (out.stderr || out.stdout).trim().split("\n").slice(-3).join(" ").slice(0, 300);
      throw new ProxyError(502, "claude_cli_error", `The claude CLI returned unexpected output (exit ${out.code}): ${detail || "no output"}`);
    }
    if (parsed.is_error || out.code !== 0) {
      const msg = String(parsed.result ?? out.stderr ?? "").slice(0, 300);
      if (/not logged in|login|authenticate|API key/i.test(msg)) {
        throw new ProxyError(502, "claude_cli_auth", `The claude CLI on the proxy host is not authenticated. Run \`claude\` once and log in. (${msg})`);
      }
      throw new ProxyError(502, "claude_cli_error", `The claude CLI failed: ${msg || `exit ${out.code}`}`);
    }
    return { ...parsed, bin };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

async function handleHealth() {
  const bin = resolveClaude(process.env.CLAUDE_CLI_PATH || null);
  if (!bin) return { ok: false, bin: null, version: null, message: "claude CLI not found on the proxy host" };
  try {
    const out = await run(bin, ["--version"], os.tmpdir(), 15000);
    return { ok: out.code === 0, bin, version: out.stdout.trim().split("\n")[0] || null };
  } catch (err) {
    return { ok: false, bin, version: null, message: err.message };
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new ProxyError(413, "payload_too_large", "request body too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {});
      } catch {
        reject(new ProxyError(400, "bad_json", "body must be JSON"));
      }
    });
    req.on("error", reject);
  });
}

function send(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  try {
    if (TOKEN && req.headers.authorization !== `Bearer ${TOKEN}`) throw new ProxyError(401, "unauthorized", "missing or invalid proxy token");
    if (req.method === "GET" && req.url === "/health") return send(res, 200, await handleHealth());
    if (req.method === "POST" && req.url === "/run") {
      const body = await readBody(req);
      const started = Date.now();
      const result = await handleRun(body);
      console.log(`[proxy] ${new Date().toISOString()} run model=${body.model ?? "default"} image=${body.image ? "yes" : "no"} ${Date.now() - started}ms`);
      return send(res, 200, result);
    }
    throw new ProxyError(404, "not_found", "use GET /health or POST /run");
  } catch (err) {
    const status = err instanceof ProxyError ? err.status : 500;
    const code = err instanceof ProxyError ? err.code : "internal_error";
    if (status >= 500) console.error(`[proxy] ${code}: ${err.message}`);
    send(res, status, { error: { code, message: err.message } });
  }
});

server.listen(PORT, HOST, async () => {
  const h = await handleHealth();
  console.log(`Claude CLI proxy listening on http://${HOST}:${PORT}`);
  console.log(h.ok ? `  claude: ${h.bin} (${h.version})` : `  WARNING: ${h.message}`);
  console.log(`  Docker containers reach it at http://host.docker.internal:${PORT}${TOKEN ? " (token required)" : ""}`);
  if (HOST !== "127.0.0.1" && !TOKEN) console.log("  WARNING: bound to a non-loopback address without CLAUDE_PROXY_TOKEN");
});
