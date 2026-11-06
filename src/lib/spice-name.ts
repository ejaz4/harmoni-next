// A name for someone's own Spice, from its seed songs: their artists, the
// most picked first. Nobody has to name one; renaming it keeps their name.

const MAX = 60;

export function spiceName(seeds: { artists: { name: string; role?: string }[] }[]): string {
  const counts = new Map<string, { name: string; n: number; first: number }>();
  seeds.forEach((song, i) => {
    const lead = song.artists.find((a) => a.role !== "featured") ?? song.artists[0];
    const name = lead?.name.trim();
    if (!name) return;
    const key = name.toLowerCase();
    const c = counts.get(key) ?? { name, n: 0, first: i };
    c.n++;
    counts.set(key, c);
  });
  const names = [...counts.values()].sort((a, b) => b.n - a.n || a.first - b.first).map((c) => c.name);
  if (!names.length) return "My Spice";
  const [a, b, c] = names;
  const tries =
    names.length === 1 ? [a] : names.length === 2 ? [`${a} & ${b}`, `${a} & more`] : names.length === 3 ? [`${a}, ${b} & ${c}`, `${a}, ${b} & more`, `${a} & more`] : [`${a}, ${b} & more`, `${a} & more`];
  return tries.find((t) => t.length <= MAX) ?? a.slice(0, MAX);
}
