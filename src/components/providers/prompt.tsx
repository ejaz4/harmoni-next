"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import styles from "./prompt.module.css";

interface PromptOptions {
  title: string;
  // The field's label. Without one it's a yes-or-no question (see useConfirm).
  label?: string;
  note?: string; // a line under the title, saying what's being made
  defaultValue?: string;
  confirm?: string;
  danger?: boolean; // the confirm button is red: it can't be undone
  password?: boolean;
  // A word to type before the confirm button works, for what's hardest to undo.
  typed?: string;
}

type Ask = (options: PromptOptions) => Promise<string | undefined>;

const PromptContext = createContext<Ask>(async () => undefined);
const YES = "yes";

// `await prompt({ title, label })` with a dialog that fits the app,
// instead of the browser's window.prompt.
export function usePrompt(): Ask {
  return useContext(PromptContext);
}

// `await confirm({ title, note, confirm: "Remove", danger: true })`, true if they went ahead.
export function useConfirm(): (options: Omit<PromptOptions, "label" | "defaultValue" | "password">) => Promise<boolean> {
  const ask = useContext(PromptContext);
  return useCallback(async (options) => (await ask(options)) === YES, [ask]);
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

  // Typed, if asked for: case and stray spaces don't matter.
  const matches = !open?.typed || value.trim().toLowerCase() === open.typed.toLowerCase();

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
              if (!matches) return;
              finish(open.label ? (open.password ? value : value.trim()) || undefined : YES);
            }}
          >
            <h2 className={styles.title}>{open.title}</h2>
            {open.note && <p className={styles.note}>{open.note}</p>}
            {open.label && (
              <label className={styles.field}>
                <span className={styles.label}>{open.label}</span>
                <input
                  className={styles.input}
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  autoFocus
                  maxLength={open.password ? 128 : 100}
                  type={open.password ? "password" : "text"}
                  autoComplete={open.password ? "current-password" : "off"}
                />
              </label>
            )}
            {open.typed && (
              <label className={styles.field}>
                <span className={styles.label}>
                  Type <strong>{open.typed}</strong> to confirm
                </span>
                <input
                  className={styles.input}
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  placeholder={open.typed}
                  autoFocus
                  autoComplete="off"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  maxLength={100}
                />
              </label>
            )}
            <div className={styles.actions}>
              <button type="button" className={styles.cancel} onClick={() => finish(undefined)}>
                Cancel
              </button>
              <button
                className={`${styles.confirm} ${open.danger ? styles.danger : ""}`}
                disabled={(!!open.label && !value.trim()) || !matches}
                autoFocus={!open.label && !open.typed}
              >
                {open.confirm ?? (open.label ? "Save" : "OK")}
              </button>
            </div>
          </form>
        </dialog>
      )}
    </PromptContext>
  );
}
