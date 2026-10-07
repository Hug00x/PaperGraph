# Anara connection

Settings → Anara connects a personal Anara account in the desktop app. Authentication uses the system browser. Web-only mode explains that desktop is required. There are no password/API-key fields or generic chat UI. The connection now powers [contextual Deep Research](deep-research.md); that document supersedes the original discovery-only scope described below.

## Provider verification — 2026-10-03 (Europe/Lisbon)

The [official guide](https://docs.anara.com/guides/mcp) confirms remote Streamable HTTP at `https://anara.com/api/mcp`, browser OAuth, no manually supplied client ID/secret, and default read access with optional write consent.

Live unauthenticated discovery returned:

- MCP GET: 401 advertising `https://anara.com/.well-known/oauth-protected-resource/api/mcp`.
- Resource metadata: issuer `https://anara.com/api/better-auth`; scopes `anara:read`, `anara:chat`, `anara:write`.
- [Authorization metadata](https://anara.com/.well-known/oauth-authorization-server): dynamic registration, authorization code, S256 PKCE, public-client token authentication (`none`), refresh tokens, and `authorization_response_iss_parameter_supported: true`.
- Revocation at `/api/better-auth/oauth2/revoke` advertises only `client_secret_basic` and `client_secret_post`. Public-client revocation is **not guaranteed**. PaperGraph attempts RFC 7009 public-client revocation of both tokens after local deletion; failure shows a fixed warning. A 200 response is protocol success, not proof of immediate invalidation of every access token. No undocumented grant-deletion endpoint is assumed.

Settings requests `anara:read offline_access`. Explicit authorization from Deep Research adds `anara:chat`; `anara:write` is never requested. Unexpected granted scopes are rejected. Dynamic registration obtains a client ID; no shared credential is configured. Profile/email scopes are not requested.

The guide does not specify refresh lifetimes/rotation, detailed revocation semantics or native-loopback registration restrictions. Returned `expires_in` and the SDK refresh flow control expiry and rotation. Real-account consent, loopback acceptance and refresh/revocation remain manual acceptance checks.

## Architecture and callback decision

Inspection found Electron main owning a loopback Next.js child and sandboxed/context-isolated renderer, fixed IPC with main-frame/window/origin validation, independent Supabase sign-in, and `papergraph://` handlers that only focus the window. There was no MCP client or secure external-token store. Existing academic providers and Ollama do not implement external account OAuth and are unchanged.

`electron/anara-connection.cjs` uses the official `@modelcontextprotocol/client` 2.3.0 (stable v2, Node >=20), per the [SDK repository](https://github.com/modelcontextprotocol/typescript-sdk) and [current authorization specification](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization). Main owns OAuth, tokens, transport, refresh and discovery. Only `{ status, error }` crosses the fixed preload getState/connect/disconnect/subscribe API. No URLs, paths, tokens or tool arguments cross IPC. Next.js receives no Anara credentials or new authentication routes. Supabase auth is unchanged.

A temporary listener binds **127.0.0.1 on an OS-assigned port**, at `/anara/callback`, before browser opening. It is separate from Next.js. Native OAuth uses authorization code and PKCE; the existing focus-only deep link is not repurposed. Each interactive attempt registers a public client matching its exact redirect URI. Anara must accept this native callback; failure is reported rather than bypassing protocol protections.

Random state is timing-safe compared and single-use. Method, host, path and duplicate parameters are validated; invalid requests do not consume the attempt. SDK issuer validation precedes exchange, including authorization errors. Callback responses have no external resources, caching or scripts. Listeners close on completion/cancellation/timeout/shutdown. Authentication has a three-minute deadline; network requests have twenty-second deadlines. Focus returns after token exchange.

Remote destinations are restricted to HTTPS on `anara.com`, without embedded credentials; redirects are rejected. Cross-origin issuer changes require review. Tool definitions stay in main memory. Deep Research invokes only discovered start/status/result/cancel capabilities after explicit Research; see its separate contract and validation.

## Storage and lifecycle

Electron safeStorage encrypts `anara-credentials.bin` under `userData` (Windows DPAPI). Atomic sibling temporary writes use restrictive modes where supported. Unavailable encryption or Linux `basic_text` refuses connection; corruption produces a fixed error with Disconnect available. Tokens, registration and redirect URI persist. State, verifier and discovery remain in memory. Encryption protects data at rest, not a compromised OS account/main process.

Startup validates saved credentials silently. Refresh/revalidation runs before returned expiry or at most every five minutes. Background auth never opens a browser; invalid credentials become expired, while network/service failures show error. Cancellation/disconnection/shutdown invalidate pending operations to prevent late writes. Duplicate connects are suppressed; disconnects are serialized. Disconnect removes local credentials even offline. Shutdown closes the session while preserving credentials for restart.

The connection belongs to the desktop/OS profile and persists independently of Supabase sign-in/out. Switching PaperGraph accounts does not switch Anara accounts. Deep Research discloses that it uses the Anara account connected on this device; research remains personal and ephemeral. Workspace imports separately enforce existing Supabase identity/permissions.

## Verification

`npm run test:anara` uses the real SDK with fixture OAuth/MCP responses and a real loopback listener: public registration, least privilege, resource binding, PKCE, issuer rejection, initialization/discovery without calls, encrypted persistence/restoration, refresh, cancellation, callback validation and deletion despite failed revocation. Encryption fixtures use authenticated encryption rather than real Electron safeStorage. Run lint and production build as well.

Manual acceptance needs a real account: connect/consent/return, restart, cancel or decline consent, retry offline/expired access and disconnect. Validate Windows safeStorage and SDK inclusion in a new packaged build. No real account was authenticated, installer replaced or release published. Existing release gates remain open.
