# Relay preview URL verification

## Summary

This runbook confirms that a panel deploy really disables Cloudflare preview and
version URLs on a live relay Worker. The deploy sends `previews_enabled: false`
on the Worker subdomain settings endpoint on every deploy, but that field has
only been exercised against a mocked Cloudflare API. Use this procedure once
against a real Cloudflare account, especially one whose Worker uses a Durable
Object, and record the result in the verification log below.

Cloudflare now calls these **Version URLs**; the Clara toggle and the API field
still say preview. They are the same setting.

## When to use

- After a panel deploy, when you need evidence that no version hostname is
  exposed.
- After changing `apps/hub/server/src/features/cloudflare-deployment/`, or after
  upgrading the deploy code.
- Before documenting the preview setting as confirmed rather than
  unit-tested.
- Not for routine deploys. This procedure creates a throwaway Worker and points
  the hub at it.

## Preconditions

- A Cloudflare account with Workers enabled and a `workers.dev` subdomain.
- An API token with **Workers Scripts: Edit**. **Account Settings: Read** lets
  the panel list accounts; without it, enter the 32-character account ID
  manually.
- A Clara build compiled with `ENABLE_CLOUDFLARE_DEPLOYMENT=true`, with the hub
  panel open.
- A Worker name you may delete, for example `clara-relay-preview-check`. A panel
  deploy writes the Worker URL, room, and tokens into the hub configuration and
  points the hub at the new relay, so use a disposable hub or plan to redeploy
  the production relay during rollback.
- `curl`, and `jq` if you want to inspect the deploy record.

## Procedure

### 1. Deploy with the toggle off

1. Open **Connections → Relay → Deploy relay to Cloudflare**.
2. Enter the token, choose the account, and set the throwaway Worker name.
3. Expand **Advanced** and leave **Enable preview and version URLs for this
   Worker** unchecked.
4. Deploy and note the hostname, the timestamp, and whether the panel shows a
   warning.

The request carries `previewUrls: false`, so the hub posts
`{ "enabled": true, "previews_enabled": false }` to
`/accounts/<account>/workers/scripts/<script>/subdomain` with the
`Cloudflare-Workers-Script-Api-Date: 2025-08-01` header.

### 2. Inspect the deploy record and panel status

- The deploy record at `~/.config/clara/relay-deployment.json` should contain
  `"previewUrls": false` and `"reachable": true`.
- The deploy response's `deployment.previewUrls` should be `false`, and
  `warning` should be absent.
- The panel has no separate preview row. A rejected preview setting appears as
  the warning described under [Known failure mode](#known-failure-mode); the
  hub log gains a `cloudflare relay preview URL setting failed` line.

### 3. List version and preview hostnames

1. In the Cloudflare dashboard, open **Workers & Pages → `<Worker>` → Settings →
   Domains & Routes** and find **Version URLs**. Expect it to be disabled.
2. Open **Deployments** and select a non-production version. When version URLs
   are enabled, Cloudflare shows a URL in the form
   `<version-prefix>-<worker>.<subdomain>.workers.dev`; an alias uses
   `<alias>-<worker>.<subdomain>.workers.dev`.
3. Record exactly what the dashboard reports, including "no version URL
   listed".

### 4. Confirm the production host answers

```bash
curl -fsS https://<script>.<subdomain>.workers.dev/health
```

Expect `{"ok":true,"protocol":2}`; the exact protocol number is not the gate,
`ok: true` is. A 404 or connection failure here is a real deployment failure,
not the expected disabled-preview state.

### 5. Attempt a version hostname

If step 3 showed a version URL, fetch it:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' \
  https://<version-prefix>-<worker>.<subdomain>.workers.dev/health
```

The expected disabled state is HTTP 404, a connection failure, or a DNS
failure. Record the exact result.

If the dashboard showed no version URL, there is nothing to fetch; record that.
Do not use a guessed prefix and treat a 404 as proof. `workers.dev` answers
wildcard DNS, so a successful `dig` is not evidence that a version URL is
enabled. Test HTTP, and rely on the dashboard listing as the primary evidence.

### 6. Exercise the opt-in and idempotence

1. Redeploy with **Advanced → Enable preview and version URLs for this Worker**
   checked. The hub now posts `previews_enabled: true`.
2. Look for a version URL in **Deployments** and fetch it if one appears.
   Cloudflare documents that version URLs are not generated for Workers that
   implement a Durable Object, so no hostname here is an expected outcome, not
   necessarily a deploy failure. Record which happened.
3. Redeploy with the toggle off. The hub posts `previews_enabled: false` again,
   and any version URL should disappear or stay absent. This proves the
   every-deploy reset.
4. If a version URL from step 2 persists after the disabled redeploy, record
   the dashboard state, the API responses, and stop. Do not add upload
   metadata to "fix" it.

## Expected results

| Toggle | Request body                                     | workers.dev | Version URL                              | Panel warning |
| ------ | ------------------------------------------------ | ----------- | ---------------------------------------- | ------------- |
| Off    | `{ "enabled": true, "previews_enabled": false }` | Enabled     | None, and `/health` answers              | None          |
| On     | `{ "enabled": true, "previews_enabled": true }`  | Enabled     | May appear; never for a DO-backed Worker | None          |
| Off    | `{ "enabled": true, "previews_enabled": false }` | Enabled     | Cleared or absent                        | None          |

## Known failure mode

If Cloudflare rejects `previews_enabled` for a Durable-Object-backed Worker:

- The first subdomain call throws. The deploy retries with the legacy body
  `{ "enabled": true }`.
- If the retry succeeds, the deployment continues, `previewUrls` is `false`,
  and `previewUrlsError` carries the rejection. The panel warning reads:

  ```text
  The Worker deployed, but preview URLs could not be configured, so the Worker stays on the default: <message>
  ```

- The `workers.dev` hostname is still enabled and the health check still runs.
- If the retry also fails, the deployment fails before its health check. The
  panel shows the legacy Cloudflare error instead of a warning.
- Record the exact `errors[0].message`, its `code`, and its `documentation_url`
  from the Cloudflare response.
- Stop there. Do not add `preview_urls` to upload metadata: Cloudflare has no
  preview field on upload, and the subdomain endpoint is the supported switch.
  An upload-metadata change would be untested and would not alter the setting.
- Distinguish a rejection from a Worker that accepts the field but still gets
  no version URL. Cloudflare documents that Durable Object Workers do not
  receive version URLs, and that is a limitation, not a deploy bug.

## Rollback

1. Delete the test Worker in **Workers & Pages → `<Worker>` → Settings → Delete**,
   or run `pnpm exec wrangler delete --name <worker>` from `infra/relay`.
2. Alternatively, redeploy with the toggle off. This leaves the Worker in place
   and clears preview URLs.
3. If the test deploy replaced the panel-managed relay, redeploy the production
   Worker from the panel, or restore the previous relay URL, room, and tokens in
   `server.json` and `relay-credentials.json`. Confirm the panel's Relay card is
   connected before leaving.

## Verification log

Record one row per verification run. Keep the exact API response text; the
point of this log is to replace the offline-only evidence.

| Date      | Account type | Worker | Previews disabled? | Toggle-on result | API response | Cloudflare doc | Notes                             |
| --------- | ------------ | ------ | ------------------ | ---------------- | ------------ | -------------- | --------------------------------- |
| _Pending_ | —            | —      | Not yet run        | —                | —            | —              | Field is unit-tested offline only |

## Out of scope

- Custom-domain relay routes; the panel deploy always keeps `workers.dev` on.
- WAF, rate-limit, or Access policy design for version hostnames.
- Deleting or rotating a production relay as part of the check.
- Changing the deploy code. This runbook records behavior; it does not repair
  it.

## Related

- [Relay](../architecture/relay.md)
- [Hub panel](panel.md)
- Cloudflare [Version URLs](https://developers.cloudflare.com/workers/versions-and-deployments/version-urls/)
- Cloudflare [Update Worker Script Subdomain](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/subdomain/methods/create/)
