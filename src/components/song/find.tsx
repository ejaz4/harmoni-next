"use client";

import { useDeferredValue, useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icon";
import { findItems } from "@/lib/find-songs";
import { plural } from "@/lib/format";
import styles from "./find.module.css";

export { findItems };

// Finding songs within a playlist, Liked Songs or a Spice: the search
// button beside sorting grows into a field where it stands, as it does for
// Ctrl/⌘F (the page only draws songs as they're scrolled to, so the
// browser's own find can't see them all). `list` names the list; a
// different one starts afresh.
export function useFind(list: string, label: string) {
  const [state, setState] = useState({ list, open: false, query: "" });
  if (state.list !== list) setState({ list, open: false, query: "" });
  const input = useRef<HTMLInputElement>(null);
  const query = useDeferredValue(state.open ? state.query : "");

  // The field is always there, just folded away: focusing it in the tap
  // itself is what brings up a phone's keyboard.
  const show = () => {
    input.current?.focus();
    input.current?.select();
  };
  const close = () => {
    setState((s) => ({ ...s, open: false, query: "" }));
    input.current?.blur();
  };
  const clearOrClose = () => (state.query ? setState((s) => ({ ...s, query: "" })) : close());

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        input.current?.focus();
        input.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // `found`: how many songs match what's typed.
  const field = (found: number) => (
    <div className={styles.slot} data-find>
      <div
        className={styles.find}
        data-find-open={state.open || undefined}
        role="search"
        // Taps on the rest of it keep the field focused.
        onMouseDown={(e) => e.target !== input.current && e.preventDefault()}
        onBlur={(e) => {
          if (!state.query && !e.currentTarget.contains(e.relatedTarget)) close();
        }}
      >
        <button type="button" className={styles.toggle} onClick={show} aria-label={label} title={label} tabIndex={state.open ? -1 : 0} aria-hidden={state.open || undefined}>
          <Icon name="search" />
        </button>
        <input
          ref={input}
          className={styles.input}
          type="search"
          value={state.query}
          onFocus={() => setState((s) => (s.open ? s : { ...s, open: true }))}
          onChange={(e) => setState((s) => ({ ...s, query: e.target.value }))}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              clearOrClose();
            } else if (e.key === "Enter") e.currentTarget.blur(); // puts a phone's keyboard away
          }}
          placeholder={label}
          aria-label={label}
          tabIndex={state.open ? 0 : -1}
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
        <button type="button" className={styles.close} onClick={clearOrClose} aria-label={state.query ? "Clear" : "Close"} title={state.query ? "Clear" : "Close"} tabIndex={state.open ? 0 : -1}>
          <Icon name="close" />
        </button>
      </div>
    </div>
  );

  return { query, field };
}
