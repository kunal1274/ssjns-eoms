import { test } from "node:test";
import assert from "node:assert/strict";
import { browserOptions } from "../scripts/browser-options.mjs";
test("browser defaults keep automated regression headless and unthrottled", () => {
  assert.deepEqual(browserOptions({}), {
    headless: true,
    channel: "chrome",
    slowMo: 0,
  });
});
test("visible replay opens Chrome and slows interactions with bounded overrides", () => {
  assert.deepEqual(browserOptions({ E2E_HEADED: "1" }), {
    headless: false,
    channel: "chrome",
    slowMo: 350,
  });
  assert.equal(
    browserOptions({ E2E_HEADED: "1", E2E_SLOW_MO_MS: "900" }).slowMo,
    900,
  );
  for (const value of ["-1", "2001", "NaN", "1.5"])
    assert.throws(() => browserOptions({ E2E_SLOW_MO_MS: value }), /integer/);
});
