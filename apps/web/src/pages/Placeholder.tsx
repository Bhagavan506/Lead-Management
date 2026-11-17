import { Panel } from "../components/ui";

/** Stands in for a screen that a later task builds. Replaced task by task; none should remain at the end. */
export function Placeholder({ title }: { title: string }) {
  return (
    <Panel>
      <h2 className="text-sm font-bold">{title}</h2>
      <p className="mt-1 text-mu">This screen is built in a later task.</p>
    </Panel>
  );
}
