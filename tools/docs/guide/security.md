---
title: Security and privacy
description: What is encrypted, what the hub and relay can see, and how devices are revoked.
sidebar_position: 11
---

# Security and privacy

Clara keeps the harness password on the adapter machine and encrypts the
WebSocket payloads between each browser or adapter and the hub. This page
explains the boundary in plain language.

## The short version

- The browser never receives the harness password.
- The adapter adds harness authentication and is the only process that talks to
  the harness. The hub carries typed API requests to the harness that owns each
  session or workspace.
- Prompts, replies, tool output, and file content travel inside an encrypted
  WebSocket.
- Cloudflare and the relay see encrypted frames, frame sizes, timing, room
  metadata, and connection metadata. They do not see your conversation.
- Each paired device has its own key and can be revoked on its own.

## Where the keys live

When you pair a device, the browser generates a 256-bit key and stores it as a
non-extractable `CryptoKey` in IndexedDB. The raw key bytes are not written to
`localStorage`. The hub stores each device key encrypted at rest.

A pairing link carries a one-time enrollment token, not a long-lived key. The
token is valid for 10 minutes and enrolls one device. A second device cannot
reuse it.

The device fingerprint is a truncated hash of the key. The host can compare the
fingerprint in the hub panel with the terminal output after enrollment.

## What each party can see

| Party              | Can see                                                          | Cannot see                                         |
| ------------------ | ---------------------------------------------------------------- | -------------------------------------------------- |
| Browser            | Your session, prompts, replies, and device key                   | The harness password                               |
| Adapter            | Harness URL and password, session traffic, adapter credential    | Other devices' keys                                |
| Hub service        | Session traffic, device records, encrypted adapter credential    | The harness password                               |
| Hub panel          | Status, device list, and configuration (sensitive values masked) | Decrypted messages in the panel                    |
| Relay / Cloudflare | Ciphertext, frame sizes, timing, room id, connection metadata    | Request bodies, prompts, replies, harness password |
| Push service       | A notification payload supplied by the hub                       | Your session history                               |

The hub is a trust boundary: whoever runs it can read traffic in transit because
it routes requests between the browser and the adapter. The adapter host is the
other boundary: it holds the harness credentials and talks to the harness. Pair
only with a hub and adapter you trust.

## Local and remote connections

A local pairing connects directly over `ws://` and never leaves the trusted
network. A relay pairing goes through Cloudflare and is still end-to-end
encrypted between the browser and the hub.

A page loaded over HTTPS cannot open a `ws://` socket. That is why remote
devices use the relay.

## Device revocation

The host can revoke one device or every device from the hub panel or the pairing
command. A revoked device is rejected on its next handshake or action. Deleting
the record permanently removes it; later connections are rejected as an unknown
device.

If you lose a device, ask the host to revoke it. Disconnecting in Clara only
forgets the device locally; it does not revoke the key on the hub.

## Limits worth knowing

- Handshake v4 uses fresh P-256 ephemeral keys per session, so recorded traffic
  cannot be decrypted later with the static device key alone.
- The relay accepts a signed grant per device or adapter, not a shared client
  token. A grant gates relay socket access but is not the encryption key. An
  attacker with a grant and no device or adapter key can open sockets and cause
  noise until it expires, not read traffic. Grants last thirty days and refresh
  on each connect.
- Push delivery depends on the browser push service. A notification preview may
  show on a locked screen depending on your operating system settings.
- The hub panel is loopback-only. Do not expose it to the internet.

## Practical advice

- Use HTTPS for any remote Clara deployment.
- Revoke devices you no longer use.
- Keep the hub machine and Clara updated.
- Do not share pairing codes; they are single-use and short-lived for a reason.
- Treat the hub host as trusted infrastructure.

## Related

- [Connect a device](connect.md)
- [Self-hosting overview](self-hosting/index.md)
- [Relay setup](self-hosting/relay.md)
