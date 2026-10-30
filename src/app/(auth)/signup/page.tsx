"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { authClient } from "@/lib/auth-client";
import styles from "../auth.module.css";
import { useSetup } from "../use-setup";

// Must match INVITE_HEADER in src/server/auth.ts.
const INVITE_HEADER = "x-harmoni-invite";

export default function SignupPage() {
  return (
    <main className={styles.page}>
      <Suspense>
        <SignupForm />
      </Suspense>
    </main>
  );
}

function SignupForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [invite, setInvite] = useState(params.get("invite") ?? "");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const setup = useSetup();
  const needsAdmin = setup?.needsAdmin;
  // An invite link still gets its code in, even where anyone can join.
  const askInvite = setup?.signups === "invite" || (setup?.signups === "open" && !!params.get("invite"));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    const handle = username.trim();
    const { error } = await authClient.signUp.email(
      // The server swaps in a placeholder email; accounts are username-only.
      { email: "", username: handle, name: name.trim() || handle, password },
      { headers: invite ? { [INVITE_HEADER]: invite.trim().toUpperCase() } : undefined },
    );
    if (error) {
      setError(friendlyError(error.message));
      setBusy(false);
      return;
    }
    router.replace("/");
    router.refresh();
  }

  return (
    <div className={styles.card}>
      <div className={styles.logo}>Harmoni</div>
      {needsAdmin && <div className={styles.badge}>First time here: you&apos;ll be the admin</div>}
      {setup && !needsAdmin && setup.name !== "Harmoni" && <div className={styles.badge}>{setup.name}</div>}
      <h1 className={styles.title}>
        {needsAdmin ? "Set up Harmoni" : setup?.signups === "closed" ? "Not taking new accounts" : `Join ${setup?.name ?? "Harmoni"}`}
      </h1>
      <p className={styles.subtitle}>
        {needsAdmin
          ? "Make your account, then invite the people you listen with."
          : setup?.signups === "closed"
            ? "This server isn't letting anyone new join right now. If you know who runs it, ask them."
            : "Pick a username and you're in."}
      </p>
      {setup?.signups === "closed" && !needsAdmin ? (
        <p className={styles.switch}>
          Already have an account? <Link href="/login">Sign in</Link>
        </p>
      ) : (
        <>
          <form className={styles.form} onSubmit={submit}>
            <label className={styles.field}>
              <span className={styles.label}>What should we call you?</span>
              <input className={styles.input} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" placeholder="Ejaz" />
            </label>
            <label className={styles.field}>
              <span className={styles.label}>Username</span>
              <input
                className={styles.input}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                pattern="[A-Za-z0-9_.]{2,32}"
                title="2 to 32 letters, numbers, dots or underscores"
                required
              />
              <span className={styles.hint}>Letters, numbers, dots and underscores. You&apos;ll sign in with this.</span>
            </label>
            <label className={styles.field}>
              <span className={styles.label}>Password</span>
              <input
                className={styles.input}
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                minLength={8}
                required
              />
              <span className={styles.hint}>At least 8 characters.</span>
            </label>
            {needsAdmin === false && askInvite && (
              <label className={styles.field}>
                <span className={styles.label}>Invite code</span>
                <input
                  className={styles.input}
                  value={invite}
                  onChange={(e) => setInvite(e.target.value)}
                  autoCapitalize="characters"
                  spellCheck={false}
                  placeholder="ABCD-EFGH"
                  required={setup?.signups === "invite"}
                />
              </label>
            )}
            {error && (
              <p className={styles.error} role="alert">
                {error}
              </p>
            )}
            <button className={styles.submit} disabled={busy || !setup}>
              {busy ? "Setting things up…" : needsAdmin ? "Create my account" : "Join"}
            </button>
          </form>
          <p className={styles.switch}>
            Already have an account? <Link href="/login">Sign in</Link>
          </p>
        </>
      )}
    </div>
  );
}

function friendlyError(message?: string): string {
  if (!message) return "Something went wrong. Try again?";
  if (/username is already taken|already exists/i.test(message)) return "That username's taken. Try another?";
  if (/username is invalid/i.test(message)) return "Usernames can only use letters, numbers, dots and underscores.";
  return message;
}
