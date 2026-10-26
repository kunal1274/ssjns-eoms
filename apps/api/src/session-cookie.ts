// Reject ambiguous cookies rather than selecting one of several session claims.
export function opaqueCookie(
  header: string | undefined,
  name: string,
): string | null {
  const values = (header ?? "")
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.startsWith(name + "="))
    .map((part) => part.slice(name.length + 1));
  return values.length === 1 && /^[a-f0-9]{64}$/.test(values[0])
    ? values[0]
    : null;
}

export const sessionCookie = (header: string | undefined) =>
  opaqueCookie(header, "eoms_session");
