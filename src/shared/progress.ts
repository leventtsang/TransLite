export interface ProgressSnapshot {
  progress: number;
  etaSeconds?: number;
}

export function smoothSpeed(previous: number | undefined, next: number): number | undefined {
  if (!Number.isFinite(next) || next <= 0) return previous;
  return previous === undefined ? next : previous * 0.75 + next * 0.25;
}

export function calculateProgress(outTimeSeconds: number, durationSeconds: number, speed?: number): ProgressSnapshot {
  const progress = durationSeconds > 0
    ? Math.min(1, Math.max(0, outTimeSeconds / durationSeconds))
    : 0;
  const etaSeconds = speed && speed > 0
    ? Math.max(0, (durationSeconds - outTimeSeconds) / speed)
    : undefined;
  return { progress, etaSeconds };
}
