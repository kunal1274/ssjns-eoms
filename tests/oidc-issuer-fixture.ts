import { createServer } from "node:http";
import { generateKeyPairSync, sign, createHash, randomUUID } from "node:crypto";
import type { OidcConfig } from "../apps/api/src/oidc";
export async function controlledIssuer(webOrigin = "http://localhost:5284") {
  let issuedTokenCount = 0;
  let pair = generateKeyPairSync("rsa", { modulusLength: 2048 }),
    kid = "first",
    mode = "valid";
  const codes = new Map<string, { nonce: string; challenge: string }>();
  let issuer = "";
  const server = createServer(async (req, res) => {
    const url = new URL(req.url!, issuer);
    if (url.pathname === "/authorize") {
      if (
        url.searchParams.get("client_id") !== "fixture-client" ||
        url.searchParams.get("code_challenge_method") !== "S256"
      ) {
        res.writeHead(400).end();
        return;
      }
      const code = randomUUID();
      codes.set(code, {
        nonce: url.searchParams.get("nonce")!,
        challenge: url.searchParams.get("code_challenge")!,
      });
      const target = new URL(webOrigin + "/api/auth/oidc/callback");
      target.search = new URLSearchParams({
        state: url.searchParams.get("state")!,
        code,
      }).toString();
      res.writeHead(302, { Location: target.href }).end();
      return;
    }
    if (url.pathname === "/keys") {
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          keys: [
            {
              ...pair.publicKey.export({ format: "jwk" }),
              kid,
              alg: "RS256",
              use: "sig",
            },
          ],
        }),
      );
      return;
    }
    if (url.pathname === "/token") {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const form = new URLSearchParams(Buffer.concat(chunks).toString()),
        entry = codes.get(form.get("code")!);
      codes.delete(form.get("code")!);
      if (
        !entry ||
        form.get("client_id") !== "fixture-client" ||
        form.get("redirect_uri") !== webOrigin + "/api/auth/oidc/callback" ||
        createHash("sha256")
          .update(form.get("code_verifier") ?? "")
          .digest("base64url") !== entry.challenge
      ) {
        res.writeHead(400).end("{}");
        return;
      }
      issuedTokenCount++;
      const now = Math.floor(Date.now() / 1000),
        payload = {
          iss: issuer,
          sub: mode === "unlinked" ? "other-subject" : "fixture-subject",
          aud: mode === "audience" ? "wrong-client" : "fixture-client",
          exp: now + 300,
          iat: now,
          auth_time: now,
          nonce: mode === "nonce" ? "wrong" : entry.nonce,
          amr: mode === "no-mfa" ? ["pwd"] : ["mfa"],
        };
      const message = [{ alg: "RS256", kid }, payload]
        .map((v) => Buffer.from(JSON.stringify(v)).toString("base64url"))
        .join(".");
      const signature = sign(
        "RSA-SHA256",
        Buffer.from(message),
        pair.privateKey,
      ).toString("base64url");
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ id_token: message + "." + signature }));
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number };
  issuer = "http://127.0.0.1:" + address.port;
  const config: OidcConfig = {
    issuer,
    clientId: "fixture-client",
    authorizationEndpoint: issuer + "/authorize",
    tokenEndpoint: issuer + "/token",
    jwksUri: issuer + "/keys",
    redirectUri: webOrigin + "/api/auth/oidc/callback",
    recoveryUrl: issuer + "/recovery",
    securityUrl: issuer + "/security",
    mfaAcrs: [],
    allowLoopbackTest: true,
  };
  return {
    config,
    issuedTokens: () => issuedTokenCount,
    setMode: (v: string) => {
      mode = v;
    },
    rotate: () => {
      pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
      kid = randomUUID();
    },
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((e) => (e ? reject(e) : resolve())),
      ),
  };
}
