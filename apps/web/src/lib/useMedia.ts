import { useEffect, useState } from "react";

/** True when the viewport matches the media query; updates live. Used to render ONE layout, not both. */
export function useMedia(query: string): boolean {
  const get = () => (typeof matchMedia === "function" ? matchMedia(query).matches : true);
  const [m, setM] = useState(get);
  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const mq = matchMedia(query);
    const on = () => setM(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [query]);
  return m;
}
