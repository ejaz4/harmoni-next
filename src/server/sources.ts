// Source URIs are "<prefix>:<externalId>". IDs may contain colons,
// so only the first colon separates the prefix.

export interface SourceRef {
  provider: string;
  externalId: string;
}

export function parseSource(uri: string): SourceRef {
  const i = uri.indexOf(":");
  if (i <= 0 || i === uri.length - 1) {
    throw new Error(`Invalid source URI: ${uri}`);
  }
  return { provider: uri.slice(0, i), externalId: uri.slice(i + 1) };
}

export function formatSource(provider: string, externalId: string | number): string {
  return `${provider}:${externalId}`;
}
