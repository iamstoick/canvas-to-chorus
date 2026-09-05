import type { AnalysisRecord, ArtworkDetail, ArtworkSummary, ProviderSettings, ProviderSettingsUpdate, ProviderTestResult, QuestionAnswer } from "@artlyrics/shared";

const BASE = import.meta.env.VITE_API_BASE ?? "/api";

export class ApiClientError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function handle<T>(res: Response): Promise<T> {
  if (res.ok) return (res.status === 204 ? undefined : await res.json()) as T;
  let code = "http_error";
  let message = res.statusText || "Request failed";
  try {
    const body = await res.json();
    code = body?.error?.code ?? code;
    message = body?.error?.message ?? message;
  } catch {
    /* non-JSON error body */
  }
  throw new ApiClientError(res.status, code, message);
}

export type ArtworkDetailResponse = ArtworkDetail & { suggestedQuestions: string[] };
export type AskResponse = QuestionAnswer & { remaining: number };

export const api = {
  uploadArtwork(file: File, onProgress?: (pct: number) => void): Promise<ArtworkSummary> {
    // XHR for upload progress; fetch has no upload progress events.
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `${BASE}/artworks`);
      xhr.withCredentials = true;
      xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(Math.round((e.loaded / e.total) * 100));
      xhr.onload = () => {
        try {
          const body = JSON.parse(xhr.responseText || "{}");
          if (xhr.status >= 200 && xhr.status < 300) resolve(body);
          else reject(new ApiClientError(xhr.status, body?.error?.code ?? "http_error", body?.error?.message ?? xhr.statusText));
        } catch (e) {
          reject(e);
        }
      };
      xhr.onerror = () => reject(new ApiClientError(0, "network", "Network error during upload"));
      const form = new FormData();
      form.append("file", file);
      xhr.send(form);
    });
  },

  getArtwork: (id: string) => fetch(`${BASE}/artworks/${id}`, { credentials: "include" }).then((r) => handle<ArtworkDetailResponse>(r)),

  askQuestion: (id: string, question: string) =>
    fetch(`${BASE}/artworks/${id}/questions`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question }),
    }).then((r) => handle<AskResponse>(r)),

  compose: (id: string) =>
    fetch(`${BASE}/artworks/${id}/compose`, { method: "POST", credentials: "include" }).then((r) => handle<AnalysisRecord>(r)),

  getSettings: () => fetch(`${BASE}/settings`, { credentials: "include" }).then((r) => handle<ProviderSettings>(r)),

  saveSettings: (update: ProviderSettingsUpdate) =>
    fetch(`${BASE}/settings`, {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(update),
    }).then((r) => handle<ProviderSettings>(r)),

  testSettings: (update: ProviderSettingsUpdate) =>
    fetch(`${BASE}/settings/test`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(update),
    }).then((r) => handle<ProviderTestResult>(r)),

  deleteArtwork: (id: string) => fetch(`${BASE}/artworks/${id}`, { method: "DELETE", credentials: "include" }).then((r) => handle<void>(r)),
};
