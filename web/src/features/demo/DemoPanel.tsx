import { Button, Panel } from "@/components/ui";

export interface DemoPanelProps {
  /** Called when the operator wants the deterministic failure. */
  readonly onFailingBatch?: () => void;
  readonly onReset?: () => void;
}

/**
 * Wave 2, seat H owns this file.
 *
 * Stub: replace the body, keep the export name and props.
 *
 * Drives the demo from docs/11: a `MockOracle` set out of band, a happy-path six-entry batch, and
 * a violated bound that reverts the whole batch with nothing committed. The panel exists so the
 * presenter never needs a terminal during the three-minute run.
 */
export function DemoPanel({ onFailingBatch, onReset }: DemoPanelProps) {
  return (
    <Panel title="Demo driver" tone="latch">
      <div className="row">
        <Button variant="danger" size="sm" onClick={onFailingBatch}>
          Drive failure
        </Button>
        <Button variant="ghost" size="sm" onClick={onReset}>
          Reset
        </Button>
      </div>
    </Panel>
  );
}
