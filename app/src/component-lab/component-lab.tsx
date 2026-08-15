import { useState } from "react";
import { AppSidebar, PageHeader } from "@/components/layout";
import {
  Badge,
  Button,
  Checkbox,
  Dialog,
  Input,
  ListButton,
  MenuOption,
  Plus,
  SegmentedControl,
  StatusIndicator,
  Textarea,
  Tooltip,
} from "@/components/ui";

const densityOptions = [
  { label: "Compact", value: "compact" },
  { label: "Default", value: "default" },
] as const;

export function ComponentLab() {
  const [density, setDensity] = useState<"compact" | "default">("default");
  const [checked, setChecked] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <main className="component-lab">
      <header className="component-lab-header">
        <span className="component-lab-mark" aria-hidden="true">
          F
        </span>
        <div>
          <h1>Component Lab</h1>
          <p>Production components and interaction states</p>
        </div>
      </header>

      <section className="component-lab-section" aria-labelledby="lab-actions">
        <h2 id="lab-actions">Actions</h2>
        <div className="component-lab-row">
          <Button variant="primary">Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="quiet">Quiet</Button>
          <Tooltip content="Create">
            <Button aria-label="Create" size="icon" variant="primary">
              <Plus aria-hidden="true" size={15} />
            </Button>
          </Tooltip>
          <Button disabled>Disabled</Button>
        </div>
      </section>

      <section className="component-lab-section" aria-labelledby="lab-inputs">
        <h2 id="lab-inputs">Inputs</h2>
        <div className="component-lab-fields">
          <label htmlFor="lab-text">
            <span>Text</span>
            <Input id="lab-text" placeholder="Value" />
          </label>
          <label htmlFor="lab-disabled">
            <span>Disabled</span>
            <Input disabled id="lab-disabled" placeholder="Unavailable" />
          </label>
          <label className="component-lab-wide-field" htmlFor="lab-message">
            <span>Message</span>
            <Textarea
              id="lab-message"
              placeholder="Write a message"
              variant="composer"
            />
          </label>
        </div>
        <div className="component-lab-row">
          <label className="component-lab-check" htmlFor="lab-enabled-check">
            <Checkbox
              checked={checked}
              id="lab-enabled-check"
              onChange={(event) => setChecked(event.target.checked)}
            />
            Enabled
          </label>
          <label className="component-lab-check" htmlFor="lab-disabled-check">
            <Checkbox disabled id="lab-disabled-check" />
            Disabled
          </label>
        </div>
      </section>

      <section className="component-lab-section" aria-labelledby="lab-status">
        <h2 id="lab-status">Selection and status</h2>
        <SegmentedControl
          aria-label="Density"
          onValueChange={setDensity}
          options={[...densityOptions]}
          value={density}
        />
        <div className="component-lab-row">
          <Badge>Neutral</Badge>
          <Badge tone="accent">Read</Badge>
          <Badge tone="success">Acked</Badge>
          <Badge tone="danger">Failed</Badge>
        </div>
        <div className="component-lab-row">
          <StatusIndicator>Pending</StatusIndicator>
          <StatusIndicator tone="accent">Running</StatusIndicator>
          <StatusIndicator tone="success">Idle</StatusIndicator>
          <StatusIndicator tone="danger">Error</StatusIndicator>
        </div>
      </section>

      <section className="component-lab-section" aria-labelledby="lab-lists">
        <h2 id="lab-lists">Lists</h2>
        <div className="component-lab-list">
          <ListButton active meta="2 messages" title="Repository work" />
          <ListButton meta="1 message" title="Review history" />
          <div aria-label="Menu options" role="listbox">
            <MenuOption label="@Ada" meta="Agent" selected />
          </div>
        </div>
      </section>

      <section className="component-lab-section" aria-labelledby="lab-overlays">
        <h2 id="lab-overlays">Overlays</h2>
        <Dialog
          description="Inspect the production dialog treatment."
          onOpenChange={setDialogOpen}
          open={dialogOpen}
          title="Example dialog"
          trigger={<Button variant="secondary">Open dialog</Button>}
          triggerTooltip="Open dialog"
        >
          <div className="component-lab-dialog-body">
            <Input aria-label="Example value" placeholder="Value" />
            <Button onClick={() => setDialogOpen(false)} variant="primary">
              Done
            </Button>
          </div>
        </Dialog>
      </section>

      <section
        className="component-lab-section component-lab-section--layout"
        aria-labelledby="lab-layout"
      >
        <h2 id="lab-layout">Layout</h2>
        <div className="component-lab-layout-preview">
          <AppSidebar
            discussionCount={2}
            memberCount={3}
            onSelectView={() => undefined}
            view="discussions"
            workingDirectory="/project/flowent"
          />
          <div className="component-lab-layout-main">
            <PageHeader count={3} title="Members" />
            <p>Resize the window to inspect the compact Sidebar.</p>
          </div>
        </div>
      </section>
    </main>
  );
}
