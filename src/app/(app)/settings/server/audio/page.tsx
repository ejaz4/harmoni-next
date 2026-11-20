"use client";

import { useState } from "react";
import { Icon } from "@/components/icon";
import { useConfirm } from "@/components/providers/prompt";
import { useToast } from "@/components/providers/toast";
import { ui } from "@/components/ui";
import type { AdminSettings, AdminStats } from "@/lib/admin";
import { api } from "@/lib/api";
import { plural } from "@/lib/format";
import { useApi } from "@/lib/use-api";
import { bytes, Card, Group, Row, Segmented, settingsStyles as s } from "../../parts";
import { AdminPage, type Save } from "../admin";

export default function AudioPage() {
  return (
    <AdminPage title="Audio" description="Songs stream from YouTube Music as AAC at about 128 kbps, and are cached on this server after their first play.">
      {(settings, save) => <Cache settings={settings} save={save} />}
    </AdminPage>
  );
}

function Cache({ settings, save }: { settings: AdminSettings; save: Save }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [version, setVersion] = useState(0);
  const { data: stats } = useApi<AdminStats>("/api/admin/stats", version);
  const used = stats?.cache.bytes ?? 0;
  const limit = settings.cacheLimitGb * 1e9;

  async function empty() {
    const sure = await confirm({
      title: "Empty the audio cache?",
      note: `${stats ? `${bytes(used)} across ${plural(stats.cache.songs, "song")}. ` : ""}Songs will stream from their source again, so they may take a moment longer to start.`,
      confirm: "Empty cache",
      danger: true,
    });
    if (!sure) return;
    try {
      const { removed } = await api<{ removed: number }>("/api/admin/cache", { method: "DELETE" });
      toast(`Removed ${plural(removed, "song")} from the cache`);
    } catch {
      toast("Couldn't empty the cache.", "error");
    }
    setVersion((v) => v + 1);
  }

  return (
    <Group id="cache" title="Cache">
      <Card>
        <div className={s.row} style={{ display: "block" }}>
          <div className={s.rowTitle}>Storage used</div>
          <div className={s.rowNote}>
            {stats ? (
              <>
                <strong>{bytes(used)}</strong>
                {limit ? ` of ${settings.cacheLimitGb} GB` : ""} · {plural(stats.cache.songs, "song")}
              </>
            ) : (
              "Measuring…"
            )}
          </div>
          {limit > 0 && (
            <div className={`${s.meter} ${used >= limit ? s.meterFull : ""}`}>
              <span style={{ width: `${Math.min(100, (used / limit) * 100)}%` }} />
            </div>
          )}
        </div>
        <Row wide title="Cache limit" note={settings.cacheLimitGb ? "When full, the songs played least recently are removed first." : "No limit. The cache grows as new songs are played."}>
          <Segmented
            label="Cache limit"
            value={settings.cacheLimitGb}
            onChange={(cacheLimitGb) => save({ cacheLimitGb }, cacheLimitGb ? `Cache limit set to ${cacheLimitGb} GB` : "Cache limit removed")}
            options={[0, 2, 5, 10, 25, 50, 100].map((gb) => ({ value: gb, label: gb ? `${gb} GB` : "None" }))}
          />
        </Row>
        <Row title="Empty cache" note="Free up the space now. Libraries aren't affected.">
          <button type="button" className={`${ui.button} ${ui.buttonSmall}`} onClick={empty} disabled={!stats?.cache.songs}>
            <Icon name="trash" /> Empty
          </button>
        </Row>
      </Card>
    </Group>
  );
}
