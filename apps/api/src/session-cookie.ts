// Reject ambiguous cookies rather than selecting one of several session claims.
export function sessionCookie(header: string | undefined): string | null {
  const values = (header ?? "")
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.startsWith("eoms_session="))
    .map((part) => part.slice("eoms_session=".length));
  return values.length === 1 && /^[a-f0-9]{64}$/.test(values[0])
    ? values[0]
    : null;
}
