import { useEffect, useRef, useState } from "react";
type Row = {
  id: string;
  name: string;
  code?: string;
  kind?: string;
  active?: boolean;
  eligible?: boolean;
  [key: string]: any;
};
type Api = (path: string, body?: unknown) => Promise<any>;
export function SearchSelect({
  api,
  path,
  label,
  value,
  onChange,
  seed = [],
  name,
  required = false,
  disabled = false,
  placeholder = "Choose a record",
  onReady,
  onReview,
  localOptions = [],
}: {
  api: Api;
  path: string | null;
  label: string;
  value: string;
  onChange: (id: string, row?: Row) => void;
  seed?: Row[];
  name?: string;
  required?: boolean;
  disabled?: boolean;
  placeholder?: string;
  onReady?: (ready: boolean) => void;
  onReview?: (row: Row) => void;
  localOptions?: Row[];
}) {
  const [term, setTerm] = useState(""),
    [query, setQuery] = useState(""),
    [rows, setRows] = useState<Row[]>([]),
    [selected, setSelected] = useState<Row | null>(null),
    [next, setNext] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [failedMore, setFailedMore] = useState(false),
    [attempt, setAttempt] = useState(0);
  const chosen = useRef<{ path: string | null; row: Row } | null>(null);
  const request = useRef(0),
    current = useRef(""),
    apiRef = useRef(api),
    readyRef = useRef(onReady);
  apiRef.current = api;
  readyRef.current = onReady;
  const context = JSON.stringify([path, query, value]);
  current.current = context;
  async function read(more = false) {
    if (!path) return;
    const generation = ++request.current,
      started = context;
    setBusy(true);
    setError("");
    try {
      const params = new URLSearchParams({ q: query, limit: "25" });
      if (value && !localOptions.some((row) => row.id === value))
        params.set("selectedId", value);
      if (more && next) params.set("cursor", next);
      const result = await apiRef.current(
        path + (path.includes("?") ? "&" : "?") + params,
      );
      if (generation !== request.current || current.current !== started) return;
      setRows((old) =>
        more
          ? [
              ...new Map(
                [...old, ...result.items].map((r: Row) => [r.id, r]),
              ).values(),
            ]
          : result.items,
      );
      setSelected(result.selected);
      setNext(result.nextCursor);
    } catch (e) {
      if (generation === request.current && current.current === started) {
        setError((e as Error).message);
        setFailedMore(more);
      }
    } finally {
      if (generation === request.current && current.current === started)
        setBusy(false);
    }
  }
  useEffect(() => {
    setRows([]);
    setNext(null);
    setSelected(null);
    setError("");
    if (path) void read();
    else setBusy(false);
    return () => {
      request.current++;
    };
  }, [path, query, value, attempt]);
  useEffect(() => {
    readyRef.current?.(
      !busy &&
        !error &&
        (!value ||
          localOptions.some((row) => row.id === value) ||
          (selected?.id === value && selected.eligible !== false)),
    );
  }, [
    busy,
    error,
    value,
    selected,
    JSON.stringify(localOptions.map((row) => row.id)),
  ]);
  const pinned =
    localOptions.find((row) => row.id === value) ||
    (selected?.id === value
      ? selected
      : chosen.current?.path === path && chosen.current.row.id === value
        ? chosen.current.row
        : seed.find((row) => row.id === value));
  const options = [
    ...new Map(
      [
        ...localOptions,
        ...(query ? [] : seed),
        ...rows,
        ...(pinned ? [pinned] : []),
      ].map((r) => [r.id, r]),
    ).values(),
  ];
  function search() {
    if (term.trim() === query) setAttempt((x) => x + 1);
    else setQuery(term.trim());
  }
  return (
    <div className="searchselect">
      <label>
        Search {label}
        <input
          aria-label={"Search " + label}
          maxLength={100}
          disabled={disabled || !path}
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              search();
            }
          }}
        />
      </label>
      <button
        type="button"
        className="secondary"
        disabled={disabled || busy || !path}
        onClick={search}
      >
        Find {label}
      </button>
      <label>
        {label}
        <select
          aria-label={label}
          name={name}
          required={required}
          disabled={disabled}
          value={value}
          onChange={(e) => {
            const id = e.target.value;
            const row = options.find((r) => r.id === id);
            chosen.current = row ? { path, row } : null;
            onChange(id, row);
          }}
        >
          <option value="">{placeholder}</option>
          {options.map((row) => (
            <option
              key={row.id}
              value={row.id}
              disabled={row.eligible === false}
            >
              {row.code ? row.code + " · " : ""}
              {row.name}
              {row.eligible === false
                ? " · Selected — no longer available"
                : ""}
            </option>
          ))}
        </select>
      </label>
      {onReview && value && (
        <button
          type="button"
          disabled={
            disabled ||
            busy ||
            !!error ||
            selected?.id !== value ||
            selected?.eligible === false
          }
          onClick={() => selected && onReview(selected)}
        >
          Load selected {label}
        </button>
      )}
      {busy && <p role="status">Loading {label} choices…</p>}
      {error && (
        <p role="alert" className="error">
          {error}{" "}
          <button
            type="button"
            disabled={disabled || busy}
            onClick={() => void read(failedMore)}
          >
            Retry {label}
          </button>
        </p>
      )}
      {next && (
        <button
          type="button"
          className="secondary"
          disabled={disabled || busy}
          onClick={() => void read(true)}
        >
          More {label}
        </button>
      )}
      {pinned && (
        <p data-selector-selection={label}>
          Selected: {pinned.code ? pinned.code + " · " : ""}
          {pinned.name}
          {pinned.eligible === false
            ? " — not eligible for a new choice; review availability/scope before saving."
            : ""}
        </p>
      )}
      {!busy && !error && path && !options.length && (
        <p>
          No matching {label} choices. Clear or change the search, then select
          Find {label}. No alternative is selected automatically.
        </p>
      )}
    </div>
  );
}
