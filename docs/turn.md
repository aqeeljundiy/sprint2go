# Call relay (TURN) for huddles

Huddle audio goes straight from browser to browser. On many mobile carriers and office networks the two browsers can't reach each other, and the call stays silent. A TURN server (coturn) relays the audio for those calls. Without it, the huddle says "This network blocks direct calls. Ask your admin to turn on the call relay."

How it fits together:

- coturn runs on the same server as sprint2go (178.212.35.85), with host networking.
- sprint2go and coturn share one secret. sprint2go hands each signed-in team member credentials that work for an hour (`GET /api/ice`); coturn checks them against the secret. The secret never reaches a browser.
- TLS (for networks that only allow HTTPS) is done by Traefik on port 443, which already renews certificates for every app. Traefik passes the decrypted stream to coturn on 3478/tcp.

## 1. A secret and a name

1. Make the secret on any computer: `openssl rand -hex 32`. You paste it in two places below.
2. In Cloudflare, add an A record `turn` (turn.sprint2go.com) pointing to `178.212.35.85`, **DNS only** (grey cloud). The orange-cloud proxy doesn't carry TURN.

## 2. coturn in Dokploy

In the sprint2go project: **Create Service → Compose** (type Docker Compose), name it `coturn`, provider **Raw**, and paste:

```yaml
services:
  coturn:
    image: coturn/coturn:4.7
    network_mode: host
    restart: unless-stopped
    command: ["-c", "/etc/coturn/turnserver.conf"]
    volumes:
      - ../files/turnserver.conf:/etc/coturn/turnserver.conf:ro
```

If Docker Hub has no `4.7` tag yet, use the newest `4.x` tag. Then **Advanced → Mounts → Add mount → File mount**, file path `turnserver.conf`, content (put your secret in `static-auth-secret`):

```ini
# sprint2go call relay
listening-port=3478
external-ip=178.212.35.85
realm=sprint2go.com

# Relay ports. Each person in a huddle can hold up to two per other person (one per TURN address), so leave room.
min-port=49160
max-port=49999

# Short-lived credentials made by sprint2go (TURN REST API). Same value as TURN_SECRET in the sprint2go app.
use-auth-secret
static-auth-secret=PASTE_THE_SECRET_HERE

# TLS is done by Traefik on 443 (see step 3), so coturn's own TLS and DTLS stay off.
no-tls
no-dtls

fingerprint
no-cli
no-multicast-peers
no-tcp-relay
stale-nonce=600
user-quota=24
total-quota=1200
log-file=stdout
simple-log

# Never relay into private networks (the Docker networks, the host's own services).
denied-peer-ip=0.0.0.0-0.255.255.255
denied-peer-ip=10.0.0.0-10.255.255.255
denied-peer-ip=100.64.0.0-100.127.255.255
denied-peer-ip=127.0.0.0-127.255.255.255
denied-peer-ip=169.254.0.0-169.254.255.255
denied-peer-ip=172.16.0.0-172.31.255.255
denied-peer-ip=192.168.0.0-192.168.255.255
denied-peer-ip=::1
denied-peer-ip=fc00::-fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff
```

Deploy it. The logs should end with coturn listening on 3478.

**Ports.** With `network_mode: host` there is nothing to map in Dokploy's Ports section: coturn listens on the server directly. That's why it's a Compose service and not an Application (an Application would need each relay port published one by one in host mode). If the server's firewall (ufw) is on, open:

| Port | Protocol | For |
| --- | --- | --- |
| 3478 | UDP | TURN, the usual way in |
| 3478 | TCP | TURN over TCP (Traefik forwards TLS here) |
| 49160-49999 | UDP | relay ports |
| 443 | TCP | already open for Traefik; carries TURN over TLS |

```sh
ufw allow 3478/udp && ufw allow 3478/tcp && ufw allow 49160:49999/udp
```

## 3. TLS on 443 through Traefik

In Dokploy: **Traefik File System → dynamic**, add a file `turn.yml` (on the server: `/etc/dokploy/traefik/dynamic/turn.yml`). Traefik picks it up without a restart and gets the certificate for turn.sprint2go.com itself.

```yaml
tcp:
  routers:
    turn-tls:
      entryPoints:
        - websecure
      rule: HostSNI(`turn.sprint2go.com`)
      service: turn-tls
      tls:
        certResolver: letsencrypt
  services:
    turn-tls:
      loadBalancer:
        servers:
          - address: "178.212.35.85:3478"
```

Port 443 gets through office firewalls that block 5349. If you'd rather have coturn do TLS itself on 5349: replace `no-tls` with `tls-listening-port=5349`, add `cert=` and `pkey=` pointing to a certificate for turn.sprint2go.com mounted into the container, open 5349/tcp, and use `turns:turn.sprint2go.com:5349?transport=tcp` below. coturn then needs its own certificate renewals.

## 4. Two settings in the sprint2go app

In the sprint2go application in Dokploy, **Environment**, add:

```
TURN_URLS=turn:turn.sprint2go.com:3478?transport=udp,turns:turn.sprint2go.com:443?transport=tcp
TURN_SECRET=the same secret as static-auth-secret
```

Redeploy the app. Add `turn:turn.sprint2go.com:3478?transport=tcp` to TURN_URLS only if a network needs plain TCP; every address listed costs a relay port per connection.

## 5. Check it

1. Operator console, **Platform → Health → Services**: "Call relay" should say "Answering at turn.sprint2go.com:3478 UDP".
2. Click **Test from this browser**. It asks the relay for an address the way a huddle does. "It works" means the ports, the external IP and the secret all line up. "Refused our credentials" means TURN_SECRET and static-auth-secret differ.
3. Start a huddle between a laptop on office Wi-Fi and a phone on mobile data.

If the relay stops answering, operators get an alert ("The call relay doesn't answer"), and huddles that need it show the message again.
