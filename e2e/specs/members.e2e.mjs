import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { $, $$, expect } from "@wdio/globals";
import { describe, it } from "mocha";
import { createAgent, waitForWorkspace } from "../support/app.mjs";

describe("Members", () => {
  it("creates an Agent and opens its details", async () => {
    await waitForWorkspace();
    const details = await createAgent("Ada");

    await expect($("aria/Member list")).toBeDisplayed();
    await expect($("aria/Open You")).toBeDisplayed();
    await expect($("aria/Open Ada")).toHaveAttribute("aria-current", "page");
    await expect(details.$("h2=Ada")).toBeDisplayed();
    await expect(details).toHaveText(expect.stringContaining("IDLE"));
    await expect(details.$("aria/Agent details")).toBeDisplayed();

    await expect($$("summary=Technical details")).toBeElementsArrayOfSize(0);
    await expect($$("aria/Copy Member ID")).toBeElementsArrayOfSize(0);
    await expect($$("button=Copy ID")).toBeElementsArrayOfSize(0);

    const dataDirectory = process.env.HUDDOL_DATA_DIR;
    if (!dataDirectory) {
      throw new Error(
        "HUDDOL_DATA_DIR is required for isolated Member fixtures",
      );
    }
    const memoryDirectory = join(dataDirectory, "agents", "2", "memory");
    mkdirSync(join(memoryDirectory, "topics"), { recursive: true });
    writeFileSync(
      join(memoryDirectory, "MEMORY.md"),
      "# Fixture index\n- topics/release.md\n",
    );
    writeFileSync(
      join(memoryDirectory, "topics", "release.md"),
      "# Release fixture\nSafe preview content\n",
    );
    execFileSync("sqlite3", [
      join(dataDirectory, "flowent.sqlite3"),
      `INSERT INTO agent_todos
        (agent_id,id,subject,description,status,created_at,updated_at,completed_at)
       VALUES
        (2,1,'Active fixture','Visible in Overview','pending','2026-08-21T00:00:00+00:00','2026-08-21T00:00:00+00:00',NULL),
        (2,2,'Completed fixture','Visible when expanded','completed','2026-08-20T00:00:00+00:00','2026-08-21T00:00:00+00:00','2026-08-21T00:00:00+00:00');
       INSERT INTO agent_todo_sequences (agent_id,next_id) VALUES (2,3);`,
    ]);

    const todos = await details.$(".agent-todos");
    await todos.$("button=Refresh").click();
    await expect(todos).toHaveText(expect.stringContaining("Active fixture"));
    await todos.$("summary=Completed").click();
    await expect(todos).toHaveText(
      expect.stringContaining("Completed fixture"),
    );

    await details.$("button=Memory").click();
    const memory = await details.$("aria/Agent Memory");
    await memory.$("aria/Refresh Memory").click();
    await expect(memory.$("aria/Open MEMORY.md")).toBeDisplayed();
    await expect(memory).toHaveText(expect.stringContaining("Main index"));
    await expect(memory).toHaveText(expect.stringContaining("Fixture index"));
    await memory.$("button=Preview").click();
    await expect(memory.$("h1=Fixture index")).toBeDisplayed();

    await details.$("button=History").click();
    await expect(details.$("aria/Ada history")).toHaveText("No history");
  });

  it("returns from rename confirmation to the focused preserved draft", async () => {
    await waitForWorkspace();
    const details = await createAgent("FocusAgent");

    await details.$("button=Rename").click();
    const dialog = await $("aria/Rename Agent");
    await dialog.waitForDisplayed();
    const input = await dialog.$('input[id^="agent-"][id$="-rename"]');
    await expect(input).toBeFocused();
    await input.setValue("FocusDraft");
    await dialog.$("button=Review rename").click();
    await expect(
      dialog.$("h3=Rename FocusAgent to FocusDraft?"),
    ).toBeDisplayed();

    await dialog.$("button=Back").click();

    const returnedInput = await dialog.$('input[id^="agent-"][id$="-rename"]');
    await expect(returnedInput).toBeDisplayed();
    await expect(returnedInput).toBeFocused();
    await expect(returnedInput).toHaveValue("FocusDraft");
  });

  it("requires the exact Agent name before permanent deletion", async () => {
    await waitForWorkspace();
    await createAgent("DeleteMe");

    await $("aria/Delete DeleteMe").click();
    const dialog = await $("aria/Delete Agent");
    await dialog.waitForDisplayed();
    await expect(dialog).toHaveText(
      expect.stringContaining("History, Memory, and Todos"),
    );
    await expect(dialog).toHaveText(
      expect.stringContaining("Discussion messages will remain"),
    );
    const confirm = await dialog.$(
      'input[id^="delete-agent-"][id$="-confirmation"]',
    );
    const deleteButton = await dialog.$("button=Delete");
    await expect(deleteButton).toBeDisabled();
    await confirm.setValue("deleteme");
    await expect(deleteButton).toBeDisabled();
    await confirm.setValue("DeleteMe");
    await expect(deleteButton).toBeEnabled();
    await deleteButton.click();
    await expect($("aria/Open DeleteMe")).not.toBeExisting();
  });
});
