"use client";

import { Icon } from "@/components/icon";
import { Menu, type MenuItem } from "@/components/ui";
import type { LinkDevice } from "@/lib/link";
import { deviceIdentity, useLink } from "./link";
import styles from "./link.module.css";

const KIND: Record<LinkDevice["kind"], string> = { phone: "Phone", tablet: "Tablet", computer: "Computer" };

// Harmoni Link's device picker: every device of yours with Harmoni open,
// and which one is playing. Picking one moves playback there. While
// another device plays, the button says which.
export function LinkButton({ up, iconOnly, className }: { up?: boolean; iconOnly?: boolean; className?: string }) {
  const link = useLink();
  if (!link.connected) return null;
  const here = link.active ?? link.self; // where playback is, or would start
  const me: LinkDevice = link.devices.find((d) => d.id === link.self) ?? { id: link.self, ...deviceIdentity(), until: 0 };
  const others = link.devices.filter((d) => d.id !== link.self).sort((a, b) => a.name.localeCompare(b.name));

  const items: MenuItem[] = [me, ...others].map((d) => ({
    label: d.name,
    detail: [d.id === link.self && "This device", d.id === link.active && "Playing"].filter(Boolean).join(" · ") || KIND[d.kind],
    icon: d.kind === "computer" ? "computer" : "phone",
    checked: d.id === here,
    onSelect: () => d.id !== here && link.transfer(d.id),
  }));
  if (!others.length) items.push({ label: "No other devices yet", detail: "Open Harmoni on another device to see it here", icon: "link", disabled: true });

  return (
    <Menu
      icon="link"
      label={link.remote ? `Playing on ${link.remote.name}. Harmoni Link` : "Harmoni Link"}
      up={up}
      text={link.remote && !iconOnly ? link.remote.name : undefined}
      className={`${link.remote ? styles.active : ""} ${className ?? ""}`}
      header={
        <>
          <p className={styles.title}>
            Harmoni <em>Link</em>
          </p>
          <p className={styles.note}>Play on any of your devices, and control it from all of them.</p>
        </>
      }
      items={items}
    />
  );
}

// "Playing on Chrome on Mac", where the song's details are.
export function PlayingOn({ className }: { className?: string }) {
  const { remote } = useLink();
  if (!remote) return null;
  return (
    <span className={`${styles.playingOn} ${className ?? ""}`}>
      <Icon name="link" /> Playing on {remote.name}
    </span>
  );
}
