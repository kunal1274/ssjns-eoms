/** Public response formatting only; never render a raw exception or response body. */
export function requestFailure(
  status: number,
  value: unknown,
  headerId: string | null = null,
): string {
  const body =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  const publicMessage =
    status >= 400 && status < 500 && typeof body.error === "string"
      ? body.error.slice(0, 600)
      : "The service could not complete this request.";
  const guidance: Record<number, string> = {
    400: "Check the entered values and try again.",
    401: "Sign in again to continue.",
    403: "Check your selected estate and access with your administrator. For an expired session, sign in again.",
    404: "Refresh the list and check that the record is still available.",
    409: "Reload the current record and review its latest state before trying again.",
    413: "Reduce the amount of data and try again.",
    422: "Review the required fields and permitted values before submitting again.",
    429: "Wait a moment before trying again.",
  };
  const id = typeof body.requestId === "string" ? body.requestId : headerId;
  const reference =
    id &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
      ? `\nSupport reference: ${id}`
      : "";
  return `${publicMessage}\n${guidance[status] || "Check the record or device queue before retrying; a lost response may still have saved your action."}${reference}`;
}
export const connectionFailure =
  "The server response could not be read. Check your connection, then check the record or device queue before retrying; your action may already have been saved.";

/** Keep trusted HTTP status for recovery decisions, never the raw response body. */
export class RequestFailure extends Error {
  constructor(
    readonly status: number,
    value: unknown,
    headerId: string | null = null,
  ) {
    super(requestFailure(status, value, headerId));
    this.name = "RequestFailure";
  }
}
