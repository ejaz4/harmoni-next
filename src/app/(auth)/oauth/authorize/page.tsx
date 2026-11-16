"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { Icon } from "@/components/icon";
import { authClient } from "@/lib/auth-client";
import styles from "../../auth.module.css";
import { useSetup } from "../../use-setup";
import c from "./consent.module.css";

// The consent screen an app opens (in a browser tab) to sign in: OAuth's
// authorization endpoint. Signed-out visitors are sent to /login first and
// come back here. The checking and the answer happen in /api/oauth/authorize.

export default function AuthorizePage() {
  return (
    <main className={styles.page}>
      <Suspense>
        <Consent />
      </Suspense>
    </main>
  );
}

interface Asking {
  ok: true;
  app: { name: string; uri: string | null; returnsTo: string; registeredAt: string };
  user: { name: string; username: string };
}
type Checked = Asking | { ok: false; error: string; redirect?: string };

type Phase = { is: "checking" } | { is: "asking"; asking: Asking } | { is: "answering"; asking: Asking; allow: boolean } | { is: "done"; asking: Asking; allow: boolean; redirect: string } | { is: "broken"; error: string } | { is: "returning"; error: string };

function Consent() {
  const params = useSearchParams();
  const setup = useSetup();
  const query = params.toString();
  const [phase, setPhase] = useState<Phase>({ is: "checking" });
  const [error, alertError] = useState<string>();

  useEffect(() => {
    let live = true;
    void (async () => {
      const res = await fetch(`/api/oauth/authorize?${query}`).catch(() => undefined);
      if (!live) return;
      if (res?.status === 401) {
        window.location.replace(`/login?next=${encodeURIComponent(`/oauth/authorize?${query}`)}`);
        return;
      }
      const body = (await res?.json().catch(() => undefined)) as Checked | undefined;
      if (!live) return;
      if (!body) return setPhase({ is: "broken", error: "Couldn't reach Harmoni. Check your connection and try again." });
      if (body.ok) return setPhase({ is: "asking", asking: body });
      if (body.redirect) {
        // The app's own mistake: it hears about it, the person doesn't have to.
        setPhase({ is: "returning", error: body.error });
        window.location.replace(body.redirect);
        return;
      }
      setPhase({ is: "broken", error: body.error });
    })();
    return () => {
      live = false;
    };
  }, [query]);

  async function answer(asking: Asking, allow: boolean) {
    setPhase({ is: "answering", asking, allow });
    const res = await fetch("/api/oauth/authorize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...Object.fromEntries(params), allow }),
    }).catch(() => undefined);
    const body = (await res?.json().catch(() => undefined)) as { redirect?: string; error?: string } | undefined;
    if (!body?.redirect) {
      setPhase({ is: "asking", asking });
      alertError(body?.error ?? "Couldn't reach Harmoni. Try again.");
      return;
    }
    setPhase({ is: "done", asking, allow, redirect: body.redirect });
    window.location.replace(body.redirect);
  }

  const server = setup && setup.name !== "Harmoni" ? setup.name : null;

  if (phase.is === "checking") {
    return (
      <div className={styles.card}>
        <div className={styles.logo}>Harmoni</div>
        <p className={styles.subtitle}>Checking who&apos;s asking…</p>
      </div>
    );
  }

  if (phase.is === "broken" || phase.is === "returning") {
    return (
      <div className={styles.card}>
        <div className={styles.logo}>Harmoni</div>
        <h1 className={styles.title}>{phase.is === "returning" ? "Sending you back" : "This app can't sign in here"}</h1>
        <p className={styles.subtitle}>{phase.error}</p>
      </div>
    );
  }

  const { asking } = phase;
  const { app, user } = asking;
  const initial = (app.name.match(/\p{L}|\p{N}/u)?.[0] ?? "?").toUpperCase();

  if (phase.is === "done") {
    return (
      <div className={styles.card}>
        <div className={styles.logo}>Harmoni</div>
        <div className={c.done}>
          <Icon name={phase.allow ? "check" : "close"} size={24} />
        </div>
        <h1 className={styles.title}>{phase.allow ? `You're in` : "Not connected"}</h1>
        <p className={styles.subtitle}>
          {phase.allow ? `Head back to ${app.name}: it's signed in as you.` : `${app.name} can't use your account. Head back to it whenever you like.`}
        </p>
        <a className={`${styles.submit} ${c.submit}`} href={phase.redirect}>
          Back to {app.name}
        </a>
      </div>
    );
  }

  const busy = phase.is === "answering";
  return (
    <div className={styles.card}>
      <div className={styles.logo}>Harmoni</div>
      {server && <div className={styles.badge}>{server}</div>}
      <h1 className={styles.title}>Let {app.name} in?</h1>
      <p className={styles.subtitle}>
        It&apos;s asking to use Harmoni as {user.name} (@{user.username}).
      </p>

      <div className={c.app}>
        <span className={c.appIcon} aria-hidden>
          {initial}
        </span>
        <div>
          <div className={c.appName}>{app.name}</div>
          <div className={c.appMeta}>{app.uri ? new URL(app.uri).host : `Returns to ${app.returnsTo}`}</div>
        </div>
      </div>

      <ul className={c.list}>
        <li className={c.item}>
          <Icon name="check" size={16} /> Play, search and browse, like you do here
        </li>
        <li className={c.item}>
          <Icon name="check" size={16} /> See and change your likes, playlists, Spices and listening history
        </li>
        <li className={c.item}>
          <Icon name="check" size={16} /> Play on and control your other devices with Harmoni Link
        </li>
        <li className={`${c.item} ${c.itemNo}`}>
          <Icon name="close" size={16} /> Never your password, where you&apos;re signed in, or server settings
        </li>
      </ul>

      <p className={c.caution}>
        <strong>Only allow apps you trust.</strong> Any app can call itself {app.name}, and Harmoni can&apos;t check who made it. You can disconnect it any time in Settings.
      </p>

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      <div className={c.actions}>
        <button type="button" className={`${styles.submit} ${c.submit}`} disabled={busy} onClick={() => void answer(asking, true)}>
          {busy && phase.allow ? `Opening ${app.name}…` : "Allow"}
        </button>
        <button type="button" className={c.deny} disabled={busy} onClick={() => void answer(asking, false)}>
          {busy && !phase.allow ? "Telling it no…" : "Not now"}
        </button>
      </div>

      <p className={c.other}>
        Not {user.name}?{" "}
        <button
          type="button"
          onClick={async () => {
            await authClient.signOut();
            window.location.replace(`/login?next=${encodeURIComponent(`/oauth/authorize?${query}`)}`);
          }}
        >
          Use another account
        </button>
      </p>
    </div>
  );
}
