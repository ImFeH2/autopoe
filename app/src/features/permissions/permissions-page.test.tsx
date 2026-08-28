import { describe, expect, it } from "vitest";
import type { Member } from "@/lib/backend";
import { permissionMemberGroups } from "./permissions-page";

const members: Member[] = [
  { id: 1, type: "human", name: "Owner" },
  { id: 2, type: "agent", name: "Main", status: "idle" },
  { id: 3, type: "agent", name: "Ada", status: "paused" },
];

describe("PermissionsPage", () => {
  it("derives Super Admins from Humans and Admins from stable Agent IDs", () => {
    const groups = permissionMemberGroups(members, [2]);

    expect(groups.humans.map((member) => member.name)).toEqual(["Owner"]);
    expect(groups.admins.map((member) => member.name)).toEqual(["Main"]);
    expect(groups.regularMembers.map((member) => member.name)).toEqual(["Ada"]);
  });

  it("does not transfer Admin when an Agent name changes", () => {
    const renamed = members.map((member) =>
      member.id === 2 ? { ...member, name: "Coordinator" } : member,
    );

    expect(permissionMemberGroups(renamed, [2]).admins[0]?.name).toBe(
      "Coordinator",
    );
  });
});
