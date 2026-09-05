import "./setup.js";
import { spawn, type ChildProcess } from "node:child_process";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { claudeProxyProvider, proxyExecutor } from "../src/services/claudeCli.js";

const image = { data: Buffer.from("fakejpeg").toString("base64"), mediaType: "image/jpeg" as const };
const envelope = { type: "result", is_error: false, result: "Warm and calm.", usage: { input_tokens: 3, output_tokens: 4 }, modelUsage: { "claude-haiku-4-5": {} } };

function fakeFetch(handler: (url: string, init?: RequestInit) => { status?: number; json: unknown }) {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const r = handler(String(input), init);
    return new Response(JSON.stringify(r.json), { status: r.status ?? 200, headers: { "Content-Type": "application/json" } });
  }) as unknown as typeof fetch;
}

describe("proxyExecutor", () => {
  it("posts the request to /run and returns the envelope", async () => {
    const fetch = fakeFetch((url, init) => {
      expect(url).toBe("http://proxy.test:3099/run");
      const body = JSON.parse(String(init?.body));
      expect(body.model).toBe("haiku");
      expect(body.image.data).toBe(image.data);
      return { json: envelope };
    });
    const r = await proxyExecutor("http://proxy.test:3099/", fetch)({ model: "haiku", cliPath: null, systemPrompt: "s", prompt: "p", image });
    expect(r.result).toBe("Warm and calm.");
  });

  it("passes through proxy error codes", async () => {
    const fetch = fakeFetch(() => ({ status: 502, json: { error: { code: "claude_cli_auth", message: "not logged in" } } }));
    await expect(proxyExecutor("http://x", fetch)({ model: "haiku", cliPath: null, systemPrompt: "s", prompt: "p" })).rejects.toMatchObject({ code: "claude_cli_auth" });
  });

  it("maps connection failure to claude_proxy_unreachable with start instructions", async () => {
    const fetch = vi.fn(async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch;
    await expect(proxyExecutor("http://host.docker.internal:3099", fetch)({ model: "haiku", cliPath: null, systemPrompt: "s", prompt: "p" })).rejects.toMatchObject({
      code: "claude_proxy_unreachable",
      message: expect.stringContaining("scripts/claude-proxy.js"),
    });
  });
});

describe("claudeProxyProvider", () => {
  it("answers via the proxy and labels the model", async () => {
    const fetch = fakeFetch(() => ({ json: envelope }));
    const r = await claudeProxyProvider({ model: "haiku", cliPath: null, baseUrl: "http://x" }, fetch).answerQuestion(image, [], "mood?");
    expect(r.answer).toBe("Warm and calm.");
    expect(r.model).toBe("claude-proxy/claude-haiku-4-5");
  });

  it("test() reports proxy health", async () => {
    const fetch = fakeFetch((url) => { expect(url).toBe("http://x/health"); return { json: { ok: true, bin: "/b/claude", version: "2.1.261" } }; });
    const r = await claudeProxyProvider({ model: "opus", cliPath: null, baseUrl: "http://x" }, fetch).test();
    expect(r.ok).toBe(true);
    expect(r.message).toMatch(/2\.1\.261/);
  });
});

/**
 * Boots the real scripts/claude-proxy.js with a fake `claude` binary on a random port.
 * The fake binary records its args and prints a JSON envelope.
 */
describe("scripts/claude-proxy.js", () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const script = path.resolve(here, "../../../scripts/claude-proxy.js");
  const port = 3900 + Math.floor(Math.random() * 100);
  let child: ChildProcess;
  let fakeBin: string;
  let argsFile: string;

  beforeAll(async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "fake-claude-"));
    fakeBin = path.join(dir, "claude");
    argsFile = path.join(dir, "args.json");
    writeFileSync(
      fakeBin,
      `#!/bin/sh
if [ "$1" = "--version" ]; then echo "9.9.9 (Fake Claude)"; exit 0; fi
node -e 'require("fs").writeFileSync(process.argv[1], JSON.stringify({args: process.argv.slice(2), cwd: process.cwd(), hasImage: require("fs").existsSync("artwork.jpg")}))' "${argsFile}" "$@"
echo '${JSON.stringify({ ...envelope, structured_output: { hello: "world" } })}'
`,
    );
    chmodSync(fakeBin, 0o755);
    child = spawn(process.execPath, [script], {
      env: { ...process.env, CLAUDE_PROXY_PORT: String(port), CLAUDE_CLI_PATH: fakeBin, CLAUDE_PROXY_TOKEN: "secret" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("proxy did not start")), 10_000);
      child.stdout!.on("data", (d) => { if (String(d).includes("listening")) { clearTimeout(t); resolve(); } });
      child.stderr!.on("data", (d) => console.error(String(d)));
    });
  });

  afterAll(() => { child?.kill(); });

  it("rejects requests without the token", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    expect(res.status).toBe(401);
  });

  it("reports health with the fake binary version", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/health`, { headers: { Authorization: "Bearer secret" } });
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, bin: fakeBin, version: "9.9.9 (Fake Claude)" });
  });

  it("runs the CLI with the image in cwd and returns the envelope", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer secret" },
      body: JSON.stringify({ model: "haiku", systemPrompt: "sys", prompt: "hi", jsonSchema: { type: "object" }, image }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result).toBe("Warm and calm.");
    expect(body.structured_output).toEqual({ hello: "world" });
    expect(body.bin).toBe(fakeBin);
    const recorded = JSON.parse((await import("node:fs")).readFileSync(argsFile, "utf8"));
    expect(recorded.hasImage).toBe(true);
    expect(recorded.args).toEqual(expect.arrayContaining(["-p", "hi", "--model", "haiku", "--json-schema", '{"type":"object"}', "--system-prompt", "sys"]));
  });

  it("works end to end through claudeProxyProvider", async () => {
    process.env.CLAUDE_PROXY_TOKEN = "secret";
    const { config } = await import("../src/config.js");
    (config.claudeProxy as { token?: string }).token = "secret";
    const r = await claudeProxyProvider({ model: "haiku", cliPath: null, baseUrl: `http://127.0.0.1:${port}` }).answerQuestion(image, [], "q?");
    expect(r.answer).toBe("Warm and calm.");
  });
});
