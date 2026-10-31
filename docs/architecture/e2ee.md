# End-to-end encryption

Clara encrypts every WebSocket payload between the browser transport and the
home agent. Cloudflare, the relay Worker, and the Durable Object see ciphertext,
frame sizes, timing, room ids, and connection metadata. They never see OpenCode
requests, responses, prompts, or the OpenCode password.

## Key model

- One 256-bit pre-shared key (PSK) per home agent.
- The agent generates the PSK on first run and stores it at
  `~/.config/clara/server.json` with mode `0600`.
- The PSK is delivered to a device through the pairing QR/link fragment. It is
  never sent to Pages or Cloudflare as part of an HTTP request.
- The web stores the PSK and relay token in `localStorage`. "Disconnect" clears
  the stored connection.
- The pairing fingerprint is a truncated SHA-256 of the PSK. It is displayed by
  the agent and by the web so a person can compare them.

## Handshake

```text
client ── hello { sid, nonceC } ──▶ agent
agent  ── hello { sid, nonceS } ──▶ broadcast
agent  ── sealed ready { agentInfo } ──▶ broadcast
client ── sealed ready.ack ──▶ agent
```

- `sid` is a random 128-bit session id generated per connection.
- `nonceC` and `nonceS` are random 128-bit values.
- Keys are derived with HKDF-SHA-256 from the PSK, a salt over
  `sid | nonceC | nonceS`, and directional info strings `clara/v1/c2s` and
  `clara/v1/s2c`.
- The client verifies the derived fingerprint before accepting `ready`.
- A fresh client nonce per connection prevents replaying an old handshake.
- A replayed or out-of-order frame is rejected by a strict sequence guard before
  decryption.

## Envelope

Every sealed frame is JSON with a small plaintext header so clients can filter
broadcast frames:

```json
{ "t": "sealed", "v": 1, "sid": "…", "seq": 0, "iv": "…", "ct": "…" }
```

- AES-256-GCM with a random 12-byte nonce per frame.
- AAD binds `v`, `sid`, direction, and sequence number.
- `ct` and `iv` are base64url.
- Payload chunks are capped at 32 KiB before encryption, keeping frames under
  the Workers WebSocket message limit.

## Actions and states

`packages/shared-types` defines the payload unions:

- Actions (browser → agent): `http.request`, `http.abort`, `ping`, `pong`,
  `ready`, `ready.ack`.
- States (agent → browser): `http.response`, `http.chunk`, `http.end`,
  `http.error`, `agent.status`.

The agent refuses paths outside `/api/`, strips hop-by-hop headers, adds OpenCode
basic auth, and prevents origin changes. The browser never receives the OpenCode
password in relay mode.

## Threat model

| Threat                              | Mitigation                                                    |
| ----------------------------------- | ------------------------------------------------------------- |
| Cloudflare reads traffic            | AES-GCM payloads; no plaintext request data                   |
| Relay token leak                    | Attacker can open sockets but cannot decrypt without the PSK  |
| Captured frame replayed             | Per-session monotonic sequence + fresh handshake nonces       |
| Tampered ciphertext                 | GCM authentication tag and AAD                                |
| Stolen browser profile              | PSK is in `localStorage`; use Disconnect/rotate and re-pair   |
| XSS in the Pages origin             | CSP, no third-party scripts; PSK is still reachable from JS   |
| Malicious client impersonates agent | Separate agent/client tokens; E2EE handshake would still fail |

## Rotation

```bash
node apps/server/dist/index.js pair --rotate
```

This generates a new PSK and prints a new pairing code. Existing devices fail
the fingerprint check and must re-pair. Rotating the relay client token requires
updating the Worker secret, the server environment, and re-pairing devices.

## Limitations

- No forward secrecy in v1; the long-term PSK protects all sessions.
- One shared client token for all paired devices.
- Metadata (room, connection timing, frame sizes) is visible to Cloudflare.
- The relay does not buffer messages for offline devices.

## Related

- [Relay](relay.md)
- [Pairing](../features/pairing.md)
- [Connection](../features/connection.md)
