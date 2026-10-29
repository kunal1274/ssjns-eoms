import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import {
  validateIdToken,
  validateOidcConfig,
  type OidcConfig,
} from "../apps/api/src/oidc";
import { hash } from "../apps/api/src/security";
const { publicKey, privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
});
const jwk = {
  ...publicKey.export({ format: "jwk" }),
  kid: "key-one",
  alg: "RS256",
  use: "sig",
};
const config: OidcConfig = {
  issuer: "https://identity.example",
  clientId: "eoms",
  authorizationEndpoint: "https://identity.example/authorize",
  tokenEndpoint: "https://identity.example/token",
  jwksUri: "https://identity.example/keys",
  redirectUri: "https://app.example/api/auth/oidc/callback",
  recoveryUrl: "https://identity.example/recovery",
  securityUrl: "https://identity.example/security",
  mfaAcrs: [],
};
const claims = {
  iss: config.issuer,
  sub: "explicit-subject",
  aud: config.clientId,
  exp: 2000,
  iat: 1000,
  auth_time: 1000,
  nonce: "nonce",
  amr: ["mfa"],
};
function jwt(
  body: any = claims,
  header: any = { alg: "RS256", kid: "key-one" },
) {
  const message = [header, body]
    .map((v) => Buffer.from(JSON.stringify(v)).toString("base64url"))
    .join(".");
  return (
    message +
    "." +
    sign("RSA-SHA256", Buffer.from(message), privateKey).toString("base64url")
  );
}
test("OIDC validates signed audience issuer nonce recent authentication and MFA without trusting email claims", async () => {
  const valid = await validateIdToken(
    jwt({ ...claims, email: "untrusted@example.test" }),
    { keys: [jwk] },
    config,
    hash("nonce"),
    1001,
  );
  assert.equal(valid.sub, "explicit-subject");
  for (const patch of [
    { iss: "https://attacker.example" },
    { aud: "another-client" },
    { aud: ["eoms", "other"] },
    { azp: "other" },
    { exp: 1000 },
    { iat: 2000 },
    { auth_time: 1 },
    { auth_time: 2000 },
    { nbf: 2000 },
    { nonce: "wrong" },
    { amr: ["pwd"] },
    { auth_time: undefined },
  ])
    await assert.rejects(
      validateIdToken(
        jwt({ ...claims, ...patch }),
        { keys: [jwk] },
        config,
        hash("nonce"),
        1001,
      ),
    );
});
test("OIDC rejects algorithm/key confusion, unsigned tokens and unsupported critical header input", async () => {
  for (const header of [
    { alg: "none", kid: "key-one" },
    { alg: "HS256", kid: "key-one" },
    { alg: "RS256", kid: "unknown" },
    { alg: "RS256", kid: "key-one", jku: "https://attacker.example" },
    { alg: "RS256", kid: "key-one", crit: ["x"] },
  ])
    await assert.rejects(
      validateIdToken(
        jwt(claims, header),
        { keys: [jwk] },
        config,
        hash("nonce"),
        1001,
      ),
    );
  await assert.rejects(
    validateIdToken(
      jwt().replace(/.$/, "!"),
      { keys: [jwk] },
      config,
      hash("nonce"),
      1001,
    ),
  );
  await assert.rejects(
    validateIdToken(jwt(), { keys: [jwk, jwk] }, config, hash("nonce"), 1001),
  );
});
test("OIDC accepts explicit assurance-class policy and current rotated signing keys only", async () => {
  const alternate = { ...config, mfaAcrs: ["approved-mfa"] };
  assert.equal(
    (
      await validateIdToken(
        jwt({ ...claims, amr: ["pwd"], acr: "approved-mfa" }),
        { keys: [jwk] },
        alternate,
        hash("nonce"),
        1001,
      )
    ).acr,
    "approved-mfa",
  );
  const pair = generateKeyPairSync("rsa", { modulusLength: 2048 }),
    message = jwt().split(".").slice(0, 2).join("."),
    signed =
      message +
      "." +
      sign("RSA-SHA256", Buffer.from(message), pair.privateKey).toString(
        "base64url",
      );
  await assert.rejects(
    validateIdToken(signed, { keys: [jwk] }, config, hash("nonce"), 1001),
  );
  assert.equal(
    (
      await validateIdToken(
        signed,
        {
          keys: [
            { ...pair.publicKey.export({ format: "jwk" }), kid: "key-one" },
          ],
        },
        config,
        hash("nonce"),
        1001,
      )
    ).sub,
    claims.sub,
  );
});
test("OIDC rejects insecure or credential-bearing configuration and invalid callback paths", () => {
  assert.equal(validateOidcConfig(config), config);
  for (const patch of [
    { issuer: "http://id.example" },
    { tokenEndpoint: "https://user:secret@id.example/token" },
    { redirectUri: "https://app.example/other" },
    { jwksUri: "https://id.example/key#fragment" },
  ])
    assert.throws(() => validateOidcConfig({ ...config, ...patch }));
});
