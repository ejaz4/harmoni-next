"use client";

import { useSyncExternalStore } from "react";
import { canFade } from "@/components/player/mixer";
import { useSettings } from "@/components/providers/settings";
import { useToast } from "@/components/providers/toast";
import { useUpdatePreferences, useUser } from "@/components/providers/user";
import { Card, Group, Range, Row, SettingsPage, settingsStyles as s, Switch } from "../parts";

const noSubscribe = () => () => {};

export default function PlaybackPage() {
  const { settings, update } = useSettings();
  const user = useUser();
  const updatePreferences = useUpdatePreferences();
  const toast = useToast();
  const fades = useSyncExternalStore(noSubscribe, canFade, () => true);
  const wakeLock = useSyncExternalStore(noSubscribe, () => "wakeLock" in navigator, () => true);
  const crossfade = fades ? settings.crossfade : 0;
  const unsupported = "Not supported on this device.";

  return (
    <SettingsPage title="Playback">
      <Group id="transitions" title="Transitions" aside="This device">
        <Card>
          <Row wide title="Crossfade" note={fades ? "Blend the end of each song into the start of the next." : unsupported}>
            <Range value={crossfade} min={0} max={12} onChange={(v) => update({ crossfade: v })} label="Crossfade" format={(v) => (v ? `${v} s` : "Off")} disabled={!fades} />
          </Row>
          <Row title="Smooth play and pause" note={fades ? "Fade the volume in and out instead of cutting it." : unsupported}>
            <Switch checked={fades && settings.smoothPause} onChange={(on) => update({ smoothPause: on })} label="Smooth play and pause" disabled={!fades} />
          </Row>
        </Card>
      </Group>

      <Group id="queue" title="Queue">
        <Card>
          <Row title="Autoplay" note="When your queue ends, keep playing similar songs.">
            {user?.server.features.autoplay === false ? (
              <span className={s.unavailable}>Turned off on this server</span>
            ) : (
              <Switch
                checked={!!user?.autoplay}
                onChange={(autoplay) => updatePreferences({ autoplay }).catch(() => toast("Couldn't change Autoplay.", "error"))}
                label="Autoplay"
              />
            )}
          </Row>
        </Card>
      </Group>

      <Group id="data" title="Streaming" aside="This device">
        <Card>
          <Row title="Preload next song" note="Start the next song instantly. Uses more data.">
            <Switch checked={settings.preloadNext} onChange={(on) => update({ preloadNext: on })} label="Preload next song" />
          </Row>
        </Card>
      </Group>

      <Group id="lyrics" title="Lyrics" aside="This device">
        <Card>
          <Row title="Keep screen on" note={wakeLock ? "Stop the screen dimming while lyrics are open." : unsupported}>
            <Switch checked={wakeLock && settings.keepAwake} onChange={(on) => update({ keepAwake: on })} label="Keep screen on" disabled={!wakeLock} />
          </Row>
        </Card>
      </Group>
    </SettingsPage>
  );
}
