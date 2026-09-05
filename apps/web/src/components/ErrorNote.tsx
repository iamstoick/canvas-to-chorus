export default function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null;
  const message = error instanceof Error ? error.message : String(error);
  return (
    <p role="alert" className="text-sm rounded-xl px-4 py-3" style={{ background: "var(--color-accent-soft)", color: "var(--color-ink)" }}>
      {message}
    </p>
  );
}
