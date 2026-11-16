// Builds the Harmoni API docs page (one HTML file: the guide, then the
// reference, with contents down the side) from docs/api/*.md. It's
// published as a claude.ai artifact: https://claude.ai/artifact/2f6r4ThZivSDuUCQvPS4bg
// Usage: bun scripts/api-docs/build.ts docs/api <out.html>
import { Marked, type Tokens } from "marked";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [dir, out] = process.argv.slice(2);
const RESERVED = new Set(["settings", "sidebar", "customize", "upgrade", "downloads", "guide", "reference", "top"]);

interface Heading {
  depth: number;
  id: string;
  html: string;
  text: string;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// GitHub's anchor rules, so links written for GitHub work here too.
function slugger() {
  const seen = new Map<string, number>();
  return (text: string) => {
    let base = text
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/`/g, "")
      .toLowerCase()
      .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, "")
      .replace(/ /g, "-");
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    if (n) base = `${base}-${n}`;
    return base;
  };
}

// Drops the doc's own "Contents" section: the sidebar does that job.
const withoutContents = (md: string) => md.replace(/\n## Contents\n[\s\S]*?\n(?=---\n|## )/, "\n");

const METHOD = /^`(GET|POST|PUT|PATCH|DELETE) ([^`]+)`(.*)$/;

function render(md: string, prefix: string, linkFor: (href: string) => string) {
  const slug = slugger();
  const headings: Heading[] = [];
  const marked = new Marked({ gfm: true });
  marked.use({
    renderer: {
      heading(this: { parser: { parseInline: (t: Tokens.Generic[]) => string } }, { tokens, depth, text }: Tokens.Heading) {
        let id = slug(text);
        if (RESERVED.has(id)) id = `${id}-section`;
        id = prefix + id;
        const m = text.match(METHOD);
        const html = m
          ? `<span class="method m-${m[1].toLowerCase()}">${m[1]}</span><code>${esc(m[2])}</code>${m[3] ? marked.parseInline(m[3]) : ""}`
          : this.parser.parseInline(tokens as Tokens.Generic[]);
        headings.push({ depth, id, html, text: text.replace(/`/g, "") });
        if (depth === 1) return "";
        return `<h${depth} id="${id}"><a class="anchor" href="#${id}" aria-label="Link to this section">#</a>${html}</h${depth}>\n`;
      },
      code({ text, lang }: Tokens.Code) {
        if (lang === "mermaid") return `<div class="diagram"><pre class="mermaid">${esc(text)}</pre></div>\n`;
        const language = (lang ?? "").split(/\s/)[0];
        const labels: Record<string, string> = { http: "HTTP", json: "JSON", kotlin: "Kotlin", sh: "Shell", ts: "TypeScript" };
        const label = labels[language] ?? language;
        return `<div class="code"><div class="code-bar"><span>${esc(label)}</span><button type="button" class="copy">Copy</button></div><pre><code class="${language ? `language-${language}` : "nohighlight"}">${esc(text)}</code></pre></div>\n`;
      },
      link({ href, tokens }: Tokens.Link) {
        const target = linkFor(href);
        const inner = marked.parseInline(tokens.map((t) => t.raw).join(""));
        const external = /^https?:/.test(target);
        return `<a href="${esc(target)}"${external ? ' target="_blank" rel="noopener"' : ""}>${inner}</a>`;
      },
      table(token: Tokens.Table) {
        const cell = (c: Tokens.TableCell) => marked.parseInline(c.text);
        const head = token.header.every((h) => !h.text.trim()) ? "" : `<thead><tr>${token.header.map((h) => `<th>${cell(h)}</th>`).join("")}</tr></thead>`;
        const rows = token.rows.map((r) => `<tr>${r.map((c) => `<td>${cell(c)}</td>`).join("")}</tr>`).join("");
        return `<div class="table-wrap"><table>${head}<tbody>${rows}</tbody></table></div>\n`;
      },
      blockquote({ tokens }: Tokens.Blockquote) {
        return `<aside class="note">${marked.parser(tokens)}</aside>\n`;
      },
      hr() {
        return "";
      },
    },
  });
  const html = marked.parse(md) as string;
  return { html, headings };
}

const guideMd = withoutContents(readFileSync(join(dir, "README.md"), "utf8"));
const refMd = withoutContents(readFileSync(join(dir, "reference.md"), "utf8"));

// A pre-pass to find each doc's anchors, so links across docs land right.
const ids = (md: string) => {
  const s = slugger();
  return [...md.matchAll(/^#{1,6} (.+)$/gm)].map((m) => s(m[1]));
};
const guideIds = new Set(ids(guideMd));
const clash = new Set(ids(refMd).filter((id) => guideIds.has(id)));
// The reference's anchors get a prefix only where they'd collide with the guide's.
const refPrefix = (id: string) => (clash.has(id) ? "ref-" : "");

const linkGuide = (href: string) => {
  if (href.startsWith("reference.md")) {
    const id = href.split("#")[1];
    return id ? `#${refPrefix(id)}${id}` : "#reference";
  }
  return href.startsWith("#") ? href : href;
};
const linkRef = (href: string) => {
  if (href.startsWith("README.md")) {
    const id = href.split("#")[1];
    return id ? `#${id}` : "#guide";
  }
  if (href.startsWith("#")) return `#${refPrefix(href.slice(1))}${href.slice(1)}`;
  return href;
};

const guide = render(guideMd, "", linkGuide);
// Render the reference with per-heading prefixes for clashing ids.
const refRendered = render(refMd, "", linkRef);
let refHtml = refRendered.html;
for (const id of clash) refHtml = refHtml.replace(`id="${id}"><a class="anchor" href="#${id}"`, `id="ref-${id}"><a class="anchor" href="#ref-${id}"`);
const refHeadings = refRendered.headings.map((h) => (clash.has(h.id) ? { ...h, id: `ref-${h.id}` } : h));

// Check every in-page link has somewhere to land.
const allIds = new Set([...guide.headings, ...refHeadings].map((h) => h.id).concat(["guide", "reference", "top"]));
const broken = [...(guide.html + refHtml).matchAll(/href="#([^"]+)"/g)].map((m) => m[1]).filter((id) => !allIds.has(id));
if (broken.length) console.warn("Broken links:", [...new Set(broken)].join(", "));

function nav(headings: Heading[], docId: string, title: string) {
  const h2s: { h: Heading; kids: Heading[] }[] = [];
  for (const h of headings) {
    if (h.depth === 2) h2s.push({ h, kids: [] });
    else if (h.depth === 3 && h2s.length) h2s[h2s.length - 1].kids.push(h);
  }
  const items = h2s
    .map(({ h, kids }) => {
      const sub = kids.length
        ? `<ul>${kids.map((k) => `<li><a href="#${k.id}" data-text="${esc(k.text.toLowerCase())}">${k.html}</a></li>`).join("")}</ul>`
        : "";
      return `<li class="group"><a href="#${h.id}" data-text="${esc(h.text.toLowerCase())}">${h.html}</a>${sub}</li>`;
    })
    .join("");
  return `<div class="nav-doc"><a class="nav-title" href="#${docId}">${title}</a><ul>${items}</ul></div>`;
}

const template = readFileSync(join(import.meta.dir, "template.html"), "utf8");
const page = template
  .replace("<!--NAV-->", nav(guide.headings, "guide", "Building an app") + nav(refHeadings, "reference", "API reference"))
  .replace("<!--GUIDE-->", guide.html)
  .replace("<!--REFERENCE-->", refHtml)
  .replace("<!--BUILT-->", new Date().toISOString().slice(0, 10));
writeFileSync(out, page);
console.log(`Wrote ${out}: ${(page.length / 1024).toFixed(0)} KB, ${guide.headings.length + refHeadings.length} headings, ${clash.size} renamed (${[...clash].join(", ")})`);
