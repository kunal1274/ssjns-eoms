import { useEffect, useRef, useState } from "react";
import { RequestFailure } from "./feedback";
type Api = (path: string, body?: unknown) => Promise<any>;
export function HierarchyScopes({
  api,
  customerId,
  onPending,
  disabled,
}: {
  api: Api;
  customerId: string;
  onPending: (v: boolean) => void;
  disabled: boolean;
}) {
  const [caps, setCaps] = useState<any>(null),
    [contexts, setContexts] = useState<any>(null),
    [nodes, setNodes] = useState<any>(null),
    [audit, setAudit] = useState<any>(null),
    [read, setRead] = useState<any>(null),
    [context, setContext] = useState(""),
    [subject, setSubject] = useState(""),
    [kind, setKind] = useState("company"),
    [node, setNode] = useState(""),
    [inheritance, setInheritance] = useState("none"),
    [action, setAction] = useState("granted"),
    [reference, setReference] = useState(""),
    [reason, setReason] = useState(""),
    [search, setSearch] = useState(""),
    [query, setQuery] = useState(""),
    [readSearch, setReadSearch] = useState(""),
    [readQuery, setReadQuery] = useState(""),
    [nodeCursor, setNodeCursor] = useState<string | null>(null),
    [auditCursor, setAuditCursor] = useState<string | null>(null),
    [readCursor, setReadCursor] = useState<string | null>(null),
    [contextCursor, setContextCursor] = useState<string | null>(null),
    [attempt, setAttempt] = useState(0),
    [loading, setLoading] = useState(true),
    [readError, setReadError] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [pending, setPending] = useState(false);
  const live = useRef(true),
    write = useRef<{ path: string; body: any } | null>(null),
    subjectValid = /^[a-fA-F0-9-]{36}$/.test(subject);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      onPending(false);
    };
  }, []);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setReadError("");
    setCaps(null);
    setNodes(null);
    setAudit(null);
    setContexts(null);
    setRead(null);
    (async () => {
      const c = await api(
          "/provisioning/capabilities" +
            (customerId ? "?customerId=" + customerId : ""),
        ),
        ctx = await api(
          "/hierarchy-scopes/contexts?limit=10" +
            (contextCursor
              ? "&cursor=" + encodeURIComponent(contextCursor)
              : ""),
        ),
        n = c.canManageCustomer
          ? await api(
              "/customers/" +
                customerId +
                "/hierarchy-scopes/nodes?limit=10&nodeKind=" +
                kind +
                "&q=" +
                encodeURIComponent(query) +
                (nodeCursor ? "&cursor=" + encodeURIComponent(nodeCursor) : ""),
            )
          : null,
        a =
          c.canManageCustomer && subjectValid && node
            ? await api(
                "/customers/" +
                  customerId +
                  "/hierarchy-scopes?limit=10&subjectId=" +
                  subject +
                  "&nodeKind=" +
                  kind +
                  "&nodeId=" +
                  node +
                  (auditCursor
                    ? "&cursor=" + encodeURIComponent(auditCursor)
                    : ""),
              )
            : null,
        r = context
          ? await api(
              "/customers/" +
                context +
                "/hierarchy-scopes/read?limit=10&q=" +
                encodeURIComponent(readQuery) +
                (readCursor ? "&cursor=" + encodeURIComponent(readCursor) : ""),
            )
          : null;
      if (active) {
        setCaps(c);
        setContexts(ctx);
        setNodes(n);
        setAudit(a);
        setRead(r);
      }
    })()
      .catch((e) => {
        if (active) {
          setReadError(e.message);
          if (
            e instanceof RequestFailure &&
            [401, 403, 404].includes(e.status)
          ) {
            setContext("");
            setReference("");
            setReason("");
          }
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [
    customerId,
    context,
    subject,
    kind,
    node,
    query,
    readQuery,
    nodeCursor,
    auditCursor,
    readCursor,
    contextCursor,
    attempt,
  ]);
  const locked = disabled || loading || busy || pending || !!readError,
    valid =
      caps?.canManageCustomer &&
      subjectValid &&
      node &&
      audit &&
      reference.trim().length >= 3 &&
      reason.trim().length >= 3 &&
      (action === "granted" || audit.head?.action === "granted");
  async function submit() {
    if (disabled || loading || busy || readError || (!write.current && !valid))
      return;
    write.current ??= {
      path: "/customers/" + customerId + "/hierarchy-scopes",
      body: {
        key: crypto.randomUUID(),
        subjectId: subject,
        nodeKind: kind,
        nodeId: node,
        inheritance,
        action,
        expectedRevision: audit.head?.revision ?? 0,
        reference: reference.trim(),
        reason: reason.trim(),
      },
    };
    const saved = write.current;
    setBusy(true);
    setPending(true);
    onPending(true);
    setError("");
    setNotice("");
    try {
      const v = await api(saved.path, saved.body);
      if (live.current) {
        setNotice(
          (v.replayed ? "Recovered existing receipt. " : "Recorded. ") +
            "Hierarchy-read assignment revision " +
            v.grant.revision +
            ". Work access remains unchanged.",
        );
        write.current = null;
        setPending(false);
        onPending(false);
        setReference("");
        setReason("");
        setAuditCursor(null);
        setAttempt((n) => n + 1);
      }
    } catch (e) {
      if (live.current) {
        const uncertain = !(e instanceof RequestFailure) || e.status >= 500;
        if (!uncertain) {
          write.current = null;
          setPending(false);
          onPending(false);
        }
        if (e instanceof RequestFailure && [401, 403, 404].includes(e.status)) {
          setCaps(null);
          setAudit(null);
          setNodes(null);
          setRead(null);
          setContexts(null);
          setReference("");
          setReason("");
          setContext("");
        }
        setError(
          (e as Error).message +
            (uncertain
              ? " Retry unchanged submission to recover a possibly committed receipt. Fields and navigation are locked."
              : " Refresh hierarchy scope and review the current assignment before correcting the retained draft."),
        );
      }
    } finally {
      if (live.current) setBusy(false);
    }
  }
  return (
    <section
      aria-label="Explicit hierarchy read scopes"
      style={{ overflowWrap: "anywhere", minWidth: 0 }}
    >
      <h3>Explicit hierarchy visibility and inheritance</h3>
      <p>
        Hierarchy-read assignments show only the authorized node names and
        codes. Choose one node or its descendants explicitly. They never create
        work membership, setup authority, sibling/upward access or finance
        access. Company descendants follow recorded baseline company links;
        dated responsibility does not grant work access.
      </p>
      <button
        disabled={disabled || loading || busy || pending}
        onClick={() => setAttempt((n) => n + 1)}
      >
        Refresh hierarchy scope
      </button>
      {loading && <p role="status">Loading explicit hierarchy visibility…</p>}
      {readError && <p role="alert">{readError}</p>}
      {caps && contexts && (
        <>
          {caps.canManageCustomer && (
            <section aria-label="Assign hierarchy visibility">
              <h4>Assign metadata-only scope</h4>
              <p>Selected customer {customerId} · permission hierarchy.read</p>
              <label>
                Hierarchy reader ID
                <input
                  aria-label="Hierarchy reader ID"
                  disabled={locked}
                  maxLength={36}
                  value={subject}
                  onChange={(e) => {
                    setSubject(e.target.value);
                    setAuditCursor(null);
                  }}
                />
              </label>
              <label>
                Hierarchy scope node kind
                <select
                  aria-label="Hierarchy scope node kind"
                  disabled={locked}
                  value={kind}
                  onChange={(e) => {
                    setKind(e.target.value);
                    setNode("");
                    setNodeCursor(null);
                    setAuditCursor(null);
                  }}
                >
                  {[
                    "customer",
                    "group",
                    "company",
                    "area",
                    "estate",
                    "unit",
                    "site",
                  ].map((k) => (
                    <option key={k}>{k}</option>
                  ))}
                </select>
              </label>
              <label>
                Search assignment node
                <input
                  aria-label="Search assignment node"
                  disabled={locked}
                  maxLength={100}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </label>
              <button
                disabled={locked}
                onClick={() => {
                  setQuery(search.trim());
                  setNodeCursor(null);
                  setAttempt((n) => n + 1);
                }}
              >
                Find assignment node
              </button>
              <label>
                Hierarchy assignment node
                <select
                  aria-label="Hierarchy assignment node"
                  disabled={locked}
                  value={node}
                  onChange={(e) => {
                    setNode(e.target.value);
                    setAuditCursor(null);
                  }}
                >
                  <option value="">Choose an explicit node</option>
                  {nodes?.items.map((n: any) => (
                    <option key={n.id} value={n.id}>
                      {n.code} · {n.name} · {n.id}
                    </option>
                  ))}
                  {node && !nodes?.items.some((n: any) => n.id === node) && (
                    <option value={node}>Selected node {node}</option>
                  )}
                </select>
              </label>
              <button
                disabled={locked || !nodes?.nextCursor}
                onClick={() => setNodeCursor(nodes.nextCursor)}
              >
                Next assignment nodes
              </button>
              <p data-hierarchy-grant-head>
                Selected subject {subject || "None"} · Node {node || "None"} ·
                Revision {audit?.head?.revision ?? 0} ·{" "}
                {audit?.head?.action ?? "No assignment"}
              </p>
              <form
                aria-label="Record hierarchy-read assignment"
                onSubmit={(e) => {
                  e.preventDefault();
                  void submit();
                }}
              >
                <fieldset disabled={locked || !audit}>
                  <label>
                    Hierarchy scope inheritance
                    <select
                      aria-label="Hierarchy scope inheritance"
                      value={inheritance}
                      onChange={(e) => setInheritance(e.target.value)}
                    >
                      <option value="none">This node only</option>
                      <option value="descendants">
                        This node and descendants
                      </option>
                    </select>
                  </label>
                  <label>
                    Hierarchy scope action
                    <select
                      aria-label="Hierarchy scope action"
                      value={action}
                      onChange={(e) => setAction(e.target.value)}
                    >
                      <option value="granted">
                        Grant explicit hierarchy read
                      </option>
                      <option value="revoked">
                        Revoke explicit hierarchy read
                      </option>
                    </select>
                  </label>
                  <label>
                    Hierarchy scope authority reference
                    <input
                      aria-label="Hierarchy scope authority reference"
                      required
                      minLength={3}
                      maxLength={240}
                      value={reference}
                      onChange={(e) => setReference(e.target.value)}
                    />
                  </label>
                  <label>
                    Hierarchy scope reason
                    <textarea
                      aria-label="Hierarchy scope reason"
                      required
                      minLength={3}
                      maxLength={500}
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                    />
                  </label>
                </fieldset>
                <button
                  disabled={
                    disabled ||
                    loading ||
                    busy ||
                    !!readError ||
                    (!pending && !valid)
                  }
                >
                  Save hierarchy-read assignment
                </button>
              </form>
              {audit?.items.map((g: any) => (
                <article key={g.id} data-hierarchy-grant={g.id}>
                  <strong>
                    {g.action} · Revision {g.revision} · {g.inheritance}
                  </strong>
                  <p>
                    {g.reason} · {g.created_at}
                  </p>
                  <details>
                    <summary>View detailed hierarchy scope audit</summary>
                    <p>
                      Grant {g.id} · Previous{" "}
                      {g.previous_id ?? "First assignment"} · Actor {g.actor_id}{" "}
                      · Subject {g.subject_id} · Node {g.node_kind}/{g.node_id}{" "}
                      · Authority {g.reference} · Support {g.request_id}
                    </p>
                  </details>
                </article>
              ))}
              <button
                disabled={locked || !audit?.nextCursor}
                onClick={() => setAuditCursor(audit.nextCursor)}
              >
                Next hierarchy scope history
              </button>
            </section>
          )}
          <section aria-label="Your explicitly granted hierarchy">
            <h4>Read your granted hierarchy</h4>
            <label>
              Granted hierarchy customer
              <select
                aria-label="Granted hierarchy customer"
                disabled={locked}
                value={context}
                onChange={(e) => {
                  setContext(e.target.value);
                  setReadCursor(null);
                }}
              >
                <option value="">Choose a granted customer context</option>
                {contexts.items.map((c: any) => (
                  <option key={c.id} value={c.id}>
                    {c.code} · {c.name}
                  </option>
                ))}
                {context &&
                  !contexts.items.some((c: any) => c.id === context) && (
                    <option value={context}>Selected context {context}</option>
                  )}
              </select>
            </label>
            <button
              disabled={locked || !contexts.nextCursor}
              onClick={() => setContextCursor(contexts.nextCursor)}
            >
              Next granted hierarchy customers
            </button>
            {!contexts.items.length && (
              <p>
                No current explicit hierarchy-read context is available.
                Existing estate work memberships remain separate.
              </p>
            )}
            {context && (
              <>
                <label>
                  Search granted hierarchy
                  <input
                    aria-label="Search granted hierarchy"
                    disabled={locked}
                    value={readSearch}
                    maxLength={100}
                    onChange={(e) => setReadSearch(e.target.value)}
                  />
                </label>
                <button
                  disabled={locked}
                  onClick={() => {
                    setReadQuery(readSearch.trim());
                    setReadCursor(null);
                    setAttempt((n) => n + 1);
                  }}
                >
                  Find granted hierarchy
                </button>
              </>
            )}
            {read && (
              <>
                <p>
                  Permission hierarchy.read · Work access granted: No. Current
                  read window.
                </p>
                {read.items.map((n: any) => (
                  <article
                    key={n.kind + "/" + n.id}
                    data-scope-node={n.kind + "/" + n.id}
                  >
                    <strong>
                      {n.kind} · {n.code} · {n.name}
                    </strong>
                    <p>Stable node {n.id}</p>
                  </article>
                ))}
                {!read.items.length && (
                  <p>No authorized hierarchy nodes match this search.</p>
                )}
                <button
                  disabled={locked || !read.nextCursor}
                  onClick={() => setReadCursor(read.nextCursor)}
                >
                  Next granted hierarchy nodes
                </button>
                <button
                  disabled={locked || !readCursor}
                  onClick={() => setReadCursor(null)}
                >
                  First granted hierarchy nodes
                </button>
              </>
            )}
          </section>
        </>
      )}
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
    </section>
  );
}
