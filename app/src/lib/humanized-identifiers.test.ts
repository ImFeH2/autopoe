import { describe, expect, it } from "vitest";
import {
  discussionLabel,
  senderLabel,
  shortMessageSummary,
} from "./humanized-identifiers";

describe("humanized identifiers", () => {
  it("uses discussion topics and readable fallbacks", () => {
    expect(discussionLabel({ id: 1, topic: "  Release plan  " })).toBe(
      "Release plan",
    );
    expect(discussionLabel({ id: 2, topic: " " })).toBe("Untitled discussion");
    expect(discussionLabel(undefined)).toBe("Unavailable discussion");
  });

  it("prefers the current sender name and marks snapshot fallbacks", () => {
    const members = [{ id: 7, name: " Ada " }];
    expect(senderLabel(7, members, "Old name")).toBe("Ada");
    expect(senderLabel(8, members, "Grace")).toBe("Grace (unavailable)");
    expect(senderLabel(8, members)).toBe("Unavailable sender");
  });

  it("creates compact plain-text message summaries", () => {
    expect(
      shortMessageSummary("# Update\n\n**Done** [details](https://x.test)"),
    ).toBe("Update Done details");
    expect(shortMessageSummary("  \n")).toBe("No message content");
    expect(shortMessageSummary("1234567890", 6)).toBe("12345…");
    expect(
      shortMessageSummary(
        "Ask @OldName for help",
        96,
        [{ member_id: 2, name: "OldName" }],
        [{ id: 2, name: "NewName" }],
      ),
    ).toBe("Ask @NewName for help");
  });
});
