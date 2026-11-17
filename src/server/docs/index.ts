import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { cacheLife } from "next/cache";
import { anchors, render, withoutContents, type Heading } from "./render";

// The app-developer docs (docs/api), as served at /developers. The Markdown
// stays the source, readable on GitHub; this lays both files out as one page.

export type { Heading };

export interface Docs {
  guide: { html: string; headings: Heading[] };
  reference: { html: string; headings: Heading[] };
}

// The page's own landmarks, which a heading mustn't take.
const TAKEN = new Set(["top", "guide", "reference", "contents"]);

// Examples in the docs use this address; the page shows its own instead.
export const EXAMPLE_ORIGIN = "https://music.example.com";

export async function loadDocs(): Promise<Docs> {
  "use cache";
  cacheLife("max");

  const dir = join(process.cwd(), "docs/api");
  const [guideMd, refMd] = await Promise.all(["README.md", "reference.md"].map(async (f) => withoutContents(await readFile(join(dir, f), "utf8"))));

  // Both docs share one page, so a reference anchor that the guide already
  // uses gets a "ref-" prefix. Worked out first, so links between them land.
  const guideIds = new Set(anchors(guideMd));
  const guideId = (a: string) => (TAKEN.has(a) ? `${a}-section` : a);
  const refId = (a: string) => (guideIds.has(a) || TAKEN.has(a) ? `ref-${a}` : a);
  const hash = (href: string) => decodeURIComponent(href.split("#")[1] ?? "");

  const guide = render(guideMd, {
    id: guideId,
    link: (href) => {
      if (href.startsWith("reference.md")) return hash(href) ? `#${refId(hash(href))}` : "#reference";
      if (href.startsWith("README.md")) return hash(href) ? `#${guideId(hash(href))}` : "#guide";
      if (href.startsWith("#")) return `#${guideId(hash(href))}`;
      return href;
    },
  });
  const reference = render(refMd, {
    id: refId,
    link: (href) => {
      if (href.startsWith("README.md")) return hash(href) ? `#${guideId(hash(href))}` : "#guide";
      if (href.startsWith("reference.md")) return hash(href) ? `#${refId(hash(href))}` : "#reference";
      if (href.startsWith("#")) return `#${refId(hash(href))}`;
      return href;
    },
  });

  if (process.env.NODE_ENV !== "production") {
    const ids = new Set([...guide.headings, ...reference.headings].map((h) => h.id).concat([...TAKEN]));
    const broken = [...(guide.html + reference.html).matchAll(/href="#([^"]+)"/g)].map((m) => m[1]).filter((id) => !ids.has(id));
    if (broken.length) console.warn(`docs/api: links to nowhere: ${[...new Set(broken)].join(", ")}`);
  }

  return { guide, reference };
}

/** Puts this server's address where the docs say music.example.com. */
export function withOrigin(html: string, origin: string | null): string {
  if (!origin) return html;
  const host = new URL(origin).host;
  return html
    .replaceAll(encodeURIComponent(EXAMPLE_ORIGIN), encodeURIComponent(origin))
    .replaceAll(EXAMPLE_ORIGIN, origin)
    .replaceAll(new URL(EXAMPLE_ORIGIN).host, host);
}
