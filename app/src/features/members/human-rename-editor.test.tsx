import { describe, expect, it } from "vitest";
import { humanRenameChanged } from "./human-rename-editor";

describe("HumanRenameEditor", () => {
  it("only enables a trimmed changed name", () => {
    expect(humanRenameChanged("You", " You ")).toBe(false);
    expect(humanRenameChanged("You", "Owner")).toBe(true);
  });
});
