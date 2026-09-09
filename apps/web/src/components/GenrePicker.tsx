import { useState } from "react";
import { GENRES, type ComposeRequest } from "@artlyrics/shared";

const OTHER = "__other__";

interface Props {
  value: ComposeRequest;
  onChange: (v: ComposeRequest) => void;
  disabled?: boolean;
  compact?: boolean;
}

/** Genre + free-text direction for compose. Empty genre = let the artwork decide. */
export default function GenrePicker({ value, onChange, disabled, compact }: Props) {
  const isListed = !value.genre || (GENRES as readonly string[]).includes(value.genre);
  const [other, setOther] = useState(!isListed);
  const selectValue = other ? OTHER : value.genre ?? "";

  function onSelect(v: string) {
    if (v === OTHER) {
      setOther(true);
      onChange({ ...value, genre: "" });
    } else {
      setOther(false);
      onChange({ ...value, genre: v });
    }
  }

  return (
    <div className={`grid gap-3 ${compact ? "" : "sm:grid-cols-2"}`}>
      <label className="text-sm space-y-1">
        <span className="muted text-xs block">Genre</span>
        <select className="input" value={selectValue} onChange={(e) => onSelect(e.target.value)} disabled={disabled} aria-label="Genre">
          <option value="">Let the artwork decide</option>
          {GENRES.map((g) => (
            <option key={g} value={g}>{g}</option>
          ))}
          <option value={OTHER}>Other…</option>
        </select>
        {other && (
          <input
            className="input mt-2"
            placeholder="Type a genre, e.g. Shoegaze"
            value={value.genre ?? ""}
            onChange={(e) => onChange({ ...value, genre: e.target.value })}
            maxLength={60}
            disabled={disabled}
            aria-label="Custom genre"
          />
        )}
      </label>
      <label className="text-sm space-y-1">
        <span className="muted text-xs block">Style notes <span className="opacity-70">(optional)</span></span>
        <input
          className="input"
          placeholder="e.g. female vocals, 80s synths, upbeat"
          value={value.styleNotes ?? ""}
          onChange={(e) => onChange({ ...value, styleNotes: e.target.value })}
          maxLength={240}
          disabled={disabled}
          aria-label="Style notes"
        />
      </label>
    </div>
  );
}
