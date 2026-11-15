import { describe, expect, it } from "vitest";
import { accuracy, winner } from "./scoring";

describe("accuracy", () => {
  it("returns null for a team without votes", () => {
    expect(accuracy({ yes: 0, no: 0 }, "yes")).toEqual({
      correct: 0,
      total: 0,
      rate: null,
    });
  });

  it("rejects invalid vote counts", () => {
    expect(() => accuracy({ yes: -1, no: 2 }, "no")).toThrow(RangeError);
    expect(() => accuracy({ yes: 0.5, no: 2 }, "no")).toThrow(RangeError);
  });
});

describe("headline winner", () => {
  it("rewards accuracy rather than total vote volume", () => {
    expect(winner({
      red: { yes: 9, no: 1 },
      blue: { yes: 80, no: 20 },
    }, "yes")).toBe("red");
  });

  it("awards no point for a tie", () => {
    expect(winner({
      red: { yes: 1, no: 1 },
      blue: { yes: 10, no: 10 },
    }, "yes")).toBe("tie");
  });

  it("does not let a team without votes win", () => {
    expect(winner({
      red: { yes: 0, no: 0 },
      blue: { yes: 0, no: 3 },
    }, "yes")).toBe("blue");
  });

  it("does not score a question with no votes", () => {
    expect(winner({
      red: { yes: 0, no: 0 },
      blue: { yes: 0, no: 0 },
    }, "no")).toBe("unscored");
  });

  it("supports no outcomes", () => {
    expect(winner({
      red: { yes: 8, no: 2 },
      blue: { yes: 1, no: 9 },
    }, "no")).toBe("blue");
  });
});
