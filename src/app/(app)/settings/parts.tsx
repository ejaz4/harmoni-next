"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Icon, type IconName } from "@/components/icon";
import s from "./settings.module.css";

// The pieces Settings and Server settings are built from.

export { s as settingsStyles };

export function Group({ id, title, note, children }: { id?: string; title: ReactNode; note?: ReactNode; children: ReactNode }) {
  return (
    <section className={s.group} id={id} aria-labelledby={id && `${id}-title`}>
      <h2 className={s.groupTitle} id={id && `${id}-title`}>
        {title}
      </h2>
      {note && <p className={s.groupNote}>{note}</p>}
      {children}
    </section>
  );
}

export function Card({ children }: { children: ReactNode }) {
  return <div className={s.card}>{children}</div>;
}

// A setting: what it is on the left, its control on the right. `wide`
// controls drop under the words on phones.
export function Row({ title, note, children, wide }: { title: ReactNode; note?: ReactNode; children?: ReactNode; wide?: boolean }) {
  return (
    <div className={`${s.row} ${wide ? s.rowWide : ""}`}>
      <div className={s.rowText}>
        <div className={s.rowTitle}>{title}</div>
        {note && <div className={s.rowNote}>{note}</div>}
      </div>
      {children && <div className={s.rowControl}>{children}</div>}
    </div>
  );
}

export function RowLink({ href, icon, title, note }: { href: string; icon: IconName; title: ReactNode; note?: ReactNode }) {
  return (
    <Link href={href} className={`${s.row} ${s.rowLink}`}>
      <span className={s.rowIcon}>
        <Icon name={icon} />
      </span>
      <div className={s.rowText}>
        <div className={s.rowTitle}>{title}</div>
        {note && <div className={s.rowNote}>{note}</div>}
      </div>
      <Icon name="arrow-left" />
    </Link>
  );
}

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (on: boolean) => void; label: string; disabled?: boolean }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} className={s.switch} disabled={disabled} onClick={() => onChange(!checked)} />;
}

// One of a few, as a row of pills.
export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div className={s.segmented} role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={String(o.value)} type="button" role="radio" aria-checked={o.value === value} onClick={() => o.value !== value && onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Range({
  value,
  min,
  max,
  step = 1,
  onChange,
  label,
  format,
  disabled,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  label: string;
  format: (value: number) => string;
  disabled?: boolean;
}) {
  return (
    <div className={s.range}>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        aria-valuetext={format(value)}
        disabled={disabled}
        style={{ "--fill": `${((value - min) / (max - min)) * 100}%` } as React.CSSProperties}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <span className={`${s.rangeValue} tabular`}>{format(value)}</span>
    </div>
  );
}

export function Badge({ children, tone }: { children: ReactNode; tone?: "accent" | "danger" }) {
  return <span className={`${s.badge} ${tone === "accent" ? s.badgeAccent : tone === "danger" ? s.badgeDanger : ""}`}>{children}</span>;
}

// "3 minutes ago", "yesterday", "12 Oct".
export function ago(iso: string | null | undefined, now: number): string {
  if (!iso) return "never";
  const ms = now - new Date(iso).getTime();
  const min = Math.round(ms / 60_000);
  if (min < 2) return "just now";
  if (min < 60) return `${min} minutes ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
  const d = Math.round(h / 24);
  if (d === 1) return "yesterday";
  if (d < 7) return `${d} days ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: d > 300 ? "numeric" : undefined });
}

export function bytes(n: number): string {
  if (n < 1e6) return `${Math.round(n / 1e3)} KB`;
  if (n < 1e9) return `${Math.round(n / 1e6)} MB`;
  return `${(n / 1e9).toFixed(n < 1e10 ? 1 : 0)} GB`;
}
