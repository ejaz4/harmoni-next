import { exchangeCode, OAuthError, refresh } from "@/server/oauth";
import { oauthFailure, oauthJson, readForm } from "@/server/oauth/http";

// RFC 6749 §3.2: swaps the code from the consent screen for tokens, and a
// refresh token for new ones (both tokens are replaced every time).
export async function POST(request: Request) {
  const form = await readForm(request);
  try {
    if (!form.client_id) throw new OAuthError("invalid_client", "client_id is required.", 401);
    if (form.grant_type === "authorization_code") {
      return oauthJson(
        await exchangeCode({ code: form.code ?? "", clientId: form.client_id, redirectUri: form.redirect_uri ?? "", verifier: form.code_verifier ?? "", device: form.device_name }),
      );
    }
    if (form.grant_type === "refresh_token") return oauthJson(await refresh({ refreshToken: form.refresh_token ?? "", clientId: form.client_id }));
    throw new OAuthError("unsupported_grant_type", "grant_type must be authorization_code or refresh_token.");
  } catch (err) {
    return oauthFailure(err);
  }
}
