import { revoke } from "@/server/oauth";
import { oauthJson, readForm } from "@/server/oauth/http";

// RFC 7009: an app signing out. Either token ends its whole sign-in, and
// the answer is the same whether or not the token was any good.
export async function POST(request: Request) {
  const form = await readForm(request);
  await revoke(form.token ?? "", form.client_id || undefined);
  return oauthJson({});
}
