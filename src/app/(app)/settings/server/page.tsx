"use client";

import type { AdminStats } from "@/lib/admin";
import { plural } from "@/lib/format";
import { useApi } from "@/lib/use-api";
import { useServer } from "@/components/providers/user";
import { bytes, Group, SettingsPage, settingsStyles as s } from "../parts";

const hours = (ms: number) => (ms < 3_600_000 ? `${Math.round(ms / 60_000)} min` : `${Math.round(ms / 3_600_000).toLocaleString()} h`);
const uptime = (sec: number) => (sec < 3600 ? `${Math.max(1, Math.round(sec / 60))} min` : sec < 86_400 ? `${Math.round(sec / 3600)} hours` : `${Math.round(sec / 86_400)} days`);

export default function ServerOverviewPage() {
  const server = useServer();
  const { data: stats } = useApi<AdminStats>("/api/admin/stats");

  const groups: [string, [string, string][]][] = stats
    ? [
        [
          "People",
          [
            [stats.people.toLocaleString(), `${stats.people === 1 ? "account" : "accounts"} · ${plural(stats.admins, "admin")}`],
            [stats.online ? stats.online.people.toLocaleString() : "–", stats.online ? `listening now · ${plural(stats.online.devices, "device")}` : "listening now (Link is off)"],
            [stats.playsThisWeek.toLocaleString(), `plays this week · ${hours(stats.listeningThisWeekMs)}`],
            [stats.plays.toLocaleString(), "plays in total"],
          ],
        ],
        [
          "Library",
          [
            [stats.songs.toLocaleString(), "songs"],
            [stats.albums.toLocaleString(), "albums"],
            [stats.artists.toLocaleString(), "artists"],
            [(stats.playlists + stats.spices).toLocaleString(), "playlists and Spices"],
          ],
        ],
        [
          "System",
          [
            [bytes(stats.cache.bytes), `audio cache · ${plural(stats.cache.songs, "song")}`],
            [uptime(stats.uptimeS), "uptime"],
            [stats.version, "Harmoni version"],
          ],
        ],
      ]
    : [];

  return (
    <SettingsPage title="Overview" description={server ? `How ${server.name} is doing.` : undefined}>
      {stats
        ? groups.map(([title, tiles]) => (
            <Group key={title} title={title}>
              <div className={s.stats}>
                {tiles.map(([value, label]) => (
                  <div key={label} className={s.stat}>
                    <div className={`${s.statValue} tabular`}>{value}</div>
                    <div className={s.statLabel}>{label}</div>
                  </div>
                ))}
              </div>
            </Group>
          ))
        : (
            <Group title="People">
              <div className={s.stats}>
                {Array.from({ length: 4 }, (_, i) => (
                  <div key={i} className={`${s.stat} ${s.statSkeleton}`} />
                ))}
              </div>
            </Group>
          )}
    </SettingsPage>
  );
}
