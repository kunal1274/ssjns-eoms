/** Shared launch policy: CI remains headless; local observers can watch actions. */
export function browserOptions(env = process.env) {
  const visible = env.E2E_HEADED === "1";
  const slowMo = Number(env.E2E_SLOW_MO_MS ?? (visible ? 350 : 0));
  if (!Number.isInteger(slowMo) || slowMo < 0 || slowMo > 2000)
    throw Error("E2E_SLOW_MO_MS must be an integer from 0 to 2000.");
  return { headless: !visible, channel: "chrome", slowMo };
}
