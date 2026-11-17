# Building a Harmoni app

Apps (an Android app, a desktop player, a script) can use a Harmoni server the way the web app does: search, play, browse, likes, playlists, Spices, history, Harmoni Link, all of it. The one thing apps never get is server settings. Account security stays on the web too: passwords, sessions, and which apps are connected.

People sign in to apps with **OAuth 2.0**, the same "Sign in with…" flow they know from elsewhere. The app opens Harmoni in a browser tab, the person signs in there and taps **Allow**, and the app gets a token. The app never sees their password.

- **This page** covers finding a server, signing in, tokens, and what apps can and can't do.
- **[The API reference](reference.md)** covers every endpoint: requests, responses, the audio stream, search streaming and the Harmoni Link protocol.

## Contents

- [The short version](#the-short-version)
- [Finding a server](#finding-a-server)
- [Signing in](#signing-in)
  - [1. Register the app](#1-register-the-app)
  - [2. Send the person to Harmoni](#2-send-the-person-to-harmoni)
  - [3. Handle the redirect](#3-handle-the-redirect)
  - [4. Swap the code for tokens](#4-swap-the-code-for-tokens)
- [Using tokens](#using-tokens)
- [Refreshing](#refreshing)
- [Signing out](#signing-out)
- [What apps can't do](#what-apps-cant-do)
- [Errors](#errors)
- [Android, step by step](#android-step-by-step)
- [Trying it with curl](#trying-it-with-curl)
- [Notes for people running a server](#notes-for-people-running-a-server)

---

## The short version

Every Harmoni is its own server, so an app can't come with a client ID baked in. It registers itself the first time it meets a server instead.

```mermaid
sequenceDiagram
    participant App
    participant H as Harmoni
    actor P as Person
    App->>H: GET /.well-known/oauth-authorization-server
    H-->>App: endpoints
    App->>H: POST /api/oauth/register (once per server)
    H-->>App: client_id
    App->>P: opens /oauth/authorize in a browser tab
    P->>H: signs in if needed, taps Allow
    H-->>App: redirect with code, state and iss
    App->>H: POST /api/oauth/token (code + PKCE verifier)
    H-->>App: access_token, refresh_token
    App->>H: GET /api/... with a Bearer token
```

| | |
|---|---|
| Flow | Authorization code with PKCE (RFC 6749, RFC 7636, RFC 8252 for native apps) |
| Client type | Public only: no client secret. PKCE (`S256`) is required. |
| Registration | Dynamic (RFC 7591), open to any app, once per server |
| Scope | `harmoni`: everything but server settings and account security. It's the only scope, and it's the default. |
| Access token | Opaque, starts `hat_`, lasts **1 hour** |
| Refresh token | Opaque, starts `hrt_`, lasts **90 days** from its last use, **replaced on every refresh** |
| Discovery | RFC 8414 at `/.well-known/oauth-authorization-server` |
| Revocation | RFC 7009 at `/api/oauth/revoke` |
| Mix-up protection | Every redirect carries `iss` (RFC 9207) |

Any standard OAuth library for native apps works. On Android that's [AppAuth](https://github.com/openid/AppAuth-Android); see [Android, step by step](#android-step-by-step).

---

## Finding a server

People type in their server's address: `music.example.com`, `https://music.example.com/`, `192.168.1.20:3000`. Tidy it up: add `https://` if there's no scheme, drop any trailing slash and path, and keep the port. Then fetch two public endpoints:

**`GET /.well-known/oauth-authorization-server`** says where everything is. If this returns 404, the server isn't Harmoni, or it's a version from before apps could sign in.

```json
{
  "issuer": "https://music.example.com",
  "authorization_endpoint": "https://music.example.com/oauth/authorize",
  "token_endpoint": "https://music.example.com/api/oauth/token",
  "registration_endpoint": "https://music.example.com/api/oauth/register",
  "revocation_endpoint": "https://music.example.com/api/oauth/revoke",
  "scopes_supported": ["harmoni"],
  "response_types_supported": ["code"],
  "response_modes_supported": ["query"],
  "grant_types_supported": ["authorization_code", "refresh_token"],
  "code_challenge_methods_supported": ["S256"],
  "authorization_response_iss_parameter_supported": true,
  "token_endpoint_auth_methods_supported": ["none"],
  "revocation_endpoint_auth_methods_supported": ["none"],
  "harmoni_api": "https://music.example.com/api"
}
```

Use the endpoint URLs as given rather than building them yourself. They're built from the address you reached the server by, so they always point back the same way. Keep `issuer`: it's how you tell servers apart (see [step 3](#3-handle-the-redirect)).

**[`GET /api/setup`](reference.md#get-apisetup)** gives the server's name and welcome line, and says whether it takes new accounts. Show these on your sign-in screen ("Sign in to Ejaz's Music").

> Use HTTPS. Over plain `http://`, anyone on the network can read the tokens. Plain http is only reasonable for a server on your own LAN.

---

## Signing in

### 1. Register the app

**`POST /api/oauth/register`** (public, JSON). Do it once per server and keep the `client_id` alongside that server's address.

```http
POST /api/oauth/register
Content-Type: application/json

{
  "client_name": "Harmoni for Android",
  "redirect_uris": ["com.example.harmoni:/oauth"],
  "client_uri": "https://example.com/harmoni-android"
}
```

| Field | | |
|---|---|---|
| `client_name` | required | What people see on the consent screen and in Settings. Up to 60 characters. |
| `redirect_uris` | required | One to five. See the rules below. |
| `client_uri` | optional | Your app's homepage, `https://` only. Its host is shown on the consent screen. |
| `logo_uri`, `software_id` | optional | Stored and echoed back. The logo isn't shown, since loading it would tell its host who's signing in. |
| `token_endpoint_auth_method` | optional | Must be `"none"` if you send it. |
| `grant_types`, `response_types`, `scope` | optional | If sent, they must fit `authorization_code`/`refresh_token`, `code` and `harmoni`. Fields Harmoni doesn't know (`application_type`, `subject_type`…) are ignored. |

**Response: `201`**

```json
{
  "client_id": "hcl_p14zbnVkwXcP5C-61qxwmQ",
  "client_id_issued_at": 1794789094,
  "client_name": "Harmoni for Android",
  "redirect_uris": ["com.example.harmoni:/oauth"],
  "token_endpoint_auth_method": "none",
  "grant_types": ["authorization_code", "refresh_token"],
  "response_types": ["code"],
  "scope": "harmoni",
  "client_uri": "https://example.com/harmoni-android"
}
```

There's no client secret. An installed app can't keep one, so PKCE does that job.

**Redirect URI rules** (from RFC 8252):

| Kind | Example | Matching |
|---|---|---|
| Your app's own scheme (best for mobile). Use reverse-DNS of a domain you control. | `com.example.harmoni:/oauth` | exact |
| An https link your app owns (Android App Links, iOS Universal Links) | `https://example.com/harmoni/oauth` | exact |
| Loopback, for desktop apps that listen on a local port | `http://127.0.0.1/callback`, `http://[::1]/callback` | exact, but **any port** is accepted at sign-in time |

These are refused: other `http://` hosts, fragments (`#`), and schemes that run code or go nowhere (`javascript:`, `data:`, `file:`, `intent:`…).

**Things to know:**
- **Registrations nobody signs in with are deleted after 24 hours.** Register when the person is about to sign in, not ahead of time. Once someone has signed in with a `client_id`, it stays for as long as any sign-in uses it.
- **If the server forgets you,** for example its database was reset or your registration was never used, `/oauth/authorize` says "This app isn't registered with this server" and the token endpoint answers `invalid_client` or `invalid_grant`. Register again and start over.
- **Rate limit:** 20 registrations per IP address per hour (`429 {"error":"slow_down"}`).

### 2. Send the person to Harmoni

Make a PKCE pair and a `state` for this attempt:

```
code_verifier  = 43–128 random characters from [A-Za-z0-9-._~]     (e.g. 32 random bytes, base64url)
code_challenge = base64url(sha256(code_verifier)), without padding
state          = a fresh random string
```

Then open `authorization_endpoint` **in the system browser or a Custom Tab**, not a WebView. The person's Harmoni sign-in lives there, and a WebView would let the app watch their password being typed.

```
https://music.example.com/oauth/authorize
  ?client_id=hcl_p14zbnVkwXcP5C-61qxwmQ
  &redirect_uri=com.example.harmoni%3A%2Foauth
  &response_type=code
  &code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM
  &code_challenge_method=S256
  &state=af0ifjsldkj
  &scope=harmoni
```

| Parameter | | |
|---|---|---|
| `client_id` | required | From registration |
| `redirect_uri` | required if you registered more than one | One of your registered URIs |
| `response_type` | required | `code` |
| `code_challenge`, `code_challenge_method` | required | `S256` only |
| `state` | strongly recommended | Comes back unchanged. Check it. |
| `scope` | optional | `harmoni` (the default). `offline_access` is accepted and ignored, since refresh tokens always come with it. Anything else is refused. |

What the person sees:
1. If they aren't signed in to Harmoni in that browser, the sign-in page. It links to sign-up too, so someone with an invite can make an account on the way. Either way they come back to step 2.
2. **The consent screen:** your app's name, the account it's asking for, what it can and can't do, and a warning that Harmoni can't check who made the app. Then **Allow** or **Not now**. They see this every time, even for an app they've allowed before.
3. Harmoni sends the browser to your redirect URI.

### 3. Handle the redirect

On **Allow**:

```
com.example.harmoni:/oauth?code=hac_yYjmK10Cr86m…&state=af0ifjsldkj&iss=https%3A%2F%2Fmusic.example.com
```

On **Not now**, or if your request was wrong (missing PKCE, unknown scope…):

```
com.example.harmoni:/oauth?error=access_denied&error_description=They+said+no.&state=af0ifjsldkj&iss=https%3A%2F%2Fmusic.example.com
```

Before using the code:
1. **Check `state`** matches the one you sent, and drop the redirect if it doesn't.
2. **Check `iss`** equals the `issuer` of the server you started with. An app that talks to several servers could otherwise be tricked into sending one server's code to another (a "mix-up" attack, RFC 9207).
3. On `error`, `access_denied` means they chose not to connect: go back quietly. Anything else is a bug in your request, and `error_description` says what.

If `client_id` or `redirect_uri` is wrong, Harmoni **won't** redirect, since it can't be sure where it would be sending them. The person sees the problem on Harmoni's page instead, and your app hears nothing. Give your sign-in screen a way to cancel.

The code works **once** and for **5 minutes**.

### 4. Swap the code for tokens

**`POST /api/oauth/token`**, form-encoded (JSON works too).

```http
POST /api/oauth/token
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code
&code=hac_yYjmK10Cr86m…
&client_id=hcl_p14zbnVkwXcP5C-61qxwmQ
&redirect_uri=com.example.harmoni%3A%2Foauth
&code_verifier=dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk
&device_name=Pixel%209
```

| Parameter | | |
|---|---|---|
| `grant_type` | required | `authorization_code` |
| `code` | required | From the redirect |
| `client_id` | required | In the body, or as the username of HTTP Basic auth with an empty password |
| `redirect_uri` | required if it was sent in step 2 | Exactly the same value |
| `code_verifier` | required | The PKCE verifier from step 2 |
| `device_name` | optional, Harmoni's own | Shown in Settings next to your app ("Harmoni for Android · Pixel 9"). Up to 60 characters. |

**Response: `200`**, with `Cache-Control: no-store`

```json
{
  "access_token": "hat_8461qwSDusKxQXmd2cad2gwKNOmsgUQlXQpCjchfS5w",
  "token_type": "Bearer",
  "expires_in": 3600,
  "refresh_token": "hrt_OPxiff6xjLijPQ7lTAnzgCJK4gvyLFAG_BW3-OeL-uo",
  "scope": "harmoni"
}
```

A failed attempt (a wrong verifier, for example) still uses up the code, so the person has to go through step 2 again.

Store both tokens somewhere encrypted. On Android, that's DataStore or files encrypted with a key from the Android Keystore. Keep them per server and per account.

---

## Using tokens

Send the access token on **every** request, including the ones that aren't JSON: audio (`/api/play/{id}`), artwork, and the Link event stream.

```http
GET /api/me
Authorization: Bearer hat_8461qwSDusKxQXmd2cad2gwKNOmsgUQlXQpCjchfS5w
```

[`GET /api/me`](reference.md#get-apime) is a good first call. It returns who's signed in, which server features are on, and an `app` field saying which app the server thinks you are.

A request with an `Authorization` header is judged by that header alone, never by cookies. A bad token gets `401` even if the same client has a session cookie.

When the token is missing, expired or revoked:

```http
HTTP/1.1 401 Unauthorized
WWW-Authenticate: Bearer error="invalid_token", error_description="The access token expired or was revoked."
Content-Type: application/json

{"error":"Sign in first."}
```

Refresh, then retry once.

---

## Refreshing

**`POST /api/oauth/token`** again:

```
grant_type=refresh_token
&refresh_token=hrt_OPxiff6xjLijPQ7lTAnzgCJK4gvyLFAG_BW3-OeL-uo
&client_id=hcl_p14zbnVkwXcP5C-61qxwmQ
```

The response looks like the one in step 4, with a **new access token and a new refresh token**. The old ones stop working straight away, and the new refresh token is good for another 90 days.

Get this right, or people get signed out at random:

- **Save the new refresh token before anything else.** If the app dies after refreshing but before saving, it's left with a refresh token that no longer works.
- **Refresh one at a time.** Ten requests all hitting `401` should cause one refresh, not ten: use a lock and let the others wait for its result.
- **Refresh a little early.** Do it when the access token has a minute or less left, rather than waiting for a `401`. AppAuth's `performActionWithFreshTokens` does this for you.
- **A refresh token is used once.** Sending one that's already been swapped:
  - within **60 seconds** of the swap (two refreshes racing, a retried request), gets `invalid_grant`, and your newer tokens keep working;
  - after that, is treated as a stolen copy: **the whole sign-in is ended** and every token from it stops working, so the person has to sign in again. This is deliberate. Whoever has the copy loses access too.
- **`invalid_grant` on refresh means signed out.** The token expired, the person disconnected the app or was suspended, or an admin signed them out. Send them back to sign in.

---

## Signing out

**`POST /api/oauth/revoke`**, form-encoded:

```
token=hrt_OPxiff6xjLijPQ7lTAnzgCJK4gvyLFAG_BW3-OeL-uo
&client_id=hcl_p14zbnVkwXcP5C-61qxwmQ
```

Either token works, and either one ends the whole sign-in. The answer is always `200 {}`, even for a token that was already dead, so you can just fire it off and forget your tokens.

Apps also get signed out when:
- the person taps **Disconnect** under **Settings › Connected apps** on the web,
- an admin suspends them, resets their password or signs them out everywhere,
- the refresh token goes unused for 90 days.

Changing your own password on the web doesn't sign apps out. Disconnect them in Settings if you need to.

---

## What apps can't do

Everything in [the API reference](reference.md) works with an access token. These don't:

| | With an access token |
|---|---|
| `/api/admin/*` (server settings, people, stats, the audio cache) | `403 {"error":"Server settings are only on the web."}`, even for an admin's account |
| `/api/me/apps` (Connected apps) | `403 {"error":"That's only on the web."}` |
| `/api/auth/*` (password, sessions, the web's own sign-in) | Doesn't accept access tokens at all |

Invites follow the same rules as on the web: whether someone can create them depends on server settings (see [Invites](reference.md#invites)).

---

## Errors

OAuth endpoints answer the standard way (RFC 6749 §5.2), with `Cache-Control: no-store`:

```json
{ "error": "invalid_grant", "error_description": "That code isn't valid any more. Start signing in again." }
```

| `error` | Status | From | Meaning |
|---|---|---|---|
| `invalid_request` | 400 | token | A required parameter is missing |
| `invalid_client` | 401 | token | No `client_id` |
| `invalid_grant` | 400 | token | Wrong, expired or used code; verifier doesn't match; `redirect_uri` differs; the refresh token is dead; the account is suspended |
| `unsupported_grant_type` | 400 | token | Only `authorization_code` and `refresh_token` |
| `invalid_redirect_uri` | 400 | register | A redirect URI breaks the rules (the description says which) |
| `invalid_client_metadata` | 400 | register | Missing `client_name`, a confidential client asked for, an https field that isn't https… |
| `slow_down` | 429 | register | Rate limit |
| `server_error` | 500 | any | Something broke on the server |
| `access_denied` | redirect | authorize | They tapped **Not now** |
| `invalid_request`, `unsupported_response_type`, `invalid_scope` | redirect | authorize | Your authorization request was wrong |

Everything else in the API uses `{ "error": "message" }`, written for people, so you can show it as it is.

---

## Android, step by step

This uses [AppAuth-Android](https://github.com/openid/AppAuth-Android) (`net.openid:appauth`) for the browser tab, PKCE, `state` and refreshing, and OkHttp for the API. The snippets show the shape of things rather than a finished app.

### Redirect scheme

```kotlin
// app/build.gradle.kts
android {
    defaultConfig {
        // AppAuth's redirect activity catches com.example.harmoni:/oauth
        manifestPlaceholders["appAuthRedirectScheme"] = "com.example.harmoni"
    }
}
```

### Configuration from discovery

Build the configuration from Harmoni's metadata yourself. **Don't use `AuthorizationServiceConfiguration.fetchFromIssuer`**: it looks for OpenID Connect discovery (`/.well-known/openid-configuration`), and Harmoni is plain OAuth, not OpenID Connect.

```kotlin
val REDIRECT = Uri.parse("com.example.harmoni:/oauth")

data class HarmoniServer(val issuer: String, val config: AuthorizationServiceConfiguration, val revocationEndpoint: String)

suspend fun discover(address: String, http: OkHttpClient): HarmoniServer = withContext(Dispatchers.IO) {
    val base = normalise(address) // "https://music.example.com"
    val json = http.newCall(Request.Builder().url("$base/.well-known/oauth-authorization-server").build())
        .execute().use { res ->
            if (!res.isSuccessful) throw NotHarmoni()
            JSONObject(res.body!!.string())
        }
    HarmoniServer(
        issuer = json.getString("issuer"),
        config = AuthorizationServiceConfiguration(
            Uri.parse(json.getString("authorization_endpoint")),
            Uri.parse(json.getString("token_endpoint")),
            Uri.parse(json.getString("registration_endpoint")),
        ),
        revocationEndpoint = json.getString("revocation_endpoint"),
    )
}
```

### Registering

```kotlin
suspend fun register(service: AuthorizationService, server: HarmoniServer): String =
    suspendCancellableCoroutine { cont ->
        val request = RegistrationRequest.Builder(server.config, listOf(REDIRECT))
            .setTokenEndpointAuthenticationMethod("none")
            .setAdditionalParameters(mapOf("client_name" to "Harmoni for Android"))
            .build()
        service.performRegistrationRequest(request) { response, ex ->
            if (response != null) cont.resume(response.clientId) // keep it with the server's address
            else cont.resumeWithException(ex!!)
        }
    }
```

### Signing in

```kotlin
// In an Activity or Fragment
private val signIn = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
    val data = result.data ?: return@registerForActivityResult // they closed the tab
    val response = AuthorizationResponse.fromIntent(data)
    val error = AuthorizationException.fromIntent(data)
    when {
        error != null -> showSignInError(error) // includes access_denied: they tapped Not now
        // AppAuth has already checked state. Check iss yourself (it arrives as an extra parameter).
        response!!.additionalParameters["iss"] != server.issuer -> showSignInError(null)
        else -> exchange(response)
    }
}

fun startSignIn(clientId: String) {
    // AppAuth generates the PKCE verifier (S256) and state itself.
    val request = AuthorizationRequest.Builder(server.config, clientId, ResponseTypeValues.CODE, REDIRECT)
        .setScope("harmoni")
        .build()
    signIn.launch(authService.getAuthorizationRequestIntent(request))
}

fun exchange(response: AuthorizationResponse) {
    val authState = AuthState(response, null)
    val request = response.createTokenExchangeRequest(mapOf("device_name" to Build.MODEL))
    authService.performTokenRequest(request) { tokens, ex ->
        authState.update(tokens, ex)
        if (tokens != null) store.save(server, authState) // AuthState.jsonSerializeString(), encrypted
        else showSignInError(ex)
    }
}
```

### Fresh tokens on every request

```kotlin
class HarmoniAuth(private val store: TokenStore, private val service: AuthorizationService) {
    private val lock = Mutex()

    // One refresh at a time. Every caller waits for it.
    suspend fun accessToken(): String = lock.withLock {
        val state = store.load()
        suspendCancellableCoroutine { cont ->
            state.performActionWithFreshTokens(service) { token, _, ex ->
                store.save(state) // a refresh replaces the refresh token: save every time
                when {
                    token != null -> cont.resume(token)
                    ex?.code == AuthorizationException.TokenRequestErrors.INVALID_GRANT.code ->
                        cont.resumeWithException(SignedOut()) // send them back to sign in
                    else -> cont.resumeWithException(ex ?: IOException("No token"))
                }
            }
        }
    }

    suspend fun invalidate() = lock.withLock { store.update { it.needsTokenRefresh = true } }
}

// Adds the token to everything, and refreshes and retries once on 401.
class BearerInterceptor(private val auth: HarmoniAuth) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val first = chain.proceed(chain.request().withToken(runBlocking { auth.accessToken() }))
        if (first.code != 401) return first
        first.close()
        runBlocking { auth.invalidate() }
        return chain.proceed(chain.request().withToken(runBlocking { auth.accessToken() }))
    }

    private fun Request.withToken(token: String) = newBuilder().header("Authorization", "Bearer $token").build()
}
```

Use the same client (or its interceptor) for:
- **Audio:** ExoPlayer's `OkHttpDataSource.Factory(client)`. See [`GET /api/play/{id}`](reference.md#get-apiplayid) for Range requests and timeouts.
- **Artwork:** Coil's `ImageLoader.Builder(context).okHttpClient(client)`.
- **The Link event stream:** `EventSources.createFactory(client)`, but on a client with `readTimeout(0)`. See [Keeping the stream healthy](reference.md#keeping-the-stream-healthy).

### Signing out

```kotlin
suspend fun signOut(server: HarmoniServer, clientId: String, refreshToken: String) {
    runCatching { // whatever happens, forget the tokens
        http.newCall(
            Request.Builder().url(server.revocationEndpoint)
                .post(FormBody.Builder().add("token", refreshToken).add("client_id", clientId).build())
                .build(),
        ).execute().close()
    }
    store.clear(server)
}
```

---

## Trying it with curl

Everything an app does, by hand. You need a browser for the Allow step.

```sh
B=https://music.example.com

# Register
CID=$(curl -s -X POST $B/api/oauth/register -H 'Content-Type: application/json' \
  -d '{"client_name":"curl","redirect_uris":["http://127.0.0.1/cb"]}' | jq -r .client_id)

# PKCE
VERIFIER=$(openssl rand -base64 48 | tr -d '=+/\n' | cut -c1-64)
CHALLENGE=$(printf %s "$VERIFIER" | openssl dgst -sha256 -binary | openssl base64 | tr '+/' '-_' | tr -d '=\n')

# Open this, sign in, tap Allow
echo "$B/oauth/authorize?client_id=$CID&redirect_uri=http://127.0.0.1/cb&response_type=code&code_challenge=$CHALLENGE&code_challenge_method=S256&state=test"

# The browser lands on http://127.0.0.1/cb?code=…&state=test&iss=… (the page won't load, that's fine).
# Copy the code from the address bar:
CODE=hac_…

curl -s -X POST $B/api/oauth/token \
  --data-urlencode grant_type=authorization_code --data-urlencode "code=$CODE" \
  --data-urlencode "client_id=$CID" --data-urlencode redirect_uri=http://127.0.0.1/cb \
  --data-urlencode "code_verifier=$VERIFIER" | tee tokens.json

AT=$(jq -r .access_token tokens.json)
curl -s $B/api/me -H "Authorization: Bearer $AT"
curl -sN "$B/api/link?device=curl-test-device&name=curl&kind=computer" -H "Authorization: Bearer $AT"
```

---

## Notes for people running a server

- **Anyone can register an app.** Registering grants nothing by itself. An app only gets into an account when that account's owner taps **Allow**, and the consent screen warns that names can't be checked. Unused registrations are deleted after a day, and registering is rate limited.
- **Each person sees and disconnects their own apps** under **Settings › Connected apps**. Suspending someone, resetting their password or signing them out everywhere (Server settings › People) also signs out their apps.
- **Tokens are stored hashed** (SHA-256). A copy of the database doesn't hand anyone working tokens.
- **These docs are on your server** at `/developers`, readable without an account, with your server's address in the examples. Discovery points there too (`service_documentation`).
- **The tables** are `OAuthClient`, `OAuthCode` and `OAuthGrant`. The code is in `src/server/oauth/`.
