---
title: Orchestration endpoints
---

# Orchestration endpoints

## Summary

The hub owns the engine endpoint. On every authenticated adapter connection it
sends an adapter-only descriptor with direct candidates, its own health, and
whether it can proxy. The adapter probes candidates from its own machine. Local
and same-host installs normally use the engine directly; Docker, SSH, relay, and
hosted installs fall back to the sealed hub proxy. There is one relay room, and
the engine never needs its own room or public port.

## User flow

1. The panel installs the adapter and enables the adapter-machine runner.
2. The adapter authenticates and receives `AgentInfo.engine`.
3. The adapter probes the direct URLs from its own machine.
4. A reachable direct URL is written to `engine.json`; otherwise the adapter
   starts a loopback gateway to the sealed hub proxy and writes that instead.
5. The plugin, runner, and MCP bridge read `engine.json` and re-resolve on the
   next connection.

## Core business rules

1. The pairing code carries no engine URL and no engine token.
2. Proxy mode keeps the engine token on the hub. Direct mode delivers it over the
   sealed adapter session and writes `engine.token`.
3. The hub forwards only `/v1/` engine paths, attaches the bearer token, and
   streams the response back over the adapter's existing sealed session.
4. `engine.json` is the single resolved endpoint for every Clara component on the
   adapter machine. Environment variables remain the CI and development
   override.
5. A stale direct address costs one failed probe, not a broken install; the
   adapter falls back to the proxy and updates the file.

## Edge cases

- The engine is down: the hub reports `enabled: false` and the adapter disables
  the endpoint until the next authenticated update.
- The adapter cannot reach any direct address but the hub can: proxy mode starts.
- The hub cannot reach the engine either: the panel reports the engine error and
  no local gateway is advertised.
- The adapter daemon stops: the plugin and runner get a clear gateway error and
  recover when the service returns.

## Out of scope

- A second relay room for the engine.
- Putting the engine token in the adapter pairing code.
- An inbound engine port on a harness machine.

## Technical appendix

<details>
<summary>Files and frames</summary>

- `AgentInfo.engine` is adapter-only; browser sessions strip it.
- `engine.request`, `engine.abort`, `engine.response`, `engine.chunk`,
  `engine.end`, and `engine.error` share the adapter's sealed session.
- The adapter writes `engine.json` beside `engine.token` under the Clara data
  directory. Proxy mode adds a random local gateway token.

</details>
