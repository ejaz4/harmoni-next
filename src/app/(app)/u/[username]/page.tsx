"use client";

import Link from "next/link";
import { Suspense, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { Icon } from "@/components/icon";
import { Avatar } from "@/components/profile/avatar";
import { FollowButton, FollowsYou } from "@/components/profile/people";
import { profileFont } from "@/components/profile/profile-fonts";
import styles from "@/components/profile/profile.module.css";
import { useLibrary } from "@/components/providers/library";
import { useToast } from "@/components/providers/toast";
import { useRefreshUser } from "@/components/providers/user";
import { CardLink } from "@/components/song/song-card";
import { SongList } from "@/components/song/song-list";
import { EmptyState, Menu, Section, ui, type MenuItem } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { plural } from "@/lib/format";
import { ACCENTS, BANNERS, bannerBackground, BIO_MAX, FONTS, inkFor, type BannerKey, type FontKey } from "@/lib/profile-style";
import { canShare, copyLink, profilePath, shareLink } from "@/lib/share";
import { useApi } from "@/lib/use-api";
import type { ProfileView, UserCard } from "@/server/social/profile";

export default function ProfileRoute() {
  return (
    <Suspense fallback={<ProfileSkeleton />}>
      <ProfileContent />
    </Suspense>
  );
}

interface Draft {
  name: string;
  bio: string;
  accent: string;
  font: FontKey;
  banner: BannerKey | "image";
  showLikes: boolean;
  showPlaylists: boolean;
}

const draftOf = (p: ProfileView): Draft => ({
  name: p.user.name,
  bio: p.bio ?? "",
  accent: p.accent,
  font: p.font,
  banner: p.banner,
  showLikes: p.showLikes,
  showPlaylists: p.showPlaylists,
});

function ProfileContent() {
  const { username } = useParams<{ username: string }>();
  const library = useLibrary();
  const toast = useToast();
  const refreshUser = useRefreshUser();
  const { data, error, reload } = useApi<ProfileView>(`/api/users/${encodeURIComponent(decodeURIComponent(username))}`, library.version);
  // Changes made here, shown until the next load from the server replaces them.
  const [changed, setChanged] = useState<{ base: ProfileView; value: ProfileView }>();
  const [draft, setDraft] = useState<Draft>();
  const [saving, setSaving] = useState(false);

  if (error) return <EmptyState title="No one by that name" body="They may have changed their username, or there's nobody here called that." />;
  if (!data) return <ProfileSkeleton />;
  const profile = changed?.base === data ? changed.value : data;
  const setOverride = (value: ProfileView) => setChanged({ base: data, value });
  const editing = !!draft;
  // While editing, the page shows the draft as it'll look.
  const look = draft ?? draftOf(profile);
  const font = profileFont(look.font);
  const ink = inkFor(look.accent);

  async function save() {
    if (!draft) return;
    setSaving(true);
    try {
      const updated = await api<ProfileView>("/api/me/profile", {
        method: "PATCH",
        json: {
          name: draft.name,
          bio: draft.bio || null,
          accent: draft.accent,
          font: draft.font,
          ...(draft.banner !== "image" && draft.banner !== profile.banner && { banner: draft.banner }),
          showLikes: draft.showLikes,
          showPlaylists: draft.showPlaylists,
        },
      });
      setOverride(updated);
      setDraft(undefined);
      refreshUser();
      reload();
      toast("Profile saved");
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Couldn't save your profile.", "error");
    } finally {
      setSaving(false);
    }
  }

  // Pictures save as soon as they're picked.
  async function upload(kind: "avatar" | "banner", file: File | null) {
    try {
      if (file) await api(`/api/me/profile/${kind}`, { method: "PUT", body: file, headers: { "Content-Type": file.type || "application/octet-stream" } });
      else await api(`/api/me/profile/${kind}`, { method: "DELETE" });
      const updated = await api<ProfileView>("/api/me/profile");
      setOverride(updated);
      if (kind === "banner") setDraft((d) => d && { ...d, banner: updated.banner });
      refreshUser();
      toast(file ? (kind === "avatar" ? "New profile picture" : "New banner") : kind === "avatar" ? "Picture removed" : "Banner removed");
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Couldn't upload that picture.", "error");
    }
  }

  async function unpin(songId: string) {
    const pinned = profile.pinned.filter((s) => s.id !== songId);
    setOverride({ ...profile, pinned });
    await api(`/api/me/profile/pins/${songId}`, { method: "DELETE" }).catch(() => toast("Couldn't change your profile.", "error"));
    refreshUser();
  }

  async function movePin(index: number, by: -1 | 1) {
    const pinned = [...profile.pinned];
    const [song] = pinned.splice(index, 1);
    pinned.splice(index + by, 0, song);
    setOverride({ ...profile, pinned });
    await api("/api/me/profile", { method: "PATCH", json: { pinnedSongs: pinned.map((s) => s.id) } }).catch(() => toast("Couldn't change your profile.", "error"));
  }

  const showBanner = look.banner === "image" && profile.bannerUrl ? `center / cover no-repeat url(${profile.bannerUrl})` : bannerBackground(look.banner === "image" ? "glow" : look.banner, look.accent);
  const path = profilePath(profile.user.username);
  const shareItems: MenuItem[] = [
    { label: "Copy link to profile", icon: "copy", onSelect: () => void copyLink(path).then((ok) => toast(ok ? "Link copied" : "Couldn't copy the link.", ok ? "info" : "error")) },
    ...(canShare() ? [{ label: "Share…", icon: "share" as const, onSelect: () => void shareLink(path, profile.user.name) }] : []),
  ];

  return (
    <div
      className={`${styles.profile} ${font.className} ${editing ? styles.editing : ""}`}
      style={{ "--p-accent": look.accent, "--p-ink": ink, "--p-font": font.family } as React.CSSProperties}
    >
      <div className={styles.banner} style={{ background: showBanner }}>
        {editing && (
          <PictureButton label={profile.bannerUrl ? "Change banner photo" : "Add a banner photo"} className={styles.bannerEdit} onPick={(f) => upload("banner", f)} canRemove={!!profile.bannerUrl} text="Photo" />
        )}
      </div>

      <div className={styles.identity}>
        <div className={styles.avatarWrap}>
          <Avatar name={look.name} url={profile.user.avatarUrl} accent={look.accent} className={styles.bigAvatar} />
          {editing && <PictureButton label="Change profile picture" className={styles.avatarEdit} onPick={(f) => upload("avatar", f)} canRemove={!!profile.user.avatarUrl} />}
        </div>

        <div className={styles.identityBody}>
          {editing ? (
            <input
              className={`${styles.nameInput} ${styles.name}`}
              value={look.name}
              maxLength={60}
              aria-label="Your name"
              onChange={(e) => setDraft({ ...look, name: e.target.value })}
            />
          ) : (
            <h1 className={styles.name}>{profile.user.name}</h1>
          )}
          <p className={styles.handle}>
            @{profile.user.username}
            <FollowsYou user={profile.user} />
          </p>
          {editing ? (
            <div className={styles.bioField}>
              <textarea
                className={styles.bioInput}
                value={look.bio}
                maxLength={BIO_MAX}
                rows={3}
                placeholder="A line or two about you and what you listen to"
                aria-label="Bio"
                onChange={(e) => setDraft({ ...look, bio: e.target.value })}
              />
              <span className={styles.bioCount}>{BIO_MAX - look.bio.length}</span>
            </div>
          ) : (
            profile.bio && <p className={styles.bio}>{profile.bio}</p>
          )}
          <p className={styles.counts}>
            <Link href={`${path}/followers`}>
              <strong>{profile.followers.toLocaleString()}</strong> {profile.followers === 1 ? "follower" : "followers"}
            </Link>
            <Link href={`${path}/following`}>
              <strong>{profile.following.toLocaleString()}</strong> following
            </Link>
          </p>
        </div>

        <div className={styles.identityActions}>
          {profile.isMe ? (
            editing ? (
              <>
                <button type="button" className={ui.button} onClick={() => setDraft(undefined)} disabled={saving}>
                  Cancel
                </button>
                <button type="button" className={`${ui.button} ${styles.follow}`} onClick={save} disabled={saving || !look.name.trim()}>
                  <Icon name="check" /> {saving ? "Saving…" : "Save"}
                </button>
              </>
            ) : (
              <button type="button" className={ui.button} onClick={() => setDraft(draftOf(profile))}>
                <Icon name="edit" /> Edit profile
              </button>
            )
          ) : (
            <FollowButton user={profile.user} onChange={(u: UserCard) => setOverride({ ...profile, user: u, followers: profile.followers + (u.youFollow ? 1 : -1) })} />
          )}
          {!editing && <Menu label="Share profile" icon="share" items={shareItems} />}
        </div>
      </div>

      {editing && <StylePanel look={look} onChange={setDraft} bannerUrl={profile.bannerUrl} onUploadBanner={(f) => upload("banner", f)} />}

      <Section title="On display">
        {profile.pinned.length ? (
          <SongList
            songs={profile.pinned}
            numbered
            rowMenu={
              profile.isMe
                ? (song, i) => [
                    ...(i > 0 ? [{ label: "Move up", icon: "arrow-up" as const, onSelect: () => void movePin(i, -1) }] : []),
                    ...(i < profile.pinned.length - 1 ? [{ label: "Move down", icon: "arrow-down" as const, onSelect: () => void movePin(i, 1) }] : []),
                    { label: "Take off your profile", icon: "pin", onSelect: () => void unpin(song.id) },
                  ]
                : undefined
            }
          />
        ) : profile.isMe ? (
          <EmptyState title="Put your favourites on display" body="Open any song's ••• menu and choose Show on your profile. Up to 10 go here, in the order you pick them." />
        ) : (
          <EmptyState title="Nothing on display yet" body={`${firstName(profile.user.name)} hasn't picked any songs to show off.`} />
        )}
      </Section>

      {profile.playlists && (profile.playlists.length > 0 || profile.isMe) && (
        <Section title="Playlists">
          {profile.isMe && !look.showPlaylists && <p className={styles.onlyYou}><Icon name="lock" /> Hidden: only you can see these here.</p>}
          {profile.playlists.length ? (
            <div className={ui.cardGrid}>
              {profile.playlists.map((p) => (
                <CardLink key={p.id} href={`/playlist/${p.id}`} artwork={p.artworks[0]} title={p.name} subtitle={`Playlist · ${plural(p.count, "song")}`} />
              ))}
            </div>
          ) : (
            <EmptyState title="No public playlists" body="Open one of your playlists and pick Share, then Public. It'll show up here for everyone." />
          )}
        </Section>
      )}

      {profile.likes && (profile.likes.count > 0 || profile.isMe) && (
        <Section
          title="Liked songs"
          link={profile.likes.count > profile.likes.songs.length ? { href: `${path}/likes`, label: `See all ${profile.likes.count.toLocaleString()}` } : undefined}
        >
          {profile.isMe && !look.showLikes && <p className={styles.onlyYou}><Icon name="lock" /> Hidden: only you can see these here.</p>}
          {profile.likes.songs.length ? <SongList songs={profile.likes.songs} /> : <EmptyState title="No liked songs yet" body="Tap the heart on songs you love." />}
        </Section>
      )}
    </div>
  );
}

// Colour, font, banner and what's shown, previewed on the page as they're picked.
function StylePanel({ look, onChange, bannerUrl, onUploadBanner }: { look: Draft; onChange: (d: Draft) => void; bannerUrl?: string; onUploadBanner: (f: File) => void }) {
  const file = useRef<HTMLInputElement>(null);
  return (
    <div className={styles.stylePanel}>
      <div className={styles.styleGroup}>
        <h3 className={styles.styleTitle}>Colour</h3>
        <div className={styles.swatches} role="radiogroup" aria-label="Colour">
          {ACCENTS.map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={look.accent === c}
              aria-label={c}
              className={styles.swatch}
              style={{ background: c }}
              onClick={() => onChange({ ...look, accent: c })}
            />
          ))}
          <label className={`${styles.swatch} ${styles.swatchCustom}`} aria-checked={!ACCENTS.includes(look.accent as (typeof ACCENTS)[number])} title="Any colour">
            <Icon name="palette" />
            <input type="color" value={look.accent} onChange={(e) => onChange({ ...look, accent: e.target.value })} aria-label="Pick any colour" />
          </label>
        </div>
      </div>

      <div className={styles.styleGroup}>
        <h3 className={styles.styleTitle}>Font</h3>
        <div className={styles.fontChips} role="radiogroup" aria-label="Font">
          {FONTS.map((f) => {
            const pf = profileFont(f.key);
            return (
              <button
                key={f.key}
                type="button"
                role="radio"
                aria-checked={look.font === f.key}
                className={`${styles.fontChip} ${pf.className}`}
                style={{ fontFamily: pf.family }}
                onClick={() => onChange({ ...look, font: f.key })}
              >
                {f.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className={styles.styleGroup}>
        <h3 className={styles.styleTitle}>Banner</h3>
        <div className={styles.bannerTiles} role="radiogroup" aria-label="Banner">
          {BANNERS.map((b) => (
            <button
              key={b.key}
              type="button"
              role="radio"
              aria-checked={look.banner === b.key}
              className={styles.bannerTile}
              style={{ background: bannerBackground(b.key, look.accent) }}
              onClick={() => onChange({ ...look, banner: b.key })}
            >
              <span>{b.label}</span>
            </button>
          ))}
          {bannerUrl && (
            <button
              type="button"
              role="radio"
              aria-checked={look.banner === "image"}
              className={styles.bannerTile}
              style={{ background: `center / cover url(${bannerUrl})` }}
              onClick={() => onChange({ ...look, banner: "image" })}
            >
              <span>Your photo</span>
            </button>
          )}
          <button type="button" className={`${styles.bannerTile} ${styles.bannerUpload}`} onClick={() => file.current?.click()}>
            <Icon name="image" />
            <span>{bannerUrl ? "New photo" : "Upload a photo"}</span>
          </button>
          <input
            ref={file}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onUploadBanner(f);
              e.target.value = "";
            }}
          />
        </div>
      </div>

      <div className={styles.styleGroup}>
        <h3 className={styles.styleTitle}>On your profile</h3>
        <label className={styles.toggle}>
          <input type="checkbox" checked={look.showPlaylists} onChange={(e) => onChange({ ...look, showPlaylists: e.target.checked })} />
          <span>Your public playlists</span>
        </label>
        <label className={styles.toggle}>
          <input type="checkbox" checked={look.showLikes} onChange={(e) => onChange({ ...look, showLikes: e.target.checked })} />
          <span>Songs you&apos;ve liked</span>
        </label>
      </div>
    </div>
  );
}

// A round camera button over a picture: pick a new one, or take it away.
function PictureButton({ label, className, onPick, canRemove, text }: { label: string; className: string; onPick: (f: File | null) => void; canRemove: boolean; text?: string }) {
  const file = useRef<HTMLInputElement>(null);
  const pick = () => file.current?.click();
  return (
    <div className={className}>
      {canRemove ? (
        <Menu
          className={styles.pictureButton}
          icon="snapshot"
          text={text}
          label={label}
          items={[
            { label: "Choose a new picture", icon: "image", onSelect: pick },
            { label: "Remove", icon: "trash", onSelect: () => onPick(null) },
          ]}
        />
      ) : (
        <button type="button" className={styles.pictureButton} onClick={pick} aria-label={label} title={label}>
          <Icon name="snapshot" />
          {text && <span>{text}</span>}
        </button>
      )}
      <input
        ref={file}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onPick(f);
          e.target.value = "";
        }}
      />
    </div>
  );
}

const firstName = (name: string) => name.trim().split(/\s+/)[0] || name;

function ProfileSkeleton() {
  return (
    <div className={styles.profile}>
      <div className={`${styles.banner} ${ui.skeleton}`} />
      <div className={styles.identity}>
        <div className={`${styles.bigAvatar} ${ui.skeleton}`} />
        <div className={styles.identityBody}>
          <div className={ui.skeleton} style={{ width: 220, height: 36, borderRadius: 8 }} />
          <div className={ui.skeleton} style={{ width: 120, height: 16, borderRadius: 6, marginTop: 10 }} />
        </div>
      </div>
    </div>
  );
}
