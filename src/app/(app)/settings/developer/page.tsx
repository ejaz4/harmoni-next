"use client";

import { useSettings } from "@/components/providers/settings";
import { useUser } from "@/components/providers/user";
import { Card, Group, Row, RowLink, SettingsPage, settingsStyles as s, Switch } from "../parts";

export default function DeveloperPage() {
  const { settings, update } = useSettings();
  const user = useUser();
  return (
    <SettingsPage title="Developer">
      <Group id="developer-mode" title="Debugging" aside="This device">
        <Card>
          <Row title="Developer mode" note="Show where audio and lyrics come from, which providers answered a search, and add a Debug page.">
            <Switch checked={settings.developerMode} onChange={(on) => update({ developerMode: on })} label="Developer mode" />
          </Row>
        </Card>
      </Group>

      <Group id="api" title="API">
        <Card>
          <RowLink href="/developers" external icon="code" title="API documentation" note="Build your own apps on Harmoni." />
        </Card>
      </Group>

      <Group id="about" title="About">
        <Card>
          <Row title="Server">
            <span className={s.value}>{user?.server.name ?? "…"}</span>
          </Row>
        </Card>
      </Group>
    </SettingsPage>
  );
}
