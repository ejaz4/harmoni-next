// Turns one of the Markdown docs in docs/api into HTML for /developers:
// GitHub-style anchors (so links written for GitHub land here too), method
// chips on endpoint headings, highlighted code with a Copy button, and
// sequence diagrams drawn without Mermaid.

import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import http from "highlight.js/lib/languages/http";
import json from "highlight.js/lib/languages/json";
import kotlin from "highlight.js/lib/languages/kotlin";
import typescript from "highlight.js/lib/languages/typescript";
import { Marked, type Tokens } from "marked";
import { ICONS } from "@/components/icon/data";
import { sequenceDiagram } from "./sequence";

hljs.registerLanguage("bash", bash);
hljs.registerLanguage("http", http);
hljs.registerLanguage("json", json);
hljs.registerLanguage("kotlin", kotlin);
hljs.registerLanguage("typescript", typescript);
hljs.registerAliases(["sh", "shell"], { languageName: "bash" });
hljs.registerAliases(["ts"], { languageName: "typescript" });

const LABELS: Record<string, string> = { bash: "Shell", sh: "Shell", http: "HTTP", json: "JSON", kotlin: "Kotlin", ts: "TypeScript", typescript: "TypeScript" };

export interface Heading {
  depth: number;
  id: string;
  /** The heading's inline HTML, method chip included. */
  html: string;
  /** Plain text, for filtering the contents. */
  text: string;
}

export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// GitHub's anchor rules.
export function slugger() {
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

/** Every heading's anchor, in order, as GitHub would make them. */
export function anchors(md: string): string[] {
  const slug = slugger();
  return new Marked({ gfm: true })
    .lexer(md)
    .filter((t): t is Tokens.Heading => t.type === "heading")
    .map((t) => slug(t.text));
}

// The doc's own "Contents" list: the page's sidebar does that job.
export const withoutContents = (md: string) => md.replace(/\n## Contents\n[\s\S]*?\n(?=---\n|## )/, "\n");

const METHOD = /^`(GET|POST|PUT|PATCH|DELETE) ([^`]+)`(.*)$/;

const svg = (name: keyof typeof ICONS, cls: string) =>
  `<svg class="${cls}" viewBox="0 0 ${ICONS[name].width} ${ICONS[name].height}" fill="currentColor" aria-hidden="true">${ICONS[name].body}</svg>`;
const COPY = `<button type="button" class="copy" data-copy aria-label="Copy"><span class="copy-icons">${svg("copy", "copy-idle")}${svg("check", "copy-done")}</span><span class="copy-label">Copy</span></button>`;

export function render(md: string, opts: { id: (anchor: string) => string; link: (href: string) => string }) {
  const slug = slugger();
  const headings: Heading[] = [];
  const marked = new Marked({ gfm: true });
  marked.use({
    renderer: {
      heading({ tokens, depth, text }) {
        const id = opts.id(slug(text));
        const m = text.match(METHOD);
        const html = m
          ? `<span class="method m-${m[1].toLowerCase()}">${m[1]}</span><code>${esc(m[2])}</code>${m[3] ? marked.parseInline(m[3]) : ""}`
          : this.parser.parseInline(tokens);
        headings.push({ depth, id, html, text: text.replace(/`/g, "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") });
        // The page supplies each doc's title.
        if (depth === 1) return "";
        return `<h${depth} id="${id}"><a class="anchor" href="#${id}" aria-label="Link to this section">#</a>${html}</h${depth}>\n`;
      },
      code({ text, lang }) {
        const language = (lang ?? "").split(/\s/)[0];
        if (language === "mermaid") {
          const drawn = sequenceDiagram(text);
          if (drawn) return `<div class="diagram">${drawn}</div>\n`;
        }
        const known = language && hljs.getLanguage(language);
        const body = known ? hljs.highlight(text, { language, ignoreIllegals: true }).value : esc(text);
        return `<div class="code"><div class="code-bar"><span>${esc(LABELS[language] ?? language)}</span>${COPY}</div><pre><code>${body}</code></pre></div>\n`;
      },
      link({ href, tokens }) {
        const target = opts.link(href);
        const external = /^https?:/.test(target);
        return `<a href="${esc(target)}"${external ? ' target="_blank" rel="noopener"' : ""}>${this.parser.parseInline(tokens)}</a>`;
      },
      table(token) {
        const cell = (c: Tokens.TableCell) => this.parser.parseInline(c.tokens);
        const head = token.header.every((h) => !h.text.trim()) ? "" : `<thead><tr>${token.header.map((h) => `<th>${cell(h)}</th>`).join("")}</tr></thead>`;
        const rows = token.rows.map((r) => `<tr>${r.map((c) => `<td>${cell(c)}</td>`).join("")}</tr>`).join("");
        return `<div class="table-wrap"><table>${head}<tbody>${rows}</tbody></table></div>\n`;
      },
      blockquote({ tokens }) {
        return `<aside class="note">${this.parser.parse(tokens)}</aside>\n`;
      },
      hr() {
        return "";
      },
    },
  });
  return { html: marked.parse(md, { async: false }), headings };
}
