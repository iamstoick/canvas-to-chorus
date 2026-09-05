import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CLAUDE_CLI_MODELS, PROVIDER_DEFAULTS, type ProviderName, type ProviderSettingsUpdate, type ProviderTestResult } from "@artlyrics/shared";
import ErrorNote from "../components/ErrorNote";
import { api } from "../lib/api";

const PROVIDER_LABEL: Record<ProviderName, string> = {
  "claude-proxy": "Claude CLI Proxy",
  "claude-cli": "Claude CLI (direct)",
  anthropic: "Anthropic Claude (API)",
  ollama: "Ollama (local)",
};

const PROVIDER_HINT: Record<ProviderName, string> = {
  "claude-proxy": "Run scripts/claude-proxy.js on your host. Docker calls it via host.docker.internal:3099.",
  "claude-cli": "Uses local claude CLI — only works when backend runs outside Docker.",
  anthropic: "Uses the Anthropic API. The server must have ANTHROPIC_API_KEY set.",
  ollama: "Uses a model served by Ollama on this machine.",
};

const MODEL_HINT: Record<ProviderName, string> = {
  "claude-proxy": "haiku is fastest, opus is strongest. Billed to your Claude Code account.",
  "claude-cli": "haiku is fastest, opus is strongest. Billed to your Claude Code account.",
  anthropic: "Any Claude model id, e.g. claude-opus-5.",
  ollama: "Artwork analysis needs a vision model: qwen2.5vl, gemma3, llava, llama3.2-vision. Text-only models such as qwen3 cannot see the image.",
};

type Form = ProviderSettingsUpdate & { baseUrl: string; cliPath: string };

const emptyForm = (provider: ProviderName): Form => ({
  provider,
  model: PROVIDER_DEFAULTS[provider].model,
  baseUrl: PROVIDER_DEFAULTS[provider].baseUrl ?? "",
  cliPath: "",
});

export default function SettingsPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const saved = useQuery({ queryKey: ["settings"], queryFn: api.getSettings });

  const [form, setForm] = useState<Form>(emptyForm("claude-proxy"));
  const [testResult, setTestResult] = useState<ProviderTestResult | null>(null);

  useEffect(() => {
    if (saved.data) {
      setForm({ provider: saved.data.provider, model: saved.data.model, baseUrl: saved.data.baseUrl ?? "", cliPath: saved.data.cliPath ?? "" });
    }
  }, [saved.data]);

  const test = useMutation({ mutationFn: api.testSettings, onSuccess: setTestResult });
  const save = useMutation({
    mutationFn: api.saveSettings,
    onSuccess: (s) => {
      qc.setQueryData(["settings"], s);
      navigate(-1);
    },
  });

  function update(patch: Partial<Form>) {
    setTestResult(null);
    setForm((f) => ({ ...f, ...patch }));
  }

  const busy = test.isPending || save.isPending;
  const isCli = form.provider === "claude-cli" || form.provider === "claude-proxy";
  const showBaseUrl = form.provider !== "claude-cli";
  const showCliPath = isCli;

  return (
    <div className="max-w-xl pt-6 space-y-8">
      <div>
        <h1 className="font-display text-4xl">Model settings</h1>
        <p className="muted text-sm mt-2">Choose which model analyzes your artwork and writes the lyrics. Saved per browser.</p>
      </div>

      <form
        className="space-y-6"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate(form);
        }}
      >
        <label className="block space-y-2">
          <span className="text-sm font-medium">Provider</span>
          <select
            className="input"
            value={form.provider}
            onChange={(e) => { setTestResult(null); setForm(emptyForm(e.target.value as ProviderName)); }}
            disabled={busy}
          >
            {(Object.keys(PROVIDER_LABEL) as ProviderName[]).map((p) => (
              <option key={p} value={p}>{PROVIDER_LABEL[p]}</option>
            ))}
          </select>
          <span className="muted text-xs block">{PROVIDER_HINT[form.provider]}</span>
        </label>

        <label className="block space-y-2">
          <span className="text-sm font-medium">Model</span>
          {isCli ? (
            <select className="input" value={form.model} onChange={(e) => update({ model: e.target.value })} disabled={busy}>
              {CLAUDE_CLI_MODELS.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          ) : (
            <input
              className="input"
              value={form.model}
              onChange={(e) => update({ model: e.target.value })}
              placeholder={PROVIDER_DEFAULTS[form.provider].model}
              disabled={busy}
              required
            />
          )}
          <span className="muted text-xs block">{MODEL_HINT[form.provider]}</span>
        </label>

        {showBaseUrl && (
          <label className="block space-y-2">
            <span className="text-sm font-medium">Base URL <span className="muted font-normal">(optional)</span></span>
            <input
              className="input"
              type="url"
              value={form.baseUrl}
              onChange={(e) => update({ baseUrl: e.target.value })}
              placeholder={PROVIDER_DEFAULTS[form.provider].baseUrl ?? "https://api.anthropic.com"}
              disabled={busy}
            />
            <span className="muted text-xs block">
              {form.provider === "claude-proxy"
                ? `Default: ${PROVIDER_DEFAULTS["claude-proxy"].baseUrl}`
                : form.provider === "ollama"
                  ? "Running in Docker? Use http://host.docker.internal:11434 instead of localhost."
                  : "Leave empty for the public Anthropic API."}
            </span>
          </label>
        )}

        {showCliPath && (
          <label className="block space-y-2">
            <span className="text-sm font-medium">CLI Path <span className="muted font-normal">(optional)</span></span>
            <input
              className="input"
              value={form.cliPath}
              onChange={(e) => update({ cliPath: e.target.value })}
              placeholder="/Users/you/.local/bin/claude"
              disabled={busy}
            />
            <span className="muted text-xs block">Leave blank to auto-resolve. Set if the server can't find the binary.</span>
          </label>
        )}

        {testResult && (
          <div
            role="status"
            className="rounded-xl px-4 py-3 text-sm"
            style={{ background: testResult.ok && testResult.vision !== false ? "#e3ecdc" : "var(--color-accent-soft)", color: "var(--color-ink)" }}
          >
            <p>{testResult.message}</p>
            {testResult.availableModels && testResult.availableModels.length > 0 && (
              <p className="mt-1 text-xs opacity-80">Installed: {testResult.availableModels.join(", ")}</p>
            )}
          </div>
        )}
        <ErrorNote error={test.error} />
        <ErrorNote error={save.error} />

        <div className="flex gap-2">
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => test.mutate(form)}>
            {test.isPending ? "Testing…" : "Test connection"}
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {save.isPending ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </div>
  );
}
