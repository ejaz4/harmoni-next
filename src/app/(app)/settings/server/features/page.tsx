"use client";

import type { AdminSettings } from "@/lib/admin";
import { Card, Group, Row, Switch } from "../../parts";
import { AdminPage } from "../admin";

export default function FeaturesPage() {
  return (
    <AdminPage title="Features" description="Turning a feature off hides it for everyone. People's own choices are kept for when it's back on.">
      {(settings, save) => {
        const f = settings.features;
        const set = (key: keyof AdminSettings["features"], on: boolean, name: string) => save({ features: { [key]: on } }, `${name} turned ${on ? "on" : "off"}`);
        return (
          <>
            <Group id="listening" title="Listening">
              <Card>
                <Row title="Super Processing" note="Personalised Home, Spices and Autoplay. Uses extra storage and background processing.">
                  <Switch checked={f.superProcessing} onChange={(on) => set("superProcessing", on, "Super Processing")} label="Super Processing" />
                </Row>
                <Row title="Autoplay" note="Play similar songs when someone's queue ends.">
                  <Switch checked={f.autoplay} onChange={(on) => set("autoplay", on, "Autoplay")} label="Autoplay" />
                </Row>
                <Row title="Lyrics" note="Synced and plain lyrics from the lyrics providers.">
                  <Switch checked={f.lyrics} onChange={(on) => set("lyrics", on, "Lyrics")} label="Lyrics" />
                </Row>
              </Card>
            </Group>
            <Group id="devices" title="Devices">
              <Card>
                <Row title="Harmoni Link" note="Control playback across devices. Keeps a connection open for each device.">
                  <Switch checked={f.link} onChange={(on) => set("link", on, "Harmoni Link")} label="Harmoni Link" />
                </Row>
              </Card>
            </Group>
          </>
        );
      }}
    </AdminPage>
  );
}
