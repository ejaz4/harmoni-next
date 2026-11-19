// Runs once as each server starts.
export async function register() {
  // Not while building: there's no database then.
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NEXT_PHASE === "phase-production-build") return;
  const { resumeStaleImports } = await import("./server/import/service");
  const check = () => void resumeStaleImports().catch((err) => console.warn("import: checking for unfinished imports failed", err));
  setTimeout(check, 15_000).unref();
  setInterval(check, 60_000).unref();
}
