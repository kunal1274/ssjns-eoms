import { createPublicKey, verify, createHash } from "node:crypto";
import type { Express } from "express";
import type { Pool } from "pg";
import { z } from "zod";
import { ApiError } from "./http";
import { hash, token } from "./security";
import { opaqueCookie, sessionCookie } from "./session-cookie";
export type OidcConfig = {
  issuer: string;
  clientId: string;
  clientSecret?: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  jwksUri: string;
  redirectUri: string;
  recoveryUrl: string;
  securityUrl: string;
  mfaAcrs: string[];
  allowLoopbackTest?: boolean;
};
export function oidcFromEnv(): OidcConfig | undefined {
  if (!process.env.OIDC_ISSUER) return undefined;
  return validateOidcConfig({
    issuer: process.env.OIDC_ISSUER,
    clientId: process.env.OIDC_CLIENT_ID!,
    clientSecret: process.env.OIDC_CLIENT_SECRET,
    authorizationEndpoint: process.env.OIDC_AUTHORIZATION_ENDPOINT!,
    tokenEndpoint: process.env.OIDC_TOKEN_ENDPOINT!,
    jwksUri: process.env.OIDC_JWKS_URI!,
    redirectUri: process.env.OIDC_REDIRECT_URI!,
    recoveryUrl: process.env.OIDC_RECOVERY_URL!,
    securityUrl: process.env.OIDC_SECURITY_URL!,
    mfaAcrs: (process.env.OIDC_MFA_ACRS ?? "").split(",").filter(Boolean),
  });
}
export function validateOidcConfig(c: OidcConfig) {
  z.string().min(1).max(200).parse(c.clientId);
  for (const value of [
    c.issuer,
    c.authorizationEndpoint,
    c.tokenEndpoint,
    c.jwksUri,
    c.redirectUri,
    c.recoveryUrl,
    c.securityUrl,
  ]) {
    const u = new URL(value);
    if (
      u.username ||
      u.password ||
      u.hash ||
      !(
        u.protocol === "https:" ||
        (c.allowLoopbackTest &&
          process.env.NODE_ENV !== "production" &&
          u.protocol === "http:" &&
          ["localhost", "127.0.0.1"].includes(u.hostname))
      )
    )
      throw Error("OIDC requires explicitly configured HTTPS endpoints.");
  }
  if (new URL(c.issuer).search)
    throw Error("OIDC issuer cannot contain a query.");
  if (
    new URL(c.redirectUri).pathname !== "/api/auth/oidc/callback" ||
    new URL(c.redirectUri).search
  )
    throw Error("Invalid OIDC callback.");
  z.array(z.string().min(1).max(200)).max(20).parse(c.mfaAcrs);
  return c;
}
async function boundedJson(response: Response) {
  if (!response.ok || !response.body)
    throw new ApiError(
      503,
      "Organization sign-in is unavailable. Start sign-in again.",
    );
  const reader = response.body.getReader();
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const r = await reader.read();
      if (r.done) break;
      size += r.value.length;
      if (size > 131072) throw Error("Identity response too large");
      chunks.push(r.value);
    }
  } finally {
    await reader.cancel();
  }
  return JSON.parse(Buffer.concat(chunks).toString());
}
export async function validateIdToken(
  jwt: string,
  keys: unknown,
  c: OidcConfig,
  nonceHash: string,
  now = Math.floor(Date.now() / 1000),
) {
  if (jwt.length > 20000 || !/^[-\w]+\.[-\w]+\.[-\w]+$/.test(jwt))
    throw Error("Invalid identity token");
  const parts = jwt.split("."),
    header = z
      .object({
        alg: z.literal("RS256"),
        kid: z.string().min(1).max(128),
        typ: z.literal("JWT").optional(),
      })
      .strict()
      .parse(JSON.parse(Buffer.from(parts[0], "base64url").toString()));
  const set = z
    .object({ keys: z.array(z.record(z.string(), z.unknown())).max(50) })
    .parse(keys);
  const candidates = set.keys.filter(
    (k) =>
      k.kid === header.kid &&
      k.kty === "RSA" &&
      (k.use === undefined || k.use === "sig") &&
      (k.alg === undefined || k.alg === "RS256") &&
      (k.key_ops === undefined ||
        (Array.isArray(k.key_ops) && k.key_ops.includes("verify"))),
  );
  if (candidates.length !== 1) throw Error("Identity signing key unavailable");
  const key = createPublicKey({ key: candidates[0] as any, format: "jwk" });
  if (
    (key.asymmetricKeyDetails?.modulusLength ?? 0) < 2048 ||
    !verify(
      "RSA-SHA256",
      Buffer.from(parts[0] + "." + parts[1]),
      key,
      Buffer.from(parts[2], "base64url"),
    )
  )
    throw Error("Invalid identity signature");
  const claims = z
    .object({
      iss: z.string(),
      sub: z.string().min(1).max(255),
      aud: z.union([z.string(), z.array(z.string()).min(1)]),
      azp: z.string().optional(),
      exp: z.number().int(),
      iat: z.number().int(),
      nbf: z.number().int().optional(),
      nonce: z.string(),
      auth_time: z.number().int(),
      amr: z.array(z.string()).optional(),
      acr: z.string().optional(),
    })
    .passthrough()
    .parse(JSON.parse(Buffer.from(parts[1], "base64url").toString()));
  const aud = typeof claims.aud === "string" ? [claims.aud] : claims.aud;
  if (
    claims.iss !== c.issuer ||
    !aud.includes(c.clientId) ||
    (aud.length > 1 && claims.azp !== c.clientId) ||
    (claims.azp !== undefined && claims.azp !== c.clientId) ||
    claims.exp <= now ||
    claims.iat > now + 30 ||
    claims.exp <= claims.iat ||
    (claims.nbf !== undefined && claims.nbf > now + 30) ||
    claims.auth_time > now + 30 ||
    claims.auth_time < now - 600 ||
    hash(claims.nonce) !== nonceHash ||
    !(
      claims.amr?.includes("mfa") ||
      (claims.acr !== undefined && c.mfaAcrs.includes(claims.acr))
    )
  )
    throw Error("Identity claims not accepted");
  return claims;
}
export function oidcRoutes(
  app: Express,
  pool: Pool,
  config: OidcConfig | undefined,
  webOrigin: string,
) {
  const c = config ? validateOidcConfig(config) : undefined;
  if (c && new URL(c.redirectUri).origin !== new URL(webOrigin).origin)
    throw Error("OIDC callback must match WEB_ORIGIN.");
  app.get("/api/auth/options", (_req, res) =>
    res.json({
      localEnabled: process.env.NODE_ENV !== "production",
      oidcEnabled: !!c,
      recoveryUrl: c?.recoveryUrl ?? null,
      securityUrl: c?.securityUrl ?? null,
      policy: {
        idleMinutes: 30,
        absoluteHours: 8,
        scope:
          "development defaults; production configuration requires approval",
      },
    }),
  );
  app.post("/api/auth/oidc/start", async (req, res) => {
    if (!c)
      throw new ApiError(
        503,
        "Organization sign-in has not been configured. Contact your administrator.",
      );
    z.object({}).strict().parse(req.body);
    const limit = await pool.query(
      "SELECT eoms.auth_attempt_allowed($1,20) AS allowed",
      [hash("oidc-ip:" + req.ip)],
    );
    if (!limit.rows[0]?.allowed)
      throw new ApiError(
        429,
        "Too many sign-in attempts. Try again later.",
        "RATE_LIMITED",
      );
    const state = token(),
      binding = token(),
      nonce = token(),
      verifier = token();
    await pool.query("SELECT eoms.begin_oidc($1,$2,$3,$4)", [
      hash(state),
      hash(binding),
      verifier,
      hash(nonce),
    ]);
    res.cookie("eoms_oidc", binding, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/api/auth/oidc",
      maxAge: 600000,
    });
    const u = new URL(c.authorizationEndpoint);
    u.search = new URLSearchParams({
      client_id: c.clientId,
      response_type: "code",
      scope: "openid",
      redirect_uri: c.redirectUri,
      state,
      nonce,
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      code_challenge_method: "S256",
      max_age: "600",
    }).toString();
    res.json({ authorizationUrl: u.href });
  });
  app.get("/api/auth/oidc/callback", async (req, res) => {
    if (!c)
      throw new ApiError(503, "Organization sign-in has not been configured.");
    res.clearCookie("eoms_oidc", { path: "/api/auth/oidc" });
    try {
      const input = z
        .object({
          state: z.string().regex(/^[a-f0-9]{64}$/),
          code: z.string().min(1).max(2048),
        })
        .strict()
        .parse(req.query);
      const binding = opaqueCookie(req.headers.cookie, "eoms_oidc");
      if (!binding) throw Error("Missing browser binding");
      const state = (
        await pool.query("SELECT * FROM eoms.consume_oidc($1,$2)", [
          hash(input.state),
          hash(binding),
        ])
      ).rows[0];
      if (!state) throw Error("Expired sign-in state");
      const form = new URLSearchParams({
        grant_type: "authorization_code",
        code: input.code,
        redirect_uri: c.redirectUri,
        client_id: c.clientId,
        code_verifier: state.verifier,
      });
      if (c.clientSecret) form.set("client_secret", c.clientSecret);
      const tokens = await boundedJson(
        await fetch(c.tokenEndpoint, {
          method: "POST",
          redirect: "error",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: form,
          signal: AbortSignal.timeout(5000),
        }),
      );
      const jwt = z.string().max(20000).parse(tokens.id_token);
      // Fetch the current configured JWKS on every callback: rotated keys are not pinned indefinitely.
      const jwks = await boundedJson(
        await fetch(c.jwksUri, {
          redirect: "error",
          signal: AbortSignal.timeout(5000),
        }),
      );
      const claims = await validateIdToken(jwt, jwks, c, state.nonce_hash),
        raw = token(),
        csrf = token(),
        previous = sessionCookie(req.headers.cookie);
      const linked = await pool.query(
        "SELECT * FROM eoms.open_oidc_session($1,$2,$3,$4,$5,$6)",
        [
          c.issuer,
          claims.sub,
          hash(raw),
          csrf,
          previous ? hash(previous) : null,
          res.locals.requestId,
        ],
      );
      if (!linked.rowCount)
        throw Error("Explicit linked active account required");
      res.cookie("eoms_session", raw, {
        httpOnly: true,
        sameSite: "strict",
        secure: process.env.NODE_ENV === "production",
        path: "/api",
        maxAge: 28800000,
      });
      res.redirect(303, webOrigin + "/");
    } catch {
      await pool
        .query("SELECT eoms.external_security_event($1,$2)", [
          "oidc.callback-denied",
          res.locals.requestId,
        ])
        .catch(() => {});
      // Codes, token endpoint details and untrusted IdP errors never enter logs or URLs.
      res.redirect(
        303,
        webOrigin +
          "/?authError=organization-sign-in&reference=" +
          res.locals.requestId,
      );
    }
  });
}
