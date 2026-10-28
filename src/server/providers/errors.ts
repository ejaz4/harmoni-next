// Typed errors let the server tell "this item is gone" from "this provider is down".
export type ProviderErrorKind =
  | "NotFound"
  | "RateLimited"
  | "Unavailable"
  | "AuthFailed"
  | "Timeout";

export class ProviderError extends Error {
  constructor(
    readonly kind: ProviderErrorKind,
    readonly provider: string,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(`[${provider}] ${kind}: ${message}`, options);
    this.name = "ProviderError";
  }
}

export function withDeadline<T>(
  promise: Promise<T>,
  ms: number,
  provider: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new ProviderError("Timeout", provider, `no response after ${ms}ms`)),
      ms,
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
