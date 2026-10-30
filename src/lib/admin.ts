// Shapes the admin API sends to Settings → Server.

import type { SignupMode } from "@/server/settings";

export type ProviderRoleName = "search" | "song" | "lyrics" | "artist" | "discovery";

export interface AdminSettings {
  name: string;
  welcome: string;
  signups: SignupMode;
  invitesBy: "admins" | "everyone";
  inviteDays: number;
  maxAccounts: number;
  features: { superProcessing: boolean; autoplay: boolean; link: boolean; lyrics: boolean };
  cacheLimitGb: number;
  disabledProviders: string[];
  songOrder: string[];
  lyricsOrder: string[];
  // Never the keys themselves: whether each is set, and where from.
  keys: Record<string, { set: boolean; fromEnv: boolean; hint?: string }>;
  providers: { prefix: string; name: string; enabled: boolean; roles: ProviderRoleName[] }[];
  // Providers that would work with keys this server doesn't have.
  needKeys: { prefix: string; name: string; keys: string[] }[];
}

export interface AdminStats {
  people: number;
  admins: number;
  songs: number;
  artists: number;
  albums: number;
  playlists: number;
  spices: number;
  plays: number;
  playsThisWeek: number;
  listeningThisWeekMs: number;
  cache: { songs: number; bytes: number };
  online: { devices: number; people: number } | null;
  uptimeS: number;
  version: string;
  node: string;
}

export interface AdminUser {
  id: string;
  name: string;
  username: string;
  role: "admin" | "user";
  suspended: boolean;
  createdAt: string;
  lastSeenAt: string | null;
  plays: number;
  likes: number;
  playlists: number;
  invitedBy: string | null;
}
