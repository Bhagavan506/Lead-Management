import { useCallback, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import type { LeadDetail } from "../lib/types";
import { LeadDrawer } from "./LeadDrawer";

/** The open lead lives in the URL (?lead=ID): back closes it, reload keeps it, a link opens it. */
export function useLeadDrawer(actions?: (d: LeadDetail) => ReactNode) {
  const [params, setParams] = useSearchParams();
  const id = params.get("lead");
  const open = useCallback(
    (leadId: string) =>
      setParams((p) => {
        const n = new URLSearchParams(p);
        n.set("lead", leadId);
        return n;
      }),
    [setParams],
  );
  const close = useCallback(
    () =>
      setParams((p) => {
        const n = new URLSearchParams(p);
        n.delete("lead");
        return n;
      }),
    [setParams],
  );
  return { open, drawer: id ? <LeadDrawer leadId={id} onClose={close} actions={actions} /> : null };
}
