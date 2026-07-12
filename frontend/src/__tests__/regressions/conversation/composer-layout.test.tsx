import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { WorkspaceView } from "@/components/flowent/workspace-view";

const renderWorkspace = () =>
  render(
    <WorkspaceView
      commands={[]}
      contextWindowLimit={null}
      draft=""
      isRefiningContext={false}
      isResponding={false}
      messages={[]}
      onCommand={() => false}
      onCommandError={vi.fn()}
      onDraftChange={vi.fn()}
      onEditMessage={vi.fn()}
      onRetryError={vi.fn()}
      onRetryMessage={vi.fn()}
      onSendMessage={vi.fn()}
      onStopResponse={vi.fn()}
      skills={[]}
      usageInfo={null}
    />,
  );

describe("workspace composer layout regressions", () => {
  it("starts the empty message composer as a single visible textarea row", () => {
    renderWorkspace();

    const composer = screen.getByRole<HTMLTextAreaElement>("textbox", {
      name: "Message Flowent",
    });

    expect(composer.rows).toBe(1);
  });
});
