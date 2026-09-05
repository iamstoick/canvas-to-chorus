import type { ProviderSettings } from "@artlyrics/shared";
import { anthropicProvider } from "./claude.js";
import { claudeCliProvider, claudeProxyProvider } from "./claudeCli.js";
import { ollamaProvider } from "./ollama.js";
import type { AnalysisProvider, ProviderFactory } from "./provider.js";

export const providerFactory: ProviderFactory = (settings: ProviderSettings): AnalysisProvider => {
  switch (settings.provider) {
    case "claude-cli":
      return claudeCliProvider(settings);
    case "claude-proxy":
      return claudeProxyProvider(settings);
    case "ollama":
      return ollamaProvider(settings);
    case "anthropic":
      return anthropicProvider(settings);
    default: {
      const never: never = settings.provider;
      throw new Error(`Unknown provider ${String(never)}`);
    }
  }
};
