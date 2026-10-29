import type { Express } from "express";
import type { Pool } from "pg";
import { z } from "zod";
import { ApiError } from "./http";
import { hash, passwordHash, verifyPassword } from "./security";
const password = z
  .string()
  .min(12)
  .max(128)
  .refine(
    (v) =>
      ![
        "password1234",
        "password12345",
        "123456789012",
        "qwerty123456",
      ].includes(v.toLowerCase()),
    "Choose a less predictable password",
  );
export function publicRecoveryRoutes(
  app: Express,
  pool: Pool,
  localAllowed: boolean,
) {
  app.post("/api/auth/recovery", async (req, res) => {
    const input = z
      .object({ email: z.string().email().max(254) })
      .strict()
      .parse(req.body);
    const limit = await pool.query(
      "SELECT eoms.auth_attempt_allowed($1,5) AS allowed",
      [hash("recovery:" + input.email.toLowerCase())],
    );
    // Same response for known, unknown, inactive and rate-limited requests. No token is returned.
    if (limit.rows[0]?.allowed)
      await pool.query("SELECT eoms.recovery_requested($1,$2)", [
        input.email.toLowerCase(),
        res.locals.requestId,
      ]);
    res.json({
      message: localAllowed
        ? "If this account is eligible, contact your authorized support team to verify your identity and receive a recovery token. No password has been changed."
        : "Use your organization identity provider to recover access. Contact your administrator if you need help.",
      requestId: res.locals.requestId,
    });
  });
  app.post("/api/auth/recovery/reset", async (req, res) => {
    const input = z
      .object({ token: z.string().regex(/^[a-f0-9]{64}$/), password })
      .strict()
      .parse(req.body);
    if (!localAllowed)
      throw new ApiError(
        403,
        "Use your organization identity provider to change your password.",
      );
    const allowed = await pool.query(
      "SELECT eoms.auth_attempt_allowed($1,20) AS allowed",
      [hash("reset-ip:" + req.ip)],
    );
    if (!allowed.rows[0]?.allowed)
      throw new ApiError(
        429,
        "Too many recovery attempts. Try again later.",
        "RATE_LIMITED",
      );
    const changed = await pool.query(
      "SELECT eoms.reset_local_credential($1,$2,$3) AS changed",
      [
        hash(input.token),
        await passwordHash(input.password),
        res.locals.requestId,
      ],
    );
    if (!changed.rows[0]?.changed)
      throw new ApiError(
        422,
        "This recovery token is unavailable or expired. Request a new token from authorized support.",
      );
    res.json({
      message:
        "Password changed. All previous sessions have ended. Sign in with your new password.",
      requestId: res.locals.requestId,
    });
  });
}
export function credentialChangeRoute(
  app: Express,
  pool: Pool,
  localAllowed: boolean,
) {
  app.post("/api/auth/password", async (req, res) => {
    const input = z
      .object({
        currentPassword: z.string().min(1).max(128),
        newPassword: password,
      })
      .strict()
      .parse(req.body);
    if (!localAllowed || res.locals.user.auth_method === "oidc")
      throw new ApiError(
        403,
        "Use your organization identity provider to change your password.",
      );
    const limit = await pool.query(
      "SELECT eoms.auth_attempt_allowed($1,5) AS allowed",
      [hash("change:" + res.locals.user.id)],
    );
    if (!limit.rows[0]?.allowed)
      throw new ApiError(
        429,
        "Too many verification attempts. Try again later.",
        "RATE_LIMITED",
      );
    const user = (
      await pool.query("SELECT * FROM eoms.login_credential($1)", [
        res.locals.user.email,
      ])
    ).rows[0];
    if (
      !user ||
      !(await verifyPassword(input.currentPassword, user.password_hash))
    )
      throw new ApiError(
        403,
        "Current password could not be verified. Check it and try again.",
      );
    if (input.currentPassword === input.newPassword)
      throw new ApiError(422, "Choose a different new password.");
    const result = await pool.query(
      "SELECT eoms.change_local_credential($1,$2,$3,$4,$5) AS changed",
      [
        res.locals.sessionHash,
        req.get("X-CSRF-Token"),
        user.password_hash,
        await passwordHash(input.newPassword),
        res.locals.requestId,
      ],
    );
    if (!result.rows[0]?.changed)
      throw new ApiError(401, "Your session has ended. Sign in again.");
    res.clearCookie("eoms_session", { path: "/api" }).json({
      message: "Password changed. All sessions have ended. Sign in again.",
      requestId: res.locals.requestId,
    });
  });
}
