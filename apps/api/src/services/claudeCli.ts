import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod/v4";
import { Composition, type ProviderSettings } from "@artlyrics/shared";
import { config } from "../config.js";
import { HttpError, unprocessable, upstream } from "../lib/errors.js";
import { ANALYST_SYSTEM_PROMPT } from "../prompts/analyze.js";
import { COMPOSER_SYSTEM_PROMPT, buildComposePrompt } from "../prompts/lyrics.js";
import { resolveClaudeCli } from "./claudeCliResolve.js";
import { extractJson } from "./ollama.js";
import type { AnalysisProvider, AnswerResult, ComposeResult, ModelImage, QA, Usage } from "./provider.js";

/** Shape of `claude -p --output-format json` we rely on. */
export interface CliResult {
  type?: string;
  subtype?: string;
  is_error?: boolean;
  result?: string;
  structured_output?: unknown;
  stop_reason?: string;
  permission_denials?: unknown[];
  usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };
  modelUsage?: Record<string, unknown>;
  total_cost_usd?: number;
}

/** One CLI invocation, independent of where it runs (local spawn or remote proxy). */
export interface CliRequest {
  model: string;
  cliPath: string | null;
  systemPrompt: string;
  prompt: string;
  jsonSchema?: unknown;
  image?: ModelImage;
}

export type CliExecutor = (req: CliRequest) => Promise<CliResult>;

export interface ClaudeCliRunner {
  (bin: string, args: string[], cwd: string, timeoutMs: number): Promise<{ stdout: string; stderr: string; code: number | null }>;
}

const { $schema: _ignored, ...COMPOSITION_JSON_SCHEMA } = z.toJSONSchema(Composition) as Record<string, unknown>;
export { COMPOSITION_JSON_SCHEMA };

export const IMAGE_FILE: Record<ModelImage["mediaType"], string> = {
  "image/jpeg": "artwork.jpg",
  "image/png": "artwork.png",
  "image/webp": "artwork.webp",
  "image/gif": "artwork.gif",
};

export const defaultRunner: ClaudeCliRunner = (bin, args, cwd, timeoutMs) =>
  new Promise((resolve, reject) => {
    // Strip nesting markers so the CLI runs even when the API itself was launched from a Claude Code session.
    const { CLAUDECODE: _a, CLAUDE_CODE_ENTRYPOINT: _b, ...env } = process.env;
    execFile(
      bin,
      args,
      { cwd, env, timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024, killSignal: "SIGKILL" },
      (err, stdout, stderr) => {
        if (err && (err as NodeJS.ErrnoException).code === "ENOENT") return reject(err);
        if (err && (err as { killed?: boolean }).killed) return reject(Object.assign(new Error("timeout"), { code: "ETIMEDOUT" }));
        const code = err ? ((err as { code?: number | string }).code as number | null) ?? 1 : 0;
        resolve({ stdout: String(stdout), stderr: String(stderr), code: typeof code === "number" ? code : 1 });
      },
    );
  });

export function cliArgs(req: CliRequest): string[] {
  const args = [
    "-p",
    req.prompt,
    "--output-format",
    "json",
    "--tools",
    "Read",
    "--no-session-persistence",
    "--strict-mcp-config",
    "--system-prompt",
    req.systemPrompt,
  ];
  if (req.model) args.push("--model", req.model);
  if (req.jsonSchema) args.push("--json-schema", JSON.stringify(req.jsonSchema));
  return args;
}

/** Interprets the CLI's JSON envelope (or lack of one) into a result or an HttpError. */
export function parseEnvelope(out: { stdout: string; stderr: string; code: number | null }): CliResult {
  let parsed: CliResult;
  try {
    parsed = JSON.parse(out.stdout.trim()) as CliResult;
  } catch {
    const detail = (out.stderr || out.stdout).trim().split("\n").slice(-3).join(" ").slice(0, 300);
    throw upstream("claude_cli_error", `The claude CLI returned unexpected output (exit ${out.code}): ${detail || "no output"}`);
  }
  if (parsed.is_error || out.code !== 0) {
    const msg = (parsed.result ?? out.stderr ?? "").toString().slice(0, 300);
    if (/not logged in|login|authenticate|API key/i.test(msg)) {
      throw upstream("claude_cli_auth", `The claude CLI is not authenticated. Run \`claude\` once and log in. (${msg})`);
    }
    throw upstream("claude_cli_error", `The claude CLI failed: ${msg || `exit ${out.code}`}`);
  }
  return parsed;
}

/** Runs the CLI on this machine: image into a scratch dir, spawn, parse. */
export function localExecutor(runner: ClaudeCliRunner = defaultRunner, resolve: typeof resolveClaudeCli = resolveClaudeCli): CliExecutor {
  return async (req) => {
    const bin = resolve(req.cliPath);
    if (!bin) {
      throw upstream(
        "claude_cli_missing",
        req.cliPath
          ? `No executable found at ${req.cliPath}. Fix the CLI path in Model settings.`
          : "The claude CLI was not found on this server. Install Claude Code, set the CLI path in Model settings, or use the Claude CLI Proxy provider when running in Docker.",
      );
    }
    const dir = await mkdtemp(path.join(os.tmpdir(), "artlyrics-"));
    try {
      if (req.image) await writeFile(path.join(dir, IMAGE_FILE[req.image.mediaType]), Buffer.from(req.image.data, "base64"));
      let out: Awaited<ReturnType<ClaudeCliRunner>>;
      try {
        out = await runner(bin, cliArgs(req), dir, config.claudeCli.timeoutMs);
      } catch (err) {
        const code = (err as { code?: string }).code;
        if (code === "ENOENT") throw upstream("claude_cli_missing", `Could not execute ${bin}.`);
        if (code === "ETIMEDOUT") throw upstream("claude_cli_timeout", "The claude CLI did not finish in time.");
        throw upstream("claude_cli_error", err instanceof Error ? err.message : String(err));
      }
      return parseEnvelope(out);
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  };
}

/** Sends the request to scripts/claude-proxy.js running on the host. */
export function proxyExecutor(baseUrl: string, fetchImpl: typeof fetch = fetch, token?: string): CliExecutor {
  const url = `${baseUrl.replace(/\/+$/, "")}/run`;
  return async (req) => {
    let res: Response;
    try {
      res = await fetchImpl(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(req),
        signal: AbortSignal.timeout(config.claudeCli.timeoutMs + 15_000),
      });
    } catch (err) {
      const reason = err instanceof Error && err.name === "TimeoutError" ? "timed out" : "is unreachable";
      throw upstream(
        "claude_proxy_unreachable",
        `The Claude CLI proxy at ${baseUrl} ${reason}. Start it on your host with: node scripts/claude-proxy.js  (Docker reaches it via http://host.docker.internal:3099)`,
      );
    }
    const body = (await res.json().catch(() => ({}))) as CliResult & { error?: { code?: string; message?: string } };
    if (!res.ok || body.error) {
      const code = body.error?.code ?? "claude_proxy_error";
      const message = body.error?.message ?? `Proxy returned HTTP ${res.status}`;
      throw new HttpError(res.status === 401 ? 502 : 502, code, message);
    }
    return body;
  };
}

function usageOf(r: CliResult): Usage {
  const u = r.usage ?? {};
  const input = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
  return { inputTokens: u.input_tokens === undefined ? null : input, outputTokens: u.output_tokens ?? null, cacheReadTokens: u.cache_read_input_tokens ?? null };
}

function modelOf(prefix: string, r: CliResult, fallback: string): string {
  const ids = Object.keys(r.modelUsage ?? {});
  return `${prefix}/${ids[0] ?? fallback}`;
}

const readInstruction = (image: ModelImage) => `First, use the Read tool to view the artwork image at ./${IMAGE_FILE[image.mediaType]}.`;

export function questionPrompt(image: ModelImage, prior: QA[], question: string): string {
  const transcript = prior.length
    ? `\n\nEarlier questions and your answers about this artwork:\n${prior.map((q, i) => `Q${i + 1}: ${q.question}\nA${i + 1}: ${q.answer}`).join("\n\n")}\n`
    : "";
  return `${readInstruction(image)}${transcript}\nNow answer this question about the artwork. Reply with the answer only, no preamble:\n${question}`;
}

/** Shared provider body for both the direct CLI and the proxy; only the executor and test() differ. */
function cliBackedProvider(
  name: "claude-cli" | "claude-proxy",
  settings: Pick<ProviderSettings, "model" | "cliPath">,
  execute: CliExecutor,
  test: AnalysisProvider["test"],
): AnalysisProvider {
  const model = settings.model || config.claudeCli.model;
  const cliPath = settings.cliPath || config.claudeCli.path;

  async function run(req: Omit<CliRequest, "model" | "cliPath">): Promise<CliResult> {
    const r = await execute({ model, cliPath, ...req });
    if (r.permission_denials && r.permission_denials.length > 0) {
      throw upstream("claude_cli_permission", "The claude CLI needed a permission it did not have (reading the artwork file).");
    }
    if (r.stop_reason === "refusal") throw unprocessable("model_refused", "The model declined to work with this image.");
    return r;
  }

  return {
    name,
    test,

    async answerQuestion(image: ModelImage, prior: QA[], question: string): Promise<AnswerResult> {
      const r = await run({ systemPrompt: ANALYST_SYSTEM_PROMPT, prompt: questionPrompt(image, prior, question), image });
      const answer = (r.result ?? "").trim();
      if (!answer) throw upstream("empty_answer", "The model returned an empty answer.");
      return { answer, model: modelOf(name, r, model), usage: usageOf(r) };
    },

    async compose(image: ModelImage, qa: QA[]): Promise<ComposeResult> {
      const prompt = `${readInstruction(image)}\n\n${buildComposePrompt(qa)}`;
      for (let attempt = 0; attempt < 2; attempt++) {
        const r = await run({ systemPrompt: COMPOSER_SYSTEM_PROMPT, prompt, jsonSchema: COMPOSITION_JSON_SCHEMA, image });
        let raw: unknown = r.structured_output;
        if (raw === undefined || raw === null) {
          try {
            raw = extractJson(r.result ?? "");
          } catch {
            if (attempt === 0) continue;
            throw upstream("invalid_json", "The model returned malformed output.");
          }
        }
        const parsed = Composition.safeParse(raw);
        if (parsed.success) return { composition: parsed.data, model: modelOf(name, r, model), usage: usageOf(r) };
        if (attempt === 0) continue;
        throw upstream("schema_mismatch", `The model output did not match the expected shape: ${parsed.error.issues[0]?.message ?? ""}`);
      }
      throw upstream("compose_failed", "Composition failed.");
    },
  };
}

/** Claude CLI (direct): spawns `claude` on the API host. */
export function claudeCliProvider(
  settings: Pick<ProviderSettings, "model" | "cliPath">,
  runner: ClaudeCliRunner = defaultRunner,
  resolve: typeof resolveClaudeCli = resolveClaudeCli,
): AnalysisProvider {
  const model = settings.model || config.claudeCli.model;
  const explicitPath = settings.cliPath || config.claudeCli.path;

  return cliBackedProvider("claude-cli", settings, localExecutor(runner, resolve), async () => {
    if (config.inDocker) {
      return {
        ok: false,
        vision: null,
        message: "The backend is running inside Docker, where the local claude CLI is not available. Use the Claude CLI Proxy provider, or run the API on the host (npm run dev).",
      };
    }
    const bin = resolve(explicitPath);
    if (!bin) {
      return {
        ok: false,
        vision: null,
        message: explicitPath ? `No executable found at ${explicitPath}.` : "claude CLI not found. Install Claude Code or set the CLI path (e.g. ~/.local/bin/claude).",
      };
    }
    try {
      const out = await runner(bin, ["--version"], os.tmpdir(), 15_000);
      const version = out.stdout.trim().split("\n")[0] || "unknown version";
      return { ok: out.code === 0, vision: true, message: out.code === 0 ? `Found ${bin} (${version}). Model: ${model}.` : `${bin} exited with code ${out.code}.` };
    } catch (err) {
      return { ok: false, vision: null, message: `Could not run ${bin}: ${err instanceof Error ? err.message : String(err)}` };
    }
  });
}

/** Claude CLI Proxy: talks to scripts/claude-proxy.js on the host over HTTP. */
export function claudeProxyProvider(
  settings: Pick<ProviderSettings, "model" | "cliPath" | "baseUrl">,
  fetchImpl: typeof fetch = fetch,
): AnalysisProvider {
  const baseUrl = settings.baseUrl || config.claudeProxy.url;
  const model = settings.model || config.claudeCli.model;
  const token = config.claudeProxy.token;

  return cliBackedProvider("claude-proxy", settings, proxyExecutor(baseUrl, fetchImpl, token), async () => {
    try {
      const res = await fetchImpl(`${baseUrl.replace(/\/+$/, "")}/health`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        signal: AbortSignal.timeout(5000),
      });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; bin?: string | null; version?: string | null; message?: string; error?: { message?: string } };
      if (res.status === 401) return { ok: false, vision: null, message: "The proxy rejected the request: CLAUDE_PROXY_TOKEN on the API does not match the proxy's token." };
      if (!res.ok || !body.ok) {
        return { ok: false, vision: null, message: body.message ?? body.error?.message ?? `Proxy at ${baseUrl} responded with HTTP ${res.status}.` };
      }
      return { ok: true, vision: true, message: `Proxy reachable at ${baseUrl}. claude: ${body.bin} (${body.version}). Model: ${model}.` };
    } catch {
      return {
        ok: false,
        vision: null,
        message: `Could not reach the Claude CLI proxy at ${baseUrl}. Run \`node scripts/claude-proxy.js\` on your host. From Docker use http://host.docker.internal:3099.`,
      };
    }
  });
}
