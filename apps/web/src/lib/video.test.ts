import { frameCountFor, frameTimestamps } from "./video";

describe("frameTimestamps", () => {
  it("spaces samples evenly, avoiding the first and last instants", () => {
    const t = frameTimestamps(10, 4);
    expect(t).toEqual([1.25, 3.75, 6.25, 8.75]);
  });
  it("never exceeds the duration", () => {
    const t = frameTimestamps(1, 12);
    expect(Math.max(...t)).toBeLessThan(1);
    expect(t).toHaveLength(12);
  });
  it("handles unknown duration", () => {
    expect(frameTimestamps(NaN, 3)).toEqual([0, 0, 0]);
  });
});

describe("frameCountFor", () => {
  it("scales with clip length up to the server cap", () => {
    expect(frameCountFor(10)).toBe(8);
    expect(frameCountFor(45)).toBe(10);
    expect(frameCountFor(120)).toBe(12);
  });
});
