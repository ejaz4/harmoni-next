"use client";

import { useDeferredValue, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Icon } from "@/components/icon";
import { IconButton } from "@/components/ui";
import { findItems } from "@/lib/find-songs";
import { plural } from "@/lib/format";
import styles from "./find.module.css";

export { findItems };

// Finding songs within a playlist, Liked Songs or a Spice: a search button
// beside sorting opens a field above the list, as does Ctrl/⌘F (the page
// only draws songs as they're scrolled to, so the browser's own find
// can't see them all). `list` names the list; a different one starts afresh.
export function useFind(list: string, label: string) {
  const [state, setState] = useState({ list, open: false, query: "" });
  if (state.list !== list) setState({ list, open: false, query: "" });
  const input = useRef<HTMLInputElement>(null);
  const query = useDeferredValue(state.open ? state.query : "");

  // Focused in the tap itself: phones only bring up the keyboard then.
  const show = () => {
    flushSync(() => setState((s) => ({ ...s, open: true })));
    input.current?.focus();
    input.current?.select();
  };
  const close = () => setState((s) => ({ ...s, open: false, query: "" }));
  const clearOrClose = () => {
    if (!state.query) return close();
    setState((s) => ({ ...s, query: "" }));
    input.current?.focus();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        flushSync(() => setState((s) => ({ ...s, open: true })));
        input.current?.focus();
        input.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const button = <IconButton icon="search" label={label} pressed={state.open} onClick={() => (state.open ? close() : show())} />;

  // `found`: how many songs match what's typed.
  const field = (found: number) =>
    state.open && (
      <div className={styles.find} role="search">
        <Icon name="search" className={styles.icon} />
        <input
          ref={input}
          className={styles.input}
          type="search"
          value={state.query}
          onChange={(e) => setState((s) => ({ ...s, query: e.target.value }))}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              clearOrClose();
            } else if (e.key === "Enter") e.currentTarget.blur(); // puts a phone's keyboard away
          }}
          placeholder={label}
          aria-label={label}
          enterKeyHint="search"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
        />
        {query && (
          <span className={`${styles.count} tabular`} aria-live="polite">
            {plural(found, "song")}
          </span>
        )}
        <IconButton icon="close" label={state.query ? "Clear" : "Close"} onClick={clearOrClose} className={styles.close} />
      </div>
    );

  return { query, button, field };
}
