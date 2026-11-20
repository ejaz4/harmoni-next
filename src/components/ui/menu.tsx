"use client";

import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Icon, type IconName } from "@/components/icon";
import { PHONE, useMediaQuery } from "@/lib/use-media-query";
import styles from "./menu.module.css";
import ui from "./ui.module.css";

export interface MenuItem {
  label: string;
  icon?: IconName;
  onSelect?: () => void;
  href?: string;
  // More items behind this one: a flyout beside it on desktop, or in place of
  // the menu on phones (e.g. a playlist picker).
  submenu?: { label: string; items: MenuItem[] };
  divider?: boolean;
  detail?: string; // a second, quieter line
  disabled?: boolean;
  checked?: boolean; // a tick at the end, for picking one of several
  keepOpen?: boolean; // stays open after picking, to pick something else too
  danger?: boolean; // deletes something
}

// Items, or a function that makes them when the menu opens (so a list of a
// thousand songs doesn't build a thousand menus it never shows).
export type MenuItems = MenuItem[] | (() => MenuItem[]);
const resolve = (items: MenuItems) => (typeof items === "function" ? items() : items);

type Placement =
  | { kind: "point"; x: number; y: number } // right-click: at the pointer
  | { kind: "anchor"; el: React.RefObject<HTMLElement | null>; up?: boolean } // under (or over) its button
  | { kind: "side"; rect: DOMRect }; // a submenu, beside its item

const MARGIN = 8;
const NO_ITEMS: MenuItem[] = [];
const OUT_MS = 110;
const SUBMENU_OPEN_MS = 90;
const SUBMENU_CLOSE_MS = 260;

// One menu open at a time across the app.
let openMenu: { close: () => void } | undefined;

// Stays mounted for the exit animation after `open` goes false.
function usePresence(open: boolean, ms: number) {
  const [mounted, setMounted] = useState(open);
  if (open && !mounted) setMounted(true);
  useEffect(() => {
    if (open || !mounted) return;
    const timer = setTimeout(() => setMounted(false), ms);
    return () => clearTimeout(timer);
  }, [open, mounted, ms]);
  return mounted;
}

function place(placement: Placement, w: number, h: number): { left: number; top: number; origin: string } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const clampX = (x: number) => Math.max(MARGIN, Math.min(x, vw - MARGIN - w));
  const clampY = (y: number) => Math.max(MARGIN, Math.min(y, vh - MARGIN - h));
  if (placement.kind === "point") {
    const { x, y } = placement;
    const flipX = x + w > vw - MARGIN && x - w >= MARGIN;
    const flipY = y + h > vh - MARGIN && y - h >= MARGIN;
    return { left: clampX(flipX ? x - w : x), top: clampY(flipY ? y - h : y), origin: `${flipX ? "right" : "left"} ${flipY ? "bottom" : "top"}` };
  }
  if (placement.kind === "side") {
    const { rect } = placement;
    const flip = rect.right + w > vw - MARGIN;
    return { left: clampX(flip ? rect.left - w + 2 : rect.right - 2), top: clampY(rect.top - 5), origin: `${flip ? "right" : "left"} top` };
  }
  const rect = placement.el.current?.getBoundingClientRect() ?? new DOMRect(vw / 2, vh / 2, 0, 0);
  const below = rect.bottom + 6;
  const above = rect.top - 6 - h;
  const up = (placement.up && above >= MARGIN) || (below + h > vh - MARGIN && above >= MARGIN);
  // Right edges line up, unless that runs off the left.
  const alignRight = rect.right - w >= MARGIN;
  return {
    left: clampX(alignRight ? rect.right - w : rect.left),
    top: clampY(up ? above : below),
    origin: `${alignRight ? "right" : "left"} ${up ? "bottom" : "top"}`,
  };
}

const focusables = (panel: HTMLElement | null) => [...(panel?.querySelectorAll<HTMLElement>(":scope > [data-item]:not(:disabled)") ?? [])];

interface PanelProps {
  items: MenuItem[];
  placement: Placement;
  open: boolean;
  onClose: () => void; // closes everything
  header?: ReactNode; // always shown above the items
  sheetHeader?: ReactNode; // only on phones, where the menu is a sheet with no pointer beside it
  label?: string;
  autoFocus?: boolean; // opened from the keyboard: focus the first item
  ignore?: React.RefObject<HTMLElement | null>; // its button, whose clicks toggle it instead
  onBack?: () => void; // a submenu: ← closes just this one
  nested?: boolean;
}

// The menu itself: frosted glass at the pointer or under its button, kept
// on screen. While it's open the page beneath doesn't scroll.
function MenuPanel(props: PanelProps) {
  const present = usePresence(props.open, OUT_MS);
  if (!present) return null;
  return createPortal(<PanelBody {...props} />, document.body);
}

function PanelBody({ items: given, placement, open, onClose, header, sheetHeader, label, autoFocus, ignore, onBack, nested }: PanelProps) {
  const phone = useMediaQuery(PHONE);
  const panel = useRef<HTMLDivElement>(null);
  // What it showed while open, kept on screen as it fades away.
  const [items, setItems] = useState(given);
  if (open && given !== items) setItems(given);
  const [pos, setPos] = useState<{ left: number; top: number; origin: string }>();
  // Desktop: the flyout open beside an item. Phones: the submenu in place.
  const [flyout, setFlyout] = useState<{ index: number; rect: DOMRect; viaKeyboard?: boolean }>();
  const [inPlace, setInPlace] = useState<MenuItem["submenu"]>();
  const hoverTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const restoreFocus = useRef<Element | null>(null);

  // Measured before the first paint, so it opens where it belongs.
  useLayoutEffect(() => {
    if (phone || !panel.current) return;
    setPos(place(placement, panel.current.offsetWidth, panel.current.offsetHeight));
    // Placement objects are made fresh each render; the menu stays where it opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phone, inPlace, open]);

  // Focus moves in, so arrow keys work straight away, and goes back after.
  useEffect(() => {
    if (!open) return;
    const el = panel.current;
    restoreFocus.current = nested ? null : document.activeElement;
    if (autoFocus) focusables(el)[0]?.focus({ preventScroll: true });
    else el?.focus({ preventScroll: true });
    return () => {
      const back = restoreFocus.current as HTMLElement | null;
      if (back && el?.contains(document.activeElement)) back.focus?.({ preventScroll: true });
    };
  }, [open, autoFocus, nested]);

  // The root menu owns the page while it's open: no scrolling underneath,
  // and a press anywhere else, Escape, resizing or leaving the window closes it.
  useEffect(() => {
    if (!open || nested) return;
    const me = { close: onClose };
    if (openMenu && openMenu !== me) openMenu.close();
    openMenu = me;
    const inMenu = (t: EventTarget | null) => (t instanceof Element ? t.closest<HTMLElement>("[data-menu-panel]") : null);
    const noScroll = (e: Event) => {
      const menu = inMenu(e.target);
      if (menu && menu.scrollHeight > menu.clientHeight) return; // a long menu scrolls itself
      e.preventDefault();
    };
    const onDown = (e: PointerEvent) => {
      if (inMenu(e.target) || ignore?.current?.contains(e.target as Node)) return;
      onClose();
    };
    const close = () => onClose();
    window.addEventListener("wheel", noScroll, { passive: false });
    window.addEventListener("touchmove", noScroll, { passive: false });
    document.addEventListener("pointerdown", onDown, true);
    window.addEventListener("resize", close);
    window.addEventListener("blur", close);
    return () => {
      if (openMenu === me) openMenu = undefined;
      window.removeEventListener("wheel", noScroll);
      window.removeEventListener("touchmove", noScroll);
      document.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("blur", close);
    };
  }, [open, nested, onClose, ignore]);

  useEffect(() => () => clearTimeout(hoverTimer.current), []);

  const shown = inPlace?.items ?? items;
  const hasIcons = shown.some((i) => i.icon || i.checked !== undefined);

  const openFlyout = (index: number, el: HTMLElement, viaKeyboard = false) => setFlyout({ index, rect: el.getBoundingClientRect(), viaKeyboard });

  function pick(item: MenuItem, index: number, el: HTMLElement) {
    if (item.disabled) return;
    if (item.submenu) {
      if (phone) return setInPlace(item.submenu);
      return flyout?.index === index ? setFlyout(undefined) : openFlyout(index, el);
    }
    item.onSelect?.();
    if (!item.keepOpen) onClose();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    // The page's own shortcuts wait while a menu has the keyboard.
    e.stopPropagation();
    if (e.target instanceof HTMLElement && !panel.current?.contains(e.target)) return;
    const list = focusables(panel.current);
    const at = list.indexOf(document.activeElement as HTMLElement);
    const move = (to: number) => list[(to + list.length) % list.length]?.focus({ preventScroll: false });
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        return move(at + 1);
      case "ArrowUp":
        e.preventDefault();
        return move(at < 0 ? list.length - 1 : at - 1);
      case "Home":
        e.preventDefault();
        return move(0);
      case "End":
        e.preventDefault();
        return move(list.length - 1);
      case "ArrowRight": {
        const el = list[at];
        const index = Number(el?.dataset.index);
        if (el && shown[index]?.submenu && !phone) {
          e.preventDefault();
          openFlyout(index, el, true);
        }
        return;
      }
      case "ArrowLeft":
        if (onBack) {
          e.preventDefault();
          onBack();
        } else if (inPlace) {
          e.preventDefault();
          setInPlace(undefined);
        }
        return;
      case "Escape":
        e.preventDefault();
        return onBack ? onBack() : inPlace ? setInPlace(undefined) : onClose();
      case "Tab":
        e.preventDefault();
        return onClose();
    }
  }

  const style = !phone && pos ? { left: pos.left, top: pos.top, transformOrigin: pos.origin } : !phone ? { visibility: "hidden" as const } : undefined;

  return (
    <>
      {/* Phones: the menu is a sheet over a dimmed page. */}
      {!nested && <div className={styles.backdrop} data-state={open ? "open" : "closed"} onPointerDown={onClose} aria-hidden />}
      <div
        ref={panel}
        className={styles.panel}
        data-menu-panel
        data-state={open ? "open" : "closed"}
        data-nested={nested || undefined}
        role="menu"
        aria-label={label}
        tabIndex={-1}
        style={style}
        onKeyDown={onKeyDown}
        // Events from a portal still bubble through React to whatever owns
        // the menu (a song row that plays on click): they stop here.
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        onPointerLeave={() => {
          clearTimeout(hoverTimer.current);
        }}
      >
        {sheetHeader && !inPlace && <div className={`${styles.header} ${styles.sheetOnly}`}>{sheetHeader}</div>}
        {header && !inPlace && <div className={styles.header}>{header}</div>}
        {inPlace && (
          <>
            <button type="button" className={styles.item} data-item onClick={() => setInPlace(undefined)} role="menuitem">
              <span className={styles.icon}>
                <Icon name="arrow-left" />
              </span>
              <span className={styles.label}>{inPlace.label}</span>
            </button>
            <div className={styles.divider} />
          </>
        )}
        {shown.map((item, i) => {
          if (item.divider) return i > 0 && i < shown.length - 1 && !shown[i - 1]?.divider ? <div key={i} className={styles.divider} role="separator" /> : null;
          const content = (
            <>
              {hasIcons && <span className={styles.icon}>{item.icon && <Icon name={item.icon} />}</span>}
              <span className={styles.label}>
                <span className={styles.labelText}>{item.label}</span>
                {item.detail && <span className={styles.detail}>{item.detail}</span>}
              </span>
              {item.checked && <Icon name="check" className={styles.check} />}
              {item.submenu && <Icon name="caret-right" className={styles.chevron} />}
            </>
          );
          const common = {
            className: styles.item,
            "data-item": true,
            "data-index": i,
            "data-danger": item.danger || undefined,
            "data-expanded": flyout?.index === i || undefined,
            onPointerEnter: (e: React.PointerEvent<HTMLElement>) => {
              if (phone || e.pointerType !== "mouse") return;
              const el = e.currentTarget;
              clearTimeout(hoverTimer.current);
              if (item.submenu && !item.disabled) hoverTimer.current = setTimeout(() => openFlyout(i, el), SUBMENU_OPEN_MS);
              else if (flyout) hoverTimer.current = setTimeout(() => setFlyout(undefined), SUBMENU_CLOSE_MS);
            },
          };
          if (item.href && !item.disabled) {
            return (
              <Link key={i} href={item.href} role="menuitem" {...common} onClick={() => onClose()}>
                {content}
              </Link>
            );
          }
          return (
            <button
              key={i}
              type="button"
              role={item.checked !== undefined ? "menuitemradio" : "menuitem"}
              aria-checked={item.checked}
              aria-haspopup={item.submenu ? "menu" : undefined}
              aria-expanded={item.submenu ? flyout?.index === i : undefined}
              disabled={item.disabled}
              {...common}
              onClick={(e) => pick(item, i, e.currentTarget)}
            >
              {content}
            </button>
          );
        })}
      </div>
      {flyout && shown[flyout.index]?.submenu && (
        <MenuPanel
          key={flyout.index}
          nested
          open={open}
          items={shown[flyout.index].submenu!.items}
          label={shown[flyout.index].submenu!.label}
          placement={{ kind: "side", rect: flyout.rect }}
          autoFocus={flyout.viaKeyboard}
          onClose={onClose}
          onBack={() => {
            const index = flyout.index;
            setFlyout(undefined);
            panel.current?.querySelector<HTMLElement>(`[data-index="${index}"]`)?.focus();
          }}
        />
      )}
    </>
  );
}

// A small menu behind a button ("more", by default). `text` makes it a small
// labelled button instead; `trigger` gives it any content. `open` and
// `onOpenChange` let the owner open it too.
export function Menu({
  items,
  label = "More",
  up,
  icon = "more",
  text,
  trigger,
  open: openProp,
  onOpenChange,
  header,
  sheetHeader,
  className,
}: {
  items: MenuItems;
  label?: string;
  up?: boolean;
  icon?: IconName;
  text?: string;
  trigger?: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  header?: ReactNode; // above the items
  sheetHeader?: ReactNode; // above the items, on phones only
  className?: string; // on the button that opens it
}) {
  const [ownOpen, setOwnOpen] = useState(false);
  const open = openProp ?? ownOpen;
  const button = useRef<HTMLButtonElement>(null);
  const [viaKeyboard, setViaKeyboard] = useState(false);

  const setOpen = useCallback(
    (next: boolean) => {
      setOwnOpen(next);
      onOpenChange?.(next);
    },
    [onOpenChange],
  );
  const close = useCallback(() => setOpen(false), [setOpen]);

  return (
    <div className={ui.menuWrap} onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
      <button
        ref={button}
        type="button"
        className={`${trigger ? "" : text ? `${ui.button} ${ui.buttonSmall}` : ui.iconButton} ${className ?? ""}`}
        aria-label={label}
        title={text || trigger ? undefined : label}
        aria-haspopup="menu"
        aria-expanded={open}
        data-open={open || undefined}
        onPointerDown={() => setViaKeyboard(false)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") setViaKeyboard(true);
          if (e.key === "ArrowDown" && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
        onClick={() => setOpen(!open)}
      >
        {trigger ?? (
          <>
            <Icon name={icon} />
            {text && <span>{text}</span>}
          </>
        )}
      </button>
      <MenuPanel
        open={open}
        items={open ? resolve(items) : NO_ITEMS}
        label={label}
        placement={{ kind: "anchor", el: button, up }}
        onClose={close}
        header={header}
        sheetHeader={sheetHeader}
        autoFocus={viaKeyboard}
        ignore={button}
      />
    </div>
  );
}

// --- Right-click menus ---

type ContextTarget = React.MouseEvent<HTMLElement> | { x: number; y: number; target?: HTMLElement };
type ShowContextMenu = (at: ContextTarget, items: MenuItems, options?: { sheetHeader?: ReactNode; header?: ReactNode; label?: string }) => void;

const ContextMenuContext = createContext<ShowContextMenu>(() => {});

// Opens a menu at the pointer: `onContextMenu={(e) => contextMenu(e, items)}`.
// The thing it's for stays highlighted while its menu is open.
export function useContextMenu() {
  return useContext(ContextMenuContext);
}

export function ContextMenuProvider({ children }: { children: ReactNode }) {
  const [menu, setMenu] = useState<{ key: number; items: MenuItem[]; x: number; y: number; target?: HTMLElement; sheetHeader?: ReactNode; header?: ReactNode; label?: string; keyboard: boolean }>();
  const [open, setOpen] = useState(false);

  const show = useCallback<ShowContextMenu>((at, items, options) => {
    let x: number, y: number, target: HTMLElement | undefined;
    let keyboard = false;
    if ("nativeEvent" in at) {
      // Right-clicking selected text keeps the browser's menu, for copying;
      // so does shift-right-click, anywhere.
      const selected = window.getSelection();
      if (at.shiftKey || (selected && !selected.isCollapsed && selected.containsNode(at.target as Node, true))) return;
      at.preventDefault();
      at.stopPropagation();
      target = at.currentTarget;
      x = at.clientX;
      y = at.clientY;
      // The context-menu key (or shift-F10) has no pointer: open by the thing itself.
      if (!x && !y) {
        const r = target.getBoundingClientRect();
        x = r.left + Math.min(32, r.width / 2);
        y = r.bottom - 4;
        keyboard = true;
      }
    } else {
      ({ x, y, target } = at);
    }
    setMenu({ key: performance.now(), items: resolve(items), x, y, target, keyboard, ...options });
    setOpen(true);
  }, []);

  useEffect(() => {
    const el = menu?.target;
    if (!open || !el) return;
    el.setAttribute("data-menu-open", "");
    return () => el.removeAttribute("data-menu-open");
  }, [open, menu]);

  const close = useCallback(() => setOpen(false), []);

  return (
    <ContextMenuContext value={show}>
      {children}
      {menu && (
        <MenuPanel
          key={menu.key}
          open={open}
          items={menu.items}
          placement={{ kind: "point", x: menu.x, y: menu.y }}
          onClose={close}
          header={menu.header}
          sheetHeader={menu.sheetHeader}
          label={menu.label}
          autoFocus={menu.keyboard}
        />
      )}
    </ContextMenuContext>
  );
}
