import { SearchSelect } from "./SearchSelect";
import { EstateLifecycle } from "./EstateLifecycle";
import { EstateResponsibility } from "./EstateResponsibility";
import { OperatingPlacement } from "./OperatingPlacement";
import { useEffect, useState } from "react";
type Unit = {
  id: string;
  kind: string;
  code: string;
  name: string;
  parent_id: string | null;
  version: number;
  active: boolean;
};
type Context = {
  canConfigure: boolean;
  truncated: boolean;
  groups: { id: string; code: string; name: string }[];
  companies: {
    id: string;
    name: string;
    group_id: string | null;
    hierarchy_version: number;
  }[];
  estates: { id: string; name: string }[];
};
type Change = {
  id: string;
  record_id: string;
  record_type: string;
  action: string;
  actor: string;
  reason: string;
  request_id: string | null;
  created_at: string;
  before: {
    code?: string;
    name?: string;
    parentId?: string;
    groupId?: string;
    version?: number;
  };
  after: {
    code?: string;
    name?: string;
    parentId?: string;
    groupId?: string;
    version?: number;
  };
};
const empty: Context = {
  canConfigure: false,
  truncated: false,
  groups: [],
  companies: [],
  estates: [],
};
export function HierarchySetup({
  api,
  customerId,
}: {
  api: (path: string, body?: unknown) => Promise<any>;
  customerId: string;
}) {
  const [data, setData] = useState(empty),
    [estate, setEstate] = useState(""),
    [company, setCompany] = useState(""),
    [companyRecord, setCompanyRecord] = useState<
      Context["companies"][number] | null
    >(null),
    [companyReady, setCompanyReady] = useState(false),
    [groupReady, setGroupReady] = useState(false),
    [group, setGroup] = useState(""),
    [units, setUnits] = useState<Unit[]>([]),
    [changes, setChanges] = useState<Change[]>([]),
    [loading, setLoading] = useState(true),
    [unitsLoading, setUnitsLoading] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [truncated, setTruncated] = useState(false),
    [needsRefresh, setNeedsRefresh] = useState(false),
    [estateReady, setEstateReady] = useState(false),
    [parentReady, setParentReady] = useState(false);
  const [editing, setEditing] = useState<Unit | null>(null),
    [kind, setKind] = useState("division"),
    [code, setCode] = useState(""),
    [name, setName] = useState(""),
    [parent, setParent] = useState(""),
    [unitReason, setUnitReason] = useState("");
  const [groupCode, setGroupCode] = useState(""),
    [groupName, setGroupName] = useState(""),
    [groupReason, setGroupReason] = useState(""),
    [assignmentReason, setAssignmentReason] = useState("");
  const base = `/customers/${customerId}/hierarchy`;
  function resetUnit() {
    setEditing(null);
    setKind("division");
    setCode("");
    setName("");
    setParent("");
    setUnitReason("");
  }
  async function loadContext() {
    const [context, history] = await Promise.all([
      api(base),
      api(base + "/history"),
    ]);
    setData(context);
    setChanges(history.items);
    setTruncated(history.truncated);
    // Preserve an explicitly searched estate beyond the bounded overview.
    // The selected-record API and unit reads revalidate access; never fall back to a different estate after a write.
    setEstate((current) => current || context.estates[0]?.id || "");
    setCompany((current) => current || context.companies[0]?.id || "");
  }
  async function loadUnits(id: string) {
    if (!id) return;
    const result = await api(`/estates/${id}/units`);
    setUnits(result.items);
    if (result.truncated) setTruncated(true);
  }
  useEffect(() => {
    let active = true;
    Promise.all([api(base), api(base + "/history")])
      .then(([context, history]) => {
        if (active) {
          setData(context);
          setChanges(history.items);
          setTruncated(history.truncated);
          setEstate(context.estates[0]?.id || "");
          chooseCompany(context.companies[0]?.id || "", context.companies[0]);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [customerId]);
  useEffect(() => {
    let active = true;
    setUnits([]);
    resetUnit();
    if (estate) {
      setUnitsLoading(true);
      api(`/estates/${estate}/units`)
        .then((result) => {
          if (active) {
            setUnits(result.items);
            if (result.truncated) setTruncated(true);
          }
        })
        .catch((e) => {
          if (active) setError(e.message);
        })
        .finally(() => {
          if (active) setUnitsLoading(false);
        });
    }
    return () => {
      active = false;
    };
  }, [estate]);
  async function save(
    action: () => Promise<unknown>,
    success: string,
    reset: () => void,
  ) {
    setBusy(true);
    setError("");
    setMessage("");
    let committed = false;
    try {
      await action();
      committed = true;
      setMessage(success);
      reset();
      await loadContext();
      await loadUnits(estate);
      setNeedsRefresh(false);
    } catch (e) {
      if (committed) setNeedsRefresh(true);
      setError(
        (committed
          ? "Change saved, but refreshing the lists failed. Refresh lists before another write. "
          : "") + (e as Error).message,
      );
    } finally {
      setBusy(false);
    }
  }
  async function refresh() {
    setBusy(true);
    setError("");
    try {
      await loadContext();
      await loadUnits(estate);
      setNeedsRefresh(false);
      setMessage(
        "Lists reloaded. Search Existing unit and select Load selected Existing unit, or choose Edit, to load the latest saved version.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function editUnit(row: Unit) {
    setEditing(row);
    setKind(row.kind);
    setCode(row.code);
    setName(row.name);
    setParent(row.parent_id || "");
    setUnitReason("");
  }
  const parents = units.filter(
    (row) =>
      row.active &&
      row.id !== editing?.id &&
      (kind === "field"
        ? row.kind === "division"
        : kind === "block"
          ? ["division", "field"].includes(row.kind)
          : false),
  );
  function chooseCompany(id: string, row?: any) {
    setCompany(id);
    setCompanyRecord(row || null);
    setGroup(row?.group_id || "");
    setAssignmentReason("");
  }
  const selectedCompany =
    companyRecord?.id === company
      ? companyRecord
      : data.companies.find((row) => row.id === company);
  return (
    <section className="editor" aria-label="Hierarchy setup">
      <h3>Hierarchy setup</h3>
      <EstateResponsibility
        key={"legal-" + customerId}
        api={api}
        customerId={customerId}
      />
      <OperatingPlacement key={customerId} api={api} customerId={customerId} />
      <EstateLifecycle
        key={"availability-" + customerId}
        customerId={customerId}
        api={api}
        estates={data.estates}
      />
      <p>
        Optional legal group → company. Within each assigned estate: division →
        optional field → block. Structure does not grant operational access.
        Every saved change needs a reason.
      </p>
      {loading && <p role="status">Loading hierarchy setup…</p>}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      {truncated || data.truncated ? (
        <p>
          The overview tables show a bounded portion of the hierarchy/history.
          Search Hierarchy estate, Existing unit or Unit parent to find other
          records. Other configuration and decision-ledger navigation remains
          pending.
        </p>
      ) : null}
      {!loading && (
        <>
          <button
            className="secondary"
            disabled={busy}
            onClick={() => void refresh()}
          >
            Refresh hierarchy lists
          </button>
          {!data.canConfigure && (
            <p>
              View only. Ask your administrator for explicit hierarchy setup
              access; an estate role alone does not permit changes.
            </p>
          )}
          {data.canConfigure && (
            <div className="grid">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void save(
                    () =>
                      api(`/customers/${customerId}/groups`, {
                        code: groupCode,
                        name: groupName,
                        reason: groupReason,
                      }),
                    "Group saved.",
                    () => {
                      setGroupCode("");
                      setGroupName("");
                      setGroupReason("");
                    },
                  );
                }}
              >
                <h4>1. Create an optional legal group</h4>
                <label>
                  Group code
                  <input
                    required
                    maxLength={30}
                    value={groupCode}
                    onChange={(e) => setGroupCode(e.target.value)}
                  />
                </label>
                <label>
                  Group name
                  <input
                    required
                    maxLength={160}
                    value={groupName}
                    onChange={(e) => setGroupName(e.target.value)}
                  />
                </label>
                <label>
                  Group reason
                  <textarea
                    aria-label="Group reason"
                    required
                    minLength={3}
                    maxLength={500}
                    value={groupReason}
                    onChange={(e) => setGroupReason(e.target.value)}
                  />
                </label>
                <button disabled={busy || needsRefresh}>Save group</button>
              </form>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (selectedCompany)
                    void save(
                      async () => {
                        const saved = await api(
                          `/customers/${customerId}/companies/${company}/group`,
                          {
                            groupId: group || null,
                            version: selectedCompany.hierarchy_version,
                            reason: assignmentReason,
                          },
                        );
                        setCompanyRecord(saved);
                        return saved;
                      },
                      "Company group saved.",
                      () => setAssignmentReason(""),
                    );
                }}
              >
                <h4>2. Assign a company</h4>
                <SearchSelect
                  api={api}
                  path={`/navigation/customers/${customerId}/companies`}
                  label="Hierarchy company"
                  value={company}
                  onChange={chooseCompany}
                  onReview={(row) => chooseCompany(row.id, row)}
                  onReady={setCompanyReady}
                  seed={data.companies}
                  required
                  disabled={busy}
                />
                <p>
                  After a conflict, refresh hierarchy lists, Find Hierarchy
                  company, then Load selected Hierarchy company to review the
                  latest version. This explicit reload replaces the group draft
                  and clears its previous reason.
                </p>
                <SearchSelect
                  api={api}
                  path={`/navigation/customers/${customerId}/groups`}
                  label="Group assignment"
                  value={group}
                  onChange={setGroup}
                  onReady={setGroupReady}
                  seed={data.groups}
                  disabled={busy}
                  placeholder="No group"
                />
                <label>
                  Assignment reason
                  <textarea
                    aria-label="Assignment reason"
                    required
                    minLength={3}
                    maxLength={500}
                    value={assignmentReason}
                    onChange={(e) => setAssignmentReason(e.target.value)}
                  />
                </label>
                <button
                  disabled={
                    busy ||
                    needsRefresh ||
                    !selectedCompany ||
                    !companyReady ||
                    !groupReady
                  }
                >
                  Save company group
                </button>
              </form>
            </div>
          )}
          <h4>3. Review or configure operating units</h4>
          <SearchSelect
            api={api}
            path={`/navigation/estates?customerId=${customerId}`}
            label="Hierarchy estate"
            onReady={setEstateReady}
            value={estate}
            onChange={setEstate}
            seed={data.estates}
            disabled={busy}
          />
          {data.canConfigure && estate && (
            <SearchSelect
              key={"edit-" + estate}
              api={api}
              path={`/navigation/estates/${estate}/units?status=all`}
              label="Existing unit"
              onReview={(row) => editUnit(row as Unit)}
              value={editing?.id || ""}
              onChange={(_id, row) =>
                row ? editUnit(row as Unit) : resetUnit()
              }
              seed={units}
              disabled={busy}
              placeholder="Choose a unit to edit, or create below"
            />
          )}
          {unitsLoading && <p role="status">Loading operating units…</p>}
          {!unitsLoading && !error && !units.length && (
            <p>
              No units are configured for this estate. An authorized setup
              administrator can add a division, optional field and block.
            </p>
          )}
          {data.canConfigure && estate && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void save(
                  () =>
                    api(
                      `/estates/${estate}/units` +
                        (editing ? "/" + editing.id : ""),
                      {
                        kind,
                        code,
                        name,
                        parentId: parent || null,
                        reason: unitReason,
                        ...(editing ? { version: editing.version } : {}),
                      },
                    ),
                  "Unit saved.",
                  resetUnit,
                );
              }}
            >
              <p>
                {editing
                  ? "Editing " +
                    editing.code +
                    " · saved version " +
                    editing.version
                  : "Create a new unit"}
                . After a conflict, refresh lists, search Existing unit and
                select Load selected Existing unit, or use its Edit button.
              </p>
              <div className="grid">
                <label>
                  Unit type
                  <select
                    aria-label="Unit type"
                    value={kind}
                    disabled={busy || !!editing}
                    onChange={(e) => {
                      setKind(e.target.value);
                      setParent("");
                    }}
                  >
                    <option value="division">Division</option>
                    <option value="field">Field</option>
                    <option value="block">Block</option>
                  </select>
                </label>
                <SearchSelect
                  key={estate + "-" + kind + "-" + (editing?.id || "new")}
                  api={api}
                  path={
                    kind === "division"
                      ? null
                      : `/navigation/estates/${estate}/units?kind=parent-${kind}&status=active` +
                        (editing ? `&excludeId=${editing.id}` : "")
                  }
                  label="Unit parent"
                  onReady={setParentReady}
                  value={parent}
                  onChange={setParent}
                  seed={parents}
                  required={kind !== "division"}
                  disabled={busy || kind === "division"}
                  placeholder={
                    kind === "division"
                      ? "Estate root"
                      : "Choose an allowed parent"
                  }
                />
                <label>
                  Unit code
                  <input
                    required
                    maxLength={30}
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                  />
                </label>
                <label>
                  Unit name
                  <input
                    required
                    maxLength={160}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </label>
              </div>
              <label>
                Unit reason
                <textarea
                  aria-label="Unit reason"
                  required
                  minLength={3}
                  maxLength={500}
                  value={unitReason}
                  onChange={(e) => setUnitReason(e.target.value)}
                />
              </label>
              <div className="actions">
                <button
                  disabled={
                    busy ||
                    needsRefresh ||
                    unitsLoading ||
                    !estateReady ||
                    (kind !== "division" && !parentReady)
                  }
                >
                  Save unit
                </button>
                <button
                  type="button"
                  className="secondary"
                  disabled={busy}
                  onClick={resetUnit}
                >
                  Clear unit form
                </button>
              </div>
            </form>
          )}
          {!!units.length && (
            <div className="tablewrap">
              <table>
                <thead>
                  <tr>
                    <th>Type/code</th>
                    <th>Name</th>
                    <th>Parent</th>
                    <th>Version/action</th>
                  </tr>
                </thead>
                <tbody>
                  {units.map((row) => (
                    <tr key={row.id} data-unit-code={row.code}>
                      <td>
                        {row.kind} · {row.code}
                      </td>
                      <td>
                        {row.name} · {row.active ? "Active" : "Inactive"}
                      </td>
                      <td>
                        {units.find((p) => p.id === row.parent_id)?.code ||
                          "Estate root"}
                      </td>
                      <td>
                        {row.version}{" "}
                        {data.canConfigure && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => {
                              editUnit(row);
                            }}
                          >
                            Edit
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <h4>Recent hierarchy changes</h4>
          <p>
            Only permitted display/relationship changes are shown. Times use
            your device timezone.
          </p>
          {!changes.length && <p>No permitted hierarchy changes recorded.</p>}
          {changes.map((change) => (
            <article
              className="event"
              key={change.id}
              data-hierarchy-record-id={change.record_id}
            >
              <div className="eventbody">
                <strong>
                  {change.record_type === "unit"
                    ? "Unit"
                    : change.record_type === "area"
                      ? "Operating area"
                      : change.record_type === "estate-placement"
                        ? "Estate placement"
                        : change.record_type === "task-link"
                          ? "Task block link"
                          : change.record_type === "company"
                            ? "Company"
                            : change.record_type === "setup-grant"
                              ? "Setup grant"
                              : "Group"}{" "}
                  {change.action} · {change.after.code || change.after.name}
                </strong>
                <small>
                  {change.actor} ·{" "}
                  {new Date(change.created_at).toLocaleString()}
                </small>
                <p>{change.reason}</p>
                <details>
                  <summary>View hierarchy change details</summary>
                  <dl className="auditdetails">
                    <dt>Before name / version</dt>
                    <dd>
                      {change.before.name || "No previous name"} ·{" "}
                      {change.before.version || "—"}
                    </dd>
                    <dt>After name / version</dt>
                    <dd>
                      {change.after.name} · {change.after.version}
                    </dd>
                    <dt>Parent / group reference</dt>
                    <dd>
                      {change.before.parentId ||
                        change.before.groupId ||
                        "None"}{" "}
                      →{" "}
                      {change.after.parentId || change.after.groupId || "None"}
                    </dd>
                    {change.request_id && (
                      <>
                        <dt>Support reference</dt>
                        <dd>{change.request_id}</dd>
                      </>
                    )}
                  </dl>
                </details>
              </div>
            </article>
          ))}
        </>
      )}
    </section>
  );
}
