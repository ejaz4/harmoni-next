"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Icon } from "@/components/icon";
import { ui } from "@/components/ui";
import s from "./developers.module.css";

export interface NavLink {
  id: string;
  html: string;
  /** Lower-cased plain text, for the filter. */
  text: string;
}
export interface NavItem extends NavLink {
  kids: NavLink[];
}
export interface NavDoc {
  id: string;
  title: string;
  items: NavItem[];
}

const BELOW_HEADER = 96; // px from the top where a heading counts as "here"

// The page around the docs: the header, the contents (a sheet on phones)
// with its filter, where-you-are, and the Copy buttons in the docs' HTML.
export function Chrome({ nav, children }: { nav: NavDoc[]; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [here, setHere] = useState<{ id: string | null; doc: string | null }>({ id: null, doc: null });
  const contents = useRef<HTMLElement>(null);
  const filter = useRef<HTMLInputElement>(null);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return nav;
    return nav
      .map((doc) => ({
        ...doc,
        items: doc.items.flatMap((item) => {
          if (item.text.includes(q)) return [item];
          const kids = item.kids.filter((k) => k.text.includes(q));
          return kids.length ? [{ ...item, kids }] : [];
        }),
      }))
      .filter((doc) => doc.items.length);
  }, [nav, query]);

  // Where you are: the last heading that's scrolled up under the header.
  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      let id: string | null = null;
      for (const h of document.querySelectorAll<HTMLElement>("[data-doc] h2[id], [data-doc] h3[id]")) {
        if (h.getBoundingClientRect().top > BELOW_HEADER) break;
        id = h.id;
      }
      let doc: string | null = null;
      for (const section of document.querySelectorAll<HTMLElement>("[data-doc]")) {
        if (section.getBoundingClientRect().top > BELOW_HEADER) break;
        doc = section.dataset.doc ?? null;
      }
      setHere((was) => (was.id === id && was.doc === doc ? was : { id, doc }));
    };
    const soon = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    window.addEventListener("scroll", soon, { passive: true });
    window.addEventListener("resize", soon);
    update();
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", soon);
      window.removeEventListener("resize", soon);
    };
  }, []);

  // Keep the current entry in view in the contents.
  useEffect(() => {
    const list = contents.current;
    const link = here.id && list?.querySelector<HTMLElement>(`[data-id="${CSS.escape(here.id)}"]`);
    if (!list || !link || open) return;
    const top = link.offsetTop;
    if (top < list.scrollTop + 64 || top > list.scrollTop + list.clientHeight - 64) list.scrollTop = top - list.clientHeight / 3;
  }, [here.id, open]);

  // The sheet on phones: Escape closes it, and the page behind stays put.
  useEffect(() => {
    if (!open) return;
    const root = document.documentElement;
    root.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => {
      root.style.overflow = "";
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Copy buttons live in the docs' HTML, so they're handled from here.
  useEffect(() => {
    const timers = new WeakMap<HTMLElement, number>();
    const show = (button: HTMLElement, word: string) => {
      const label = button.querySelector(".copy-label");
      button.dataset.copied = "";
      if (label) label.textContent = word;
      clearTimeout(timers.get(button));
      timers.set(
        button,
        window.setTimeout(() => {
          delete button.dataset.copied;
          if (label) label.textContent = "Copy";
        }, 1600),
      );
    };
    const onClick = async (e: MouseEvent) => {
      const button = (e.target as Element).closest<HTMLElement>("[data-copy]");
      if (!button) return;
      const code = button.closest(".code")?.querySelector("pre");
      const text = button.dataset.copy || code?.textContent || "";
      try {
        // Only on https (or localhost); on a bare LAN address, select it instead.
        if (!navigator.clipboard) throw new Error("no clipboard");
        await navigator.clipboard.writeText(text);
        show(button, "Copied");
      } catch {
        const target = code ?? button.parentElement?.querySelector("code");
        if (!target) return;
        const range = document.createRange();
        range.selectNodeContents(target);
        getSelection()?.removeAllRanges();
        getSelection()?.addRange(range);
        show(button, "Selected");
      }
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  // Arriving with a link to a section that streamed in after the browser looked.
  useEffect(() => {
    const id = decodeURIComponent(location.hash.slice(1));
    if (!id) return;
    // Streamed sections wait in a hidden container until React reveals them,
    // so the heading can exist a little before it can be scrolled to.
    let tries = 0;
    const timer = window.setInterval(() => {
      const el = document.getElementById(id);
      const ready = !!el?.getClientRects().length;
      if (ready || ++tries > 50) window.clearInterval(timer);
      if (ready && window.scrollY < 8) el.scrollIntoView();
    }, 100);
    return () => window.clearInterval(timer);
  }, []);

  const close = () => setOpen(false);

  return (
    <>
      <header className={s.top}>
        <a className={s.brand} href="#top" onClick={close}>
          Harmoni <span>API</span>
        </a>
        <nav className={s.docLinks} aria-label="Documents">
          {nav.map((doc) => (
            <a key={doc.id} href={`#${doc.id}`} className={here.doc === doc.id ? s.on : undefined}>
              {doc.title}
            </a>
          ))}
        </nav>
        <Link className={`${ui.button} ${ui.buttonSmall} ${s.openApp}`} href="/">
          Open Harmoni
        </Link>
        <button
          type="button"
          className={s.menu}
          aria-expanded={open}
          aria-controls="contents"
          data-open={open || undefined}
          onClick={() => setOpen((o) => !o)}
        >
          <span className={s.menuIcons}>
            <Icon name="grip" className={s.menuIdle} />
            <Icon name="close" className={s.menuDone} />
          </span>
          {open ? "Close" : "Contents"}
        </button>
      </header>

      <div className={s.frame} id="top">
        <aside className={s.nav} id="contents" aria-label="Contents" ref={contents} data-open={open || undefined}>
          <div className={s.filterWrap}>
            <label className={s.filter}>
              <Icon name="search" className={s.filterIcon} />
              <input
                ref={filter}
                type="text"
                inputMode="search"
                placeholder="Filter: playlists, refresh, link…"
                aria-label="Filter the contents"
                autoComplete="off"
                spellCheck={false}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape" && query) {
                    e.stopPropagation();
                    setQuery("");
                  }
                }}
              />
              <button
                type="button"
                className={s.filterClear}
                data-shown={query ? "" : undefined}
                tabIndex={query ? 0 : -1}
                aria-label="Clear the filter"
                onClick={() => {
                  setQuery("");
                  filter.current?.focus();
                }}
              >
                <Icon name="close" />
              </button>
            </label>
          </div>

          {shown.map((doc) => (
            <div key={doc.id} className={s.navDoc}>
              <a className={s.navTitle} href={`#${doc.id}`} onClick={close}>
                {doc.title}
              </a>
              <ul>
                {doc.items.map((item) => {
                  const within = item.kids.some((k) => k.id === here.id);
                  return (
                    <li key={item.id}>
                      <a
                        href={`#${item.id}`}
                        data-id={item.id}
                        className={here.id === item.id ? s.on : within ? s.within : undefined}
                        onClick={close}
                        dangerouslySetInnerHTML={{ __html: item.html }}
                      />
                      {item.kids.length > 0 && (
                        <ul>
                          {item.kids.map((kid) => (
                            <li key={kid.id}>
                              <a
                                href={`#${kid.id}`}
                                data-id={kid.id}
                                className={here.id === kid.id ? s.on : undefined}
                                onClick={close}
                                dangerouslySetInnerHTML={{ __html: kid.html }}
                              />
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
          {!shown.length && <p className={s.navEmpty}>Nothing in the contents matches “{query.trim()}”.</p>}
          <Link className={`${ui.button} ${ui.buttonSmall} ${s.navApp}`} href="/">
            Open Harmoni
          </Link>
        </aside>

        <main className={s.main}>{children}</main>
      </div>
    </>
  );
}
