import { describe, expect, it } from "vitest";
import { formatTimeMs } from "../../src/ui/Hud.js";

describe("formatTimeMs (mm:ss.mmm)", () => {
  it("formats zero", () => {
    expect(formatTimeMs(0)).toBe("00:00.000");
  });

  it("pads milliseconds to three digits", () => {
    expect(formatTimeMs(5)).toBe("00:00.005");
    expect(formatTimeMs(42)).toBe("00:00.042");
    expect(formatTimeMs(999)).toBe("00:00.999");
  });

  it("handles sub-second values", () => {
    expect(formatTimeMs(1_500)).toBe("00:01.500");
  });

  it("pads seconds to two digits and rolls into minutes at 60 s", () => {
    expect(formatTimeMs(9_999)).toBe("00:09.999");
    expect(formatTimeMs(59_999)).toBe("00:59.999"); // just under a minute
    expect(formatTimeMs(60_000)).toBe("01:00.000"); // exact rollover
  });

  it("matches the plan's worked examples", () => {
    expect(formatTimeMs(95_234)).toBe("01:35.234");
    expect(formatTimeMs(59_999)).toBe("00:59.999");
  });

  it("handles large values (minutes beyond two digits)", () => {
    // 1 hour, 2 min, 3.456 s → minutes = 62 (three digits, no truncation).
    expect(formatTimeMs(3_723_456)).toBe("62:03.456");
  });

  it("clamps negative input to zero", () => {
    expect(formatTimeMs(-123)).toBe("00:00.000");
  });

  it("floors fractional milliseconds", () => {
    expect(formatTimeMs(1_999.7)).toBe("00:01.999");
  });
});
