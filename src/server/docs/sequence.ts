// Draws a Mermaid sequence diagram as plain HTML and CSS, so the docs can
// show the sign-in flow without shipping Mermaid to the browser. Covers the
// part of the syntax the docs use: participant/actor (with "as"), and
// ->>, -->>, ->, --> messages. Anything else returns null and the caller
// shows the source instead.

import { ICONS } from "@/components/icon/data";

interface Who {
  id: string;
  label: string;
  actor: boolean;
}

interface Step {
  from: number;
  to: number;
  text: string;
  reply: boolean;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const DECLARE = /^(participant|actor)\s+(\S+?)(?:\s+as\s+(.+))?$/;
const MESSAGE = /^([^\s-][^-]*?)\s*(-->>|->>|-->|->)\s*([^:]+?)\s*:\s*(.*)$/;

export function sequenceDiagram(source: string): string | null {
  const lines = source
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("%%"));
  if (lines.shift() !== "sequenceDiagram") return null;

  const people: Who[] = [];
  const steps: Step[] = [];
  const indexOf = (id: string) => {
    let i = people.findIndex((p) => p.id === id);
    if (i < 0) i = people.push({ id, label: id, actor: false }) - 1;
    return i;
  };

  for (const line of lines) {
    const d = line.match(DECLARE);
    if (d) {
      const i = indexOf(d[2]);
      people[i] = { id: d[2], label: d[3]?.trim() || d[2], actor: d[1] === "actor" };
      continue;
    }
    const m = line.match(MESSAGE);
    if (!m) return null;
    steps.push({ from: indexOf(m[1].trim()), to: indexOf(m[3].trim()), text: m[4], reply: m[2].startsWith("--") });
  }
  if (!people.length || !steps.length) return null;

  const person = ICONS.user;
  const heads = people
    .map(
      (p, i) =>
        `<div class="seq-who" style="grid-column:${i + 1}">${
          p.actor ? `<svg viewBox="0 0 ${person.width} ${person.height}" fill="currentColor" aria-hidden="true">${person.body}</svg>` : ""
        }${esc(p.label)}</div>`,
    )
    .join("");
  const lives = people.map(() => "<span></span>").join("");
  const items = steps
    .map((s) => {
      const lo = Math.min(s.from, s.to);
      const hi = Math.max(s.from, s.to);
      const classes = ["seq-step", s.reply && "seq-reply", s.to < s.from && "seq-back", s.to === s.from && "seq-self"].filter(Boolean).join(" ");
      return `<li class="${classes}" style="grid-column:${lo + 1} / ${hi + 2};--span:${hi - lo + 1}"><span class="seq-route">${esc(people[s.from].label)}<span aria-label=" to "> → </span>${esc(people[s.to].label)}</span><span class="seq-text">${inline(s.text)}</span><span class="seq-arrow" aria-hidden="true"></span></li>`;
    })
    .join("");

  return `<figure class="seq" style="--n:${people.length}"><div class="seq-heads">${heads}</div><div class="seq-body"><div class="seq-lives" aria-hidden="true">${lives}</div><ol class="seq-steps">${items}</ol></div></figure>`;
}

// Paths and endpoints in a message read as code; the rest is plain text.
function inline(text: string): string {
  return esc(text).replace(/((?:GET|POST|PUT|PATCH|DELETE)\s+)?(\/[\w./{}\-:]*)/g, (_, method: string | undefined, path: string) =>
    `<code>${method ?? ""}${path}</code>`,
  );
}
