import { describe, expect, it } from "vitest";
import {
  humanRenameChanged,
  reduceHumanRenameFeedback,
} from "./human-rename-editor";

describe("HumanRenameEditor", () => {
  it("treats the exact unmodified draft as the rename candidate", () => {
    expect(humanRenameChanged("You", " You ")).toBe(true);
    expect(humanRenameChanged("You", "Owner")).toBe(true);
    expect(humanRenameChanged("You", "You")).toBe(false);
  });

  it("associates an error until editing resumes", () => {
    const failed = reduceHumanRenameFeedback(
      { draft: "Duplicate", error: null, success: null },
      { type: "error", message: "Name already exists" },
    );
    expect(failed).toEqual({
      draft: "Duplicate",
      error: "Name already exists",
      success: null,
    });
    expect(
      reduceHumanRenameFeedback(failed, { type: "edit", value: "Owner" }),
    ).toEqual({ draft: "Owner", error: null, success: null });
  });

  it("provides non-blocking success feedback and clears it on the next edit", () => {
    const saved = reduceHumanRenameFeedback(
      { draft: " Owner ", error: "Old error", success: null },
      { type: "success", name: "Owner" },
    );
    expect(saved).toEqual({
      draft: "Owner",
      error: null,
      success: "Name changed to Owner",
    });
    expect(
      reduceHumanRenameFeedback(saved, { type: "edit", value: "Owner 2" }),
    ).toEqual({ draft: "Owner 2", error: null, success: null });
  });
});
