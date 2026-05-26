import { describe, it, expect } from "vitest";
import { allocate, DEFAULT_TIMING } from "../utils/timing";

const fps = DEFAULT_TIMING.fps;

function totalFromPerYear(a: ReturnType<typeof allocate>): number {
  return (
    a.introFrames +
    a.outroFrames +
    a.perYear.reduce((sum, y) => sum + y.segmentFrames + y.transitionFrames, 0)
  );
}

describe("allocate", () => {
  it("rejects zero or negative yearCount", () => {
    expect(() => allocate(0, 180)).toThrow();
    expect(() => allocate(-1, 180)).toThrow();
    expect(() => allocate(1.5, 180)).toThrow();
  });

  it("rejects non-positive maxSeconds", () => {
    expect(() => allocate(1, 0)).toThrow();
    expect(() => allocate(1, -10)).toThrow();
  });

  it("does not shrink when defaults already fit", () => {
    const a = allocate(1, 180);
    expect(a.perYear).toHaveLength(1);
    expect(a.perYear[0].segmentFrames).toBe(12 * fps);
    expect(a.perYear[0].transitionFrames).toBe(0);
    expect(a.introFrames).toBe(4 * fps);
    expect(a.outroFrames).toBe(4 * fps);
    expect(a.totalFrames).toBe(totalFromPerYear(a));
  });

  it("fits 18 years within 180s by shrinking segments", () => {
    const a = allocate(18, 180);
    expect(a.perYear).toHaveLength(18);
    expect(a.totalFrames).toBeLessThanOrEqual(180 * fps);
    expect(a.totalFrames).toBe(totalFromPerYear(a));
    for (let i = 0; i < a.perYear.length - 1; i++) {
      expect(a.perYear[i].transitionFrames).toBeGreaterThan(0);
    }
    expect(a.perYear[a.perYear.length - 1].transitionFrames).toBe(0);
  });

  it("produces contiguous startFrames with no gaps", () => {
    const a = allocate(5, 60);
    let expected = a.introFrames;
    for (const y of a.perYear) {
      expect(y.startFrame).toBe(expected);
      expected += y.segmentFrames + y.transitionFrames;
    }
    expect(expected + a.outroFrames).toBe(a.totalFrames);
  });

  it("drops transitions to 0.5s when segment floor would be violated", () => {
    // 30 years, 120s cap: segF must shrink below 3s with 1s transitions.
    // Stage 1 fails -> stage 2 (0.5s transitions).
    const a = allocate(30, 120);
    expect(a.totalFrames).toBeLessThanOrEqual(120 * fps);
    const segs = new Set(a.perYear.map((y) => y.segmentFrames));
    expect(segs.size).toBe(1);
    const segF = a.perYear[0].segmentFrames;
    expect(segF).toBeGreaterThanOrEqual(90);
    const transF = a.perYear[0].transitionFrames;
    expect(transF).toBe(15);
  });

  it("falls below the 3s floor when even 0.5s transitions cannot fit", () => {
    // 60 years in 120s: must drop the 3s floor.
    const a = allocate(60, 120);
    expect(a.totalFrames).toBeLessThanOrEqual(120 * fps);
    const segF = a.perYear[0].segmentFrames;
    expect(segF).toBeLessThan(90);
    expect(segF).toBeGreaterThanOrEqual(30);
  });

  it("throws when no allocation fits at all", () => {
    // intro+outro alone consume 8s; 200 years in 9s is impossible.
    expect(() => allocate(200, 9)).toThrow();
  });

  it("throws if intro+outro do not leave room for any segment", () => {
    expect(() => allocate(1, 7)).toThrow(); // intro+outro = 8s
  });
});
