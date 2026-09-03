import { describe, expect, it } from "vitest";
import { formatElapsedMs, formatElapsedSecs } from "./format-elapsed";

describe("formatElapsedSecs", () => {
  it("uses Chinese units for seconds and minutes", () => {
    expect(formatElapsedSecs(38)).toBe("38 秒");
    expect(formatElapsedSecs(120)).toBe("2 分");
    expect(formatElapsedSecs(123)).toBe("2 分 3 秒");
  });

  it("rounds milliseconds before formatting", () => {
    expect(formatElapsedMs(39_400)).toBe("39 秒");
    expect(formatElapsedMs(39_600)).toBe("40 秒");
  });
});
