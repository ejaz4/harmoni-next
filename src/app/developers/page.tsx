import type { Metadata } from "next";
import { JetBrains_Mono } from "next/font/google";
import { headers } from "next/headers";
import { Suspense } from "react";
import { Icon } from "@/components/icon";
import { loadDocs, withOrigin, type Heading } from "@/server/docs";
import { originFrom } from "@/server/origin";
import { Chrome, type NavItem } from "./chrome";
import s from "./developers.module.css";

// The app-developer docs, served by every Harmoni server and readable
// without an account: docs/api/README.md and reference.md, as one page.

const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono", display: "swap" });

export const metadata: Metadata = {
  title: "API docs",
  description: "How apps sign in to a Harmoni server, and every endpoint they can use once they have.",
};

export default async function DevelopersPage() {
  const docs = await loadDocs();
  return (
    <div className={`${s.page} ${mono.variable}`}>
      <Chrome
        nav={[
          { id: "guide", title: "Building an app", items: outline(docs.guide.headings) },
          { id: "reference", title: "API reference", items: outline(docs.reference.headings) },
        ]}
      >
        <header className={s.intro}>
          <p className={s.eyebrow}>For app developers</p>
          <h1>Harmoni API</h1>
          <p className={s.lede}>
            How an app signs in to a Harmoni server, and everything it can do once it has: search, play, likes, playlists, Spices, history and
            Harmoni Link. Every Harmoni server answers the same API at its own address.
          </p>
          <Suspense fallback={<p className={s.server} data-waiting="" aria-hidden="true" />}>
            <ThisServer />
          </Suspense>
          <ul className={s.facts}>
            <li>
              <strong>OAuth 2.0</strong> with PKCE
            </li>
            <li>
              <strong>JSON</strong> over HTTP
            </li>
            <li>
              <strong>Bearer</strong> tokens, 1 hour
            </li>
            <li>
              <strong>Server-Sent Events</strong> for Link
            </li>
          </ul>
        </header>

        <section className={s.doc} id="guide" data-doc="guide" aria-labelledby="guide-title">
          <p className={s.eyebrow}>Guide</p>
          <h1 className={s.docTitle} id="guide-title">
            Building an app
          </h1>
          <Suspense>
            <Body html={docs.guide.html} />
          </Suspense>
        </section>

        <section className={s.doc} id="reference" data-doc="reference" aria-labelledby="reference-title">
          <p className={s.eyebrow}>Reference</p>
          <h1 className={s.docTitle} id="reference-title">
            API reference
          </h1>
          <Suspense>
            <Body html={docs.reference.html} />
          </Suspense>
        </section>

        <p className={s.foot}>
          These pages are docs/api in the Harmoni source, so they always match the server you&apos;re reading them on.
        </p>
      </Chrome>
    </div>
  );
}

// The examples say music.example.com; here they say this server.
async function Body({ html }: { html: string }) {
  const origin = originFrom(await headers());
  return <div className={s.prose} dangerouslySetInnerHTML={{ __html: withOrigin(html, origin) }} />;
}

async function ThisServer() {
  const origin = originFrom(await headers());
  if (!origin) return null;
  return (
    <p className={s.server}>
      <Icon name="server" className={s.serverIcon} />
      <span className={s.serverText}>
        <span className={s.serverLabel}>This server</span>
        <code>{origin}</code>
      </span>
      <button type="button" className={`copy ${s.serverCopy}`} data-copy={origin} aria-label={`Copy ${origin}`}>
        <span className="copy-icons">
          <Icon name="copy" className="copy-idle" />
          <Icon name="check" className="copy-done" />
        </span>
        <span className="copy-label">Copy</span>
      </button>
    </p>
  );
}

function outline(headings: Heading[]): NavItem[] {
  const items: NavItem[] = [];
  // A heading's own links would nest inside the contents' link.
  const html = (h: Heading) => h.html.replace(/<\/?a\b[^>]*>/g, "");
  for (const h of headings) {
    if (h.depth === 2) items.push({ id: h.id, html: html(h), text: h.text.toLowerCase(), kids: [] });
    else if (h.depth === 3 && items.length) items[items.length - 1].kids.push({ id: h.id, html: html(h), text: h.text.toLowerCase() });
  }
  return items;
}
