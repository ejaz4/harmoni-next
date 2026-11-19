import type { CurrentUser } from "@/server/session";

// The signed-in person, and what the app needs to know about the server
// it's on (GET /api/me).
export interface ServerInfo {
  name: string;
  features: { superProcessing: boolean; autoplay: boolean; link: boolean; lyrics: boolean };
  canInvite: boolean;
  inviteDays: number; // how long invites last; 0 = until used
}

export type Me = Omit<CurrentUser, "app"> & {
  server: ServerInfo;
  app?: { id: string; name: string };
  avatarUrl?: string;
  accent: string; // their profile colour
  pinned: string[]; // song ids on display on their profile
};
