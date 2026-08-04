# iMessage → the engine

How to make your iMessage history readable by every Claude surface you use —
this cloud session, your phone, and both Macs — from a single always-on host.

Status: **not yet built.** This is the plan, written so you can run it.

---

## What you're building, and why not the obvious thing

The obvious thing is to install an iMessage MCP server on each Mac. That works,
and it is also not what you want. A local MCP server speaks stdio to the Claude
process on the same machine. Install it twice and you get two islands: each
Mac's Claude Code can read your messages, and the cloud sessions — the ones
running the morning beat, the Notion writes, the Gmail sweeps — still see
nothing at all.

So instead:

```
  always-on Mac
  ┌──────────────────────────────────────────┐
  │  ~/Library/Messages/chat.db  (read-only) │
  │              ↑                            │
  │   imessage-mcp   (stdio)                  │
  │              ↑                            │
  │   supergateway  (stdio → Streamable HTTP) │
  │              ↑  localhost:8788            │
  │   cloudflared   (named tunnel)            │
  └──────────────┬───────────────────────────┘
                 ↓
     https://imessage.<your-domain>
                 ↓
   custom connector at claude.ai
                 ↓
   every session: cloud, phone, laptop, mini
```

The second Mac needs nothing installed. It reads through the same URL.

---

## 1. The server

Two good options, both macOS-only, both reading `~/Library/Messages/chat.db`:

| | |
|---|---|
| [`adelaidasofia/imessage-mcp`](https://github.com/adelaidasofia/imessage-mcp) | FTS5 full-text search, contact and thread listing, unread tracking. Send is draft-then-confirm — the same rule we already run on Gmail. **Recommended.** |
| [`carterlasalle/mac_messages_mcp`](https://github.com/carterlasalle/mac_messages_mcp) | Broader: attachments, group chats, phone-number validation, contact resolution. Fuller send support. |

Configure **read-only**. Nothing needs to leave under your name, and read is
all the engine wants.

One thing worth knowing about the database: since macOS 14, message text is
often `NULL` in the `text` column and lives in the `attributedBody` binary blob
instead. Both servers above handle it. Anything that doesn't will silently
return empty messages, which looks like "no history" rather than "broken."

---

## 2. Full Disk Access — the step everyone gets wrong

`chat.db` is protected. macOS grants access to the **process that opens the
file**, not to the app you think of as doing the work.

Running headless under `launchd`, that process is your Node binary. So:

1. System Settings → Privacy & Security → Full Disk Access
2. Click **+**
3. Press `⌘⇧G` and type the real path — `/opt/homebrew/bin/node` on Apple
   Silicon, `/usr/local/bin/node` on Intel. Confirm with `which node`.

Granting it to Claude.app or Terminal instead will appear to work when you test
by hand and fail the moment `launchd` runs it. If the server returns an empty
database, this is why.

---

## 3. stdio → HTTP

The MCP servers above speak stdio only. A remote connector needs Streamable
HTTP, so put a bridge in between:

```bash
npx -y supergateway \
  --stdio "npx -y @adelaidasofia/imessage-mcp" \
  --outputTransport streamableHttp \
  --port 8788
```

[`supergateway`](https://github.com/supercorp-ai/supergateway) handles
concurrent clients from 3.3 on, which matters here — phone and laptop will hit
it at the same time. [`mcp-proxy`](https://github.com/sparfenyuk/mcp-proxy) does
the same job if you'd rather have Python.

---

## 4. Keep it running

`~/Library/LaunchAgents/com.mick.imessage-mcp.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>            <string>com.mick.imessage-mcp</string>
  <key>ProgramArguments</key>
  <array>
    <string>/opt/homebrew/bin/npx</string>
    <string>-y</string>
    <string>supergateway</string>
    <string>--stdio</string>
    <string>npx -y @adelaidasofia/imessage-mcp</string>
    <string>--outputTransport</string>
    <string>streamableHttp</string>
    <string>--port</string>
    <string>8788</string>
  </array>
  <key>RunAtLoad</key>        <true/>
  <key>KeepAlive</key>        <true/>
  <key>StandardOutPath</key>  <string>/tmp/imessage-mcp.log</string>
  <key>StandardErrorPath</key><string>/tmp/imessage-mcp.err</string>
</dict>
</plist>
```

```bash
launchctl load ~/Library/LaunchAgents/com.mick.imessage-mcp.plist
```

`KeepAlive` restarts it on crash; `RunAtLoad` survives reboot. Then stop the
host sleeping:

```bash
sudo pmset -a sleep 0 disksleep 0
caffeinate -dimsu &   # or a second launchd agent, if you want it permanent
```

---

## 5. The tunnel

You already have domains on Cloudflare, so use a **named** tunnel. Quick
tunnels mint a fresh random hostname on every restart, which breaks the
connector every time the Mac reboots — exactly the failure this whole build
exists to avoid.

```bash
brew install cloudflared
cloudflared tunnel login
cloudflared tunnel create imessage-mcp
cloudflared tunnel route dns imessage-mcp imessage.<your-domain>
```

`~/.cloudflared/config.yml`:

```yaml
tunnel: imessage-mcp
credentials-file: /Users/<you>/.cloudflared/<tunnel-id>.json
ingress:
  - hostname: imessage.<your-domain>
    service: http://localhost:8788
  - service: http_status:404
```

Then `cloudflared service install` so the tunnel itself comes back on reboot.

---

## 6. Auth — do not skip this

That URL is your entire message history. Every text you have ever sent or
received, reachable by anyone who guesses the hostname. An open tunnel here is
worse than not building it.

Put **Cloudflare Access** in front of the hostname and issue a service token,
which gives you `CF-Access-Client-Id` and `CF-Access-Client-Secret` headers to
present from the connector.

One caveat I can't verify from here: whether claude.ai's custom-connector setup
lets you set arbitrary request headers. Check that first — it determines
whether the service-token route works. If it doesn't, the fallback is an
OAuth-protected Access application rather than a shared secret. Do not fall
back to "long random URL and hope"; that is a bookmark away from a leak.

---

## 7. Connect it

Add `https://imessage.<your-domain>` as a custom connector at claude.ai, with
whatever auth step 6 landed on. Once it's there, it's there for every surface —
including this cloud session, and including your phone, which is the one that
has been blocking you.

---

## The other 5%

When the host sleeps or reboots, calls fail. That's the honest cost of one
host, and it's the right trade against the complexity of two.

What matters is how it fails. A failed lookup must degrade to *asking you*, not
to recording silence — an unreachable server means "unknown," never "no contact."
Getting that backwards is how a tracker starts quietly lying about your
relationships.

The second Mac stays a client. If you want it usable offline too, install the
same MCP server locally there for Claude Code only, and leave the tunnel as the
single source the cloud reads.

---

## Why this is worth the evening

Keep in Touch currently runs on a phone-history export from May 2025 and
whatever gets logged at the evening close. That is why fifteen rows are still
marked `Placeholder — needs ID`, why six names have never been matched to a
person, and why every evening opens with "who did you talk to today."

With message access, most of that answers itself. Last-contacted dates stop
being estimates. The owed/owes sweep stops being email-only — which matters,
because the failure mode we keep hitting is treating a quiet inbox as evidence
about a relationship, when the actual conversation happened somewhere I can't
see.

---

**Sources:**
[adelaidasofia/imessage-mcp](https://github.com/adelaidasofia/imessage-mcp) ·
[carterlasalle/mac_messages_mcp](https://github.com/carterlasalle/mac_messages_mcp) ·
[daveremy/imessage-mcp](https://github.com/daveremy/imessage-mcp) ·
[supercorp-ai/supergateway](https://github.com/supercorp-ai/supergateway) ·
[sparfenyuk/mcp-proxy](https://github.com/sparfenyuk/mcp-proxy)
