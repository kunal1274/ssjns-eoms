const url = process.argv[2];
try {
  const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
  const result = await response.json();
  if (!response.ok || result.status !== "ok" || result.service !== "eoms-api")
    process.exitCode = 1;
} catch {
  process.exitCode = 1;
}
