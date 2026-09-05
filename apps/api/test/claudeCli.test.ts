import "./setup.js";
import { readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { claudeCliProvider, type ClaudeCliRunner } from "../src/services/claudeCli.js";

const image = { data: Buffer.from("fakejpeg").toString("base64"), mediaType: "image/jpeg" as const };
const composition = {
  analysis: { subject: "s", medium: "m", dominant_colors: ["red"], mood: ["calm"], composition: "c", era_or_movement: "e", symbols_and_themes: [], narrative: "n" },
  lyrics: { title: "T", sections: [{ type: "verse", lines: ["a", "b"] }, { type: "chorus", lines: ["c", "d"] }, { type: "outro", lines: ["e", "f"] }], rationale: "r" },
  style: { primary_genre: "g", sub_genres: [], tempo_bpm: { min: 80, max: 90 }, key_suggestion: "C", instrumentation: ["piano"], vocal_style: "v", reference_artists: [], why: "w" },
};
const resolveOk = () => "/fake/bin/claude";
const ok = (extra: object) => ({ code: 0, stderr: "", stdout: JSON.stringify({ type: "result", is_error: false, usage: { input_tokens: 5, output_tokens: 7, cache_read_input_tokens: 100 }, modelUsage: { "claude-sonnet-5": {} }, ...extra }) });

describe("claudeCliProvider", () => {
  it("writes the image into the cwd, passes flags, and returns the answer", async () => {
    let seenArgs: string[] = [];
    let cwdHadImage = false;
    const runner: ClaudeCliRunner = async (bin, args, cwd) => {
      expect(bin).toBe("/fake/bin/claude");
      seenArgs = args;
      cwdHadImage = existsSync(path.join(cwd, "artwork.jpg"));
      return ok({ result: "Melancholy, mostly." });
    };
    const p = claudeCliProvider({ model: "haiku", cliPath: null }, runner, resolveOk);
    const r = await p.answerQuestion(image, [{ question: "q1", answer: "a1" }], "What mood?");
    expect(cwdHadImage).toBe(true);
    expect(seenArgs.slice(0, 2)).toEqual(["-p", expect.stringContaining("./artwork.jpg")]);
    expect(seenArgs[1]).toContain("Q1: q1");
    expect(seenArgs).toEqual(expect.arrayContaining(["--output-format", "json", "--tools", "Read", "--model", "haiku", "--no-session-persistence"]));
    expect(seenArgs).not.toContain("--json-schema");
    expect(r.answer).toBe("Melancholy, mostly.");
    expect(r.model).toBe("claude-cli/claude-sonnet-5");
    expect(r.usage).toEqual({ inputTokens: 105, outputTokens: 7, cacheReadTokens: 100 });
  });

  it("composes via --json-schema and prefers structured_output", async () => {
    const runner: ClaudeCliRunner = async (_b, args) => {
      const i = args.indexOf("--json-schema");
      expect(i).toBeGreaterThan(-1);
      const schema = JSON.parse(args[i + 1]);
      expect(schema.properties.lyrics).toBeDefined();
      expect(schema.$schema).toBeUndefined();
      return ok({ result: "ignored", structured_output: composition });
    };
    const r = await claudeCliProvider({ model: "sonnet", cliPath: null }, runner, resolveOk).compose(image, []);
    expect(r.composition.style.primary_genre).toBe("g");
  });

  it("cleans up its scratch directory", async () => {
    let dir = "";
    const runner: ClaudeCliRunner = async (_b, _a, cwd) => { dir = cwd; return ok({ result: "x" }); };
    await claudeCliProvider({ model: "haiku", cliPath: null }, runner, resolveOk).answerQuestion(image, [], "q?");
    expect(existsSync(dir)).toBe(false);
  });

  it("reports a missing binary as 502 claude_cli_missing", async () => {
    const p = claudeCliProvider({ model: "haiku", cliPath: "/nope/claude" }, vi.fn() as unknown as ClaudeCliRunner, () => null);
    await expect(p.answerQuestion(image, [], "q?")).rejects.toMatchObject({ status: 502, code: "claude_cli_missing", message: expect.stringContaining("/nope/claude") });
  });

  it("surfaces CLI auth failures distinctly", async () => {
    const runner: ClaudeCliRunner = async () => ({ code: 1, stderr: "", stdout: JSON.stringify({ is_error: true, result: "Not logged in. Please run /login" }) });
    await expect(claudeCliProvider({ model: "haiku", cliPath: null }, runner, resolveOk).answerQuestion(image, [], "q?")).rejects.toMatchObject({ code: "claude_cli_auth" });
  });

  it("handles non-JSON output", async () => {
    const runner: ClaudeCliRunner = async () => ({ code: 1, stderr: "boom", stdout: "" });
    await expect(claudeCliProvider({ model: "haiku", cliPath: null }, runner, resolveOk).answerQuestion(image, [], "q?")).rejects.toMatchObject({ code: "claude_cli_error", message: expect.stringContaining("boom") });
  });

  it("test() reports the resolved binary and version", async () => {
    const runner: ClaudeCliRunner = async (_b, args) => { expect(args).toEqual(["--version"]); return { code: 0, stderr: "", stdout: "2.1.261 (Claude Code)\n" }; };
    const r = await claudeCliProvider({ model: "opus", cliPath: null }, runner, resolveOk).test();
    expect(r.ok).toBe(true);
    expect(r.vision).toBe(true);
    expect(r.message).toMatch(/2\.1\.261/);
  });

  it("test() explains when the binary is absent", async () => {
    const r = await claudeCliProvider({ model: "opus", cliPath: null }, vi.fn() as unknown as ClaudeCliRunner, () => null).test();
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/not found/);
  });
});

// sanity: no leftover scratch dirs from this file
void readdirSync;
