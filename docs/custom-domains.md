# Agencies' own addresses

An agency with its brand switched on (Settings, Client portal & brand) can give its guests its own sign-in address, for example `portal.theiragency.com`. The agency adds one DNS record; sprint2go does the rest:

1. **Waiting for the record.** The agency types the address and sees the one record to add, and where (the DNS host is read from the domain's nameservers: Cloudflare, Hostinger, GoDaddy, Namecheap and others).
   - A subdomain gets a CNAME: `portal` pointing to `custom.sprint2go.com`.
   - The bare domain (`theiragency.com`) gets an A record to the server's IPv4, because most DNS hosts don't allow a CNAME there.
2. **Record found.** Public resolvers (1.1.1.1 and 8.8.8.8, not the server's cache) see the CNAME, or A records that are all ours. Common mistakes get a plain explanation: a different target, Cloudflare's proxy left on, a stray AAAA record (Let's Encrypt tries IPv6 first).
3. **Certificate being issued.** The server asks Dokploy to add the address to the sprint2go application with Let's Encrypt. This only happens with the branding add-on on (or Business, which includes it).
4. **Live.** `https://<address>/api/health` answers with a certificate the world trusts. From then on the address shows the agency's sign-in page and invite links for its guests use it. The agency's owners and admins get a notice.

The server checks again every hour until the address is live, and every hour after that. While a certificate is being issued it tries the address every 20 seconds for 10 minutes, then every 2 minutes for an hour. "Check now" in Settings checks at once.

When the agency changes or removes its address, the old one is taken out of Dokploy. The same happens for a company that's deleted. If the branding add-on is switched off, the address pauses: guests see a plain page until it's back on, and the certificate stays in place.

The state lives on the workspace (`whiteLabel.domainStatus`: `waiting`, `found`, `issuing`, `live`, and `whiteLabel.domainCheck`). Only the server changes it: a save from the app keeps what the server has, and the address itself is changed through `POST /api/white-label/domain`. One address belongs to one company.

## Turning it on

Without these settings the feature is honest about it: agencies can add the address and the record, and see "Ready once sprint2go turns on custom addresses" instead of a certificate.

1. **`custom.sprint2go.com` must exist in DNS:** an A record to the server's public IP (`178.212.35.85`), set to DNS only (grey cloud) in Cloudflare. Agencies point their CNAME at it, and the check compares against its A record.
2. **Create an API key in Dokploy.** Sign in to Dokploy as an owner or admin (the key can do what its user can), open **Settings, Profile**, and in the **API/CLI** section generate a key. Some versions ask for a name, an expiry and the organization: pick the organization that holds sprint2go and no expiry. Copy the key at once; Dokploy shows it only once. (Labels move between Dokploy versions; it is always under your profile's API settings.)
3. **Find the application id.** Open the sprint2go project, then the sprint2go application. The id is the last part of the address in the browser: `.../services/application/<applicationId>`.
4. **Set the environment** on the sprint2go application in Dokploy (Environment tab), then redeploy so the server reads it:

   ```
   DOKPLOY_URL=http://178.212.35.85:3000
   DOKPLOY_API_KEY=<the key from step 2>
   DOKPLOY_APP_ID=<the id from step 3>
   ```

   Optional:

   ```
   CUSTOM_DOMAIN_TARGET=custom.sprint2go.com   # what agencies point at (the default)
   CUSTOM_DOMAIN_IP=178.212.35.85              # for bare-domain A records; default: what the target resolves to
   APP_HOSTS=                                  # other addresses that open the app itself, comma-separated
   ```

`GET /api/caps` then says `"customDomains": true`.

### What the server sends to Dokploy

- `POST {DOKPLOY_URL}/api/domain.create`, header `x-api-key`, body `{ applicationId, host, port: 8787, https: true, certificateType: "letsencrypt", path: "/", domainType: "application" }`. The answer's `domainId` is kept in the `custom_domains` table.
- `POST {DOKPLOY_URL}/api/domain.delete` with `{ domainId }` when an address goes.
- `GET {DOKPLOY_URL}/api/domain.byApplicationId?applicationId=...` before creating, so an address Dokploy already has isn't added twice.

No redeploy is needed: for an application, Dokploy writes the Traefik route (with the Let's Encrypt resolver) as soon as the domain is created and removes it when the domain is deleted. Traefik gets the certificate over port 80, the same way `app.sprint2go.com` got its own.

### Addresses that aren't ours

With `PUBLIC_URL` set, a request to any address that isn't the app's own (`PUBLIC_URL`, `SITE_URL` and `www.`, `MAIL_HOST`, `localhost`, `APP_HOSTS`) and isn't a live agency address gets a plain page with no product name on it: "This address is almost ready" while the certificate is on its way, otherwise "This address isn't set up". `/api/health` answers on every address, because the certificate check uses it. If Dokploy's generated address (for example a `traefik.me` or `sslip.io` one) is used to reach the app, add it to `APP_HOSTS`.

### If an address stays at "Getting the certificate"

- Port 80 must reach Traefik for the Let's Encrypt challenge.
- The server checks `https://<address>/api/health` from inside its container. On some networks a container can't reach the host's own public IP (no hairpin NAT); then the certificate is there but the check never passes. Opening the address in a browser shows which it is.
- Traefik's logs in Dokploy (the Web Server settings) show why Let's Encrypt refused.

After an hour the agency sees "The certificate is taking longer than usual", and the hourly round keeps trying.

## Trying it locally

`scripts/custom-domains-mock.mjs` stands in for DNS, Dokploy and Traefik:

```
node scripts/custom-domains-mock.mjs data/mock-domains portal.agency.test
```

It starts DNS on 127.0.0.1:5399 (records in `data/mock-domains/zones.json`, re-read on every question), Dokploy on 127.0.0.1:3999 (key `test-key`, application `app-123`; `/mock/state` lists the domains, `/mock/fail?on=1` makes every call fail) and https on 127.0.0.1:8443 with a certificate for the address, signed by a local CA. Then run the server against it:

```
S2G_DATA=<scratch dir> PORT=8818 MAIL_PORT=2618 MAIL_HOST=localhost PUBLIC_URL=http://localhost:8818 \
S2G_DNS_SERVERS=127.0.0.1:5399 CUSTOM_DOMAIN_PROBE_ADDR=127.0.0.1:8443 \
NODE_EXTRA_CA_CERTS=data/mock-domains/ca.pem \
DOKPLOY_URL=http://127.0.0.1:3999 DOKPLOY_API_KEY=test-key DOKPLOY_APP_ID=app-123 \
node --import ./server/register.mjs server/index.ts
```

`S2G_DNS_SERVERS` points the check at the mock resolver and `CUSTOM_DOMAIN_PROBE_ADDR` sends the https check to the mock (the certificate is still checked for the address's name). Neither belongs in production.

1. Switch the brand on and type `portal.agency.test`: waiting, with the CNAME to add.
2. Add `"portal.agency.test": { "CNAME": "custom.sprint2go.com" }` to `zones.json` and choose Check now: record found, and with the branding add-on on, Dokploy gets `domain.create`, then live.
3. `curl -H 'Host: portal.agency.test' http://localhost:8818/api/brand` answers with the agency's brand; any other host gets the plain page.
4. Change or remove the address: `/mock/state` shows the old domain gone.

To see the brand in a browser without any of this, open `<slug>.localhost:<port>` (shown in Settings when running on localhost).
