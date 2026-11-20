"use client";

import { Icon } from "@/components/icon";
import { renameDevice, useLink } from "@/components/player/link";
import { usePrompt } from "@/components/providers/prompt";
import { useUser } from "@/components/providers/user";
import { EmptyState, ui } from "@/components/ui";
import { Badge, Card, Group, Row, SettingsPage, settingsStyles as s } from "../parts";

export default function LinkPage() {
  const user = useUser();
  const link = useLink();
  const prompt = usePrompt();
  const me = link.devices.find((d) => d.id === link.self);
  // This device first, then the rest by name.
  const devices = [...link.devices].sort((a, b) => (a.id === link.self ? -1 : b.id === link.self ? 1 : a.name.localeCompare(b.name)));

  async function rename() {
    const name = await prompt({
      title: "Rename this device",
      note: "Leave empty to use the default name.",
      label: "Name",
      defaultValue: me?.name,
      confirm: "Save",
    });
    if (name !== undefined) renameDevice(name);
  }

  if (user?.server.features.link === false) {
    return (
      <SettingsPage title="Harmoni Link">
        <EmptyState icon="link" title="Harmoni Link is off" body="It's turned off on this server." />
      </SettingsPage>
    );
  }

  return (
    <SettingsPage
      title="Harmoni Link"
      description={
        <>
          Play on one device and control it from another. Switch devices with the <Icon name="link" /> button in the player.
        </>
      }
    >
      <Group id="this-device" title="This device">
        <Card>
          <Row title={me ? me.name : "Connecting…"} note="How this device appears on your others.">
            <button type="button" className={`${ui.button} ${ui.buttonSmall}`} onClick={rename} disabled={!me}>
              <Icon name="edit" /> Rename
            </button>
          </Row>
        </Card>
      </Group>

      <Group id="online" title="Online now">
        <Card>
          {!link.devices.length ? (
            <p className={s.empty}>Connecting…</p>
          ) : (
            <ul className={s.list}>
              {devices.map((d) => (
                <li key={d.id} className={s.item}>
                  <span className={`${s.avatar} ${s.avatarIcon}`}>
                    <Icon name={d.kind === "computer" ? "computer" : "phone"} />
                  </span>
                  <div className={s.itemText}>
                    <div className={s.itemTitle}>
                      {d.name}
                      {d.id === link.self && <Badge>This device</Badge>}
                      {d.id === link.active && <Badge tone="accent">Playing</Badge>}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
        {link.devices.length === 1 && <p className={s.footnote}>Open Harmoni on another device to see it here.</p>}
      </Group>
    </SettingsPage>
  );
}
