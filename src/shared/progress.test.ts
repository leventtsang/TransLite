import { describe, expect, it } from 'vitest';
import { calculateProgress, smoothSpeed } from './progress';

describe('ffmpeg progress', () => {
  it('calculates progress and ETA from media time and speed', () => {
    expect(calculateProgress(25, 100, 2)).toEqual({ progress: 0.25, etaSeconds: 37.5 });
  });

  it('clamps invalid progress and smooths speed changes', () => {
    expect(calculateProgress(120, 100).progress).toBe(1);
    expect(smoothSpeed(1, 2)).toBe(1.25);
    expect(smoothSpeed(1, 0)).toBe(1);
  });
});
