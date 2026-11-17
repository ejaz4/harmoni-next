import { publicOrigin } from "@/server/oauth/http";

// RFC 8414: where an app finds everything it needs to sign in, given only
// the server's address. Public.
export async function GET(request: Request) {
  const origin = publicOrigin(request);
  return Response.json(
    {
      issuer: origin,
      authorization_endpoint: `${origin}/oauth/authorize`,
      token_endpoint: `${origin}/api/oauth/token`,
      registration_endpoint: `${origin}/api/oauth/register`,
      revocation_endpoint: `${origin}/api/oauth/revoke`,
      scopes_supported: ["harmoni"],
      response_types_supported: ["code"],
      response_modes_supported: ["query"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      authorization_response_iss_parameter_supported: true,
      token_endpoint_auth_methods_supported: ["none"],
      revocation_endpoint_auth_methods_supported: ["none"],
      // For people: the docs, on this server.
      service_documentation: `${origin}/developers`,
      // Harmoni's own: where the API is, for apps that only know the server's address.
      harmoni_api: `${origin}/api`,
    },
    { headers: { "Cache-Control": "public, max-age=3600", "Access-Control-Allow-Origin": "*" } },
  );
}
