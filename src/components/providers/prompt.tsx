"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import styles from "./prompt.module.css";

interface PromptOptions {
  title: string;
  label: string;
  note?: string; // a line under the title, saying what's being made
  defaultValue?: string;
  confirm?: string;
}

type Ask = (options: PromptOptions) => Promise<string | undefined>;

const PromptContext = createContext<Ask>(async () => undefined);

// `await prompt({ title, label })` with a dialog that fits the app,
// instead of the browser's window.prompt.
export function usePrompt(): Ask {
  return useContext(PromptContext);
}

export function PromptProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState<PromptOptions & { resolve: (v: string | undefined) => void }>();
  const [value, setValue] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);

  const ask = useCallback<Ask>(
    (options) =>
      new Promise((resolve) => {
        setValue(options.defaultValue ?? "");
        setOpen({ ...options, resolve });
      }),
    [],
  );

  useEffect(() => {
    if (open) dialog.current?.showModal();
  }, [open]);

  const finish = (result: string | undefined) => {
    open?.resolve(result);
    dialog.current?.close();
    setOpen(undefined);
  };

  return (
    <PromptContext value={ask}>
      {children}
      {open && (
        <dialog ref={dialog} className={styles.dialog} onCancel={() => finish(undefined)} onClick={(e) => e.target === dialog.current && finish(undefined)}>
          <form
            className={styles.body}
            onSubmit={(e) => {
              e.preventDefault();
              finish(value.trim() || undefined);
            }}
          >
            <h2 className={styles.title}>{open.title}</h2>
            {open.note && <p className={styles.note}>{open.note}</p>}
            <label className={styles.field}>
              <span className={styles.label}>{open.label}</span>
              <input className={styles.input} value={value} onChange={(e) => setValue(e.target.value)} autoFocus maxLength={100} />
            </label>
            <div className={styles.actions}>
              <button type="button" className={styles.cancel} onClick={() => finish(undefined)}>
                Cancel
              </button>
              <button className={styles.confirm} disabled={!value.trim()}>
                {open.confirm ?? "Save"}
              </button>
            </div>
          </form>
        </dialog>
      )}
    </PromptContext>
  );
}
