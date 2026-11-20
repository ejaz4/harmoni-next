"use client";

import { Icon } from "@/components/icon";
import { useConfirm } from "@/components/providers/prompt";
import { useToast } from "@/components/providers/toast";
import { useUpdatePreferences, useUser } from "@/components/providers/user";
import { ui } from "@/components/ui";
import { api } from "@/lib/api";
import { Card, Group, Row, SettingsPage, settingsStyles as s, Switch } from "../parts";

export default function RecommendationsPage() {
  const user = useUser();
  const updatePreferences = useUpdatePreferences();
  const confirm = useConfirm();
  const toast = useToast();
  const available = user?.server.features.superProcessing !== false;
  const on = !!user?.superProcessing;

  async function reset() {
    const sure = await confirm({
      title: "Reset recommendations?",
      note: "Your listening history is permanently deleted and Home starts fresh. Likes and playlists are kept. This can't be undone.",
      confirm: "Reset",
      danger: true,
      typed: "reset",
    });
    if (!sure) return;
    try {
      await api("/api/me/listening", { method: "DELETE" });
      toast("Recommendations reset");
    } catch {
      toast("Couldn't reset recommendations.", "error");
    }
  }

  return (
    <SettingsPage title="Recommendations" description="Super Processing personalises Home, your Spices and Autoplay based on how you listen.">
      <Group id="super-processing" title="Super Processing">
        <Card>
          <Row title="Personalise with Super Processing">
            {available ? (
              <Switch
                checked={on}
                onChange={(superProcessing) => updatePreferences({ superProcessing }).catch(() => toast("Couldn't change Super Processing.", "error"))}
                label="Super Processing"
              />
            ) : (
              <span className={s.unavailable}>Turned off on this server</span>
            )}
          </Row>
          {on && (
            <Row title="Reset recommendations" note="Clear your listening history and start fresh.">
              <button type="button" className={`${ui.button} ${ui.buttonSmall}`} onClick={reset}>
                <Icon name="refresh" /> Reset
              </button>
            </Row>
          )}
        </Card>
      </Group>

      {available && (
        <Group id="what-it-uses" title="What it uses">
          <Card>
            <ul className={s.points}>
              <li>
                <Icon name="music" /> Songs you finish, skip or replay
              </li>
              <li>
                <Icon name="heart" /> Your likes, playlists and most-played artists
              </li>
              <li>
                <Icon name="lock" /> Stays on this server and is only used for you
              </li>
            </ul>
          </Card>
        </Group>
      )}
    </SettingsPage>
  );
}
