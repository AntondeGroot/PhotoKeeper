#!/bin/bash
set -e

# Usage:
#   ./deploy.sh           — build frontend + backend, deploy to Pi

# --- Load secrets ---
if [ ! -f deploy.env ]; then
  echo "❌ deploy.env not found — copy deploy.env.example and fill in your Adobe credentials"
  exit 1
fi
# shellcheck source=deploy.env
source deploy.env

if [ -z "$ADOBE_CLIENT_ID" ] || [ -z "$ADOBE_CLIENT_SECRET" ]; then
  echo "❌ ADOBE_CLIENT_ID and ADOBE_CLIENT_SECRET must be set in deploy.env"
  exit 1
fi

# --- Target detection (tries LAN first, falls back to Cloudflare Tunnel) ---
if ssh -o ConnectTimeout=3 -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectionAttempts=1 my-pi true 2>/dev/null; then
  TARGET=my-pi
else
  echo "⚠️  my-pi unreachable, falling back to my-pi-ext (Cloudflare Tunnel)..."
  TARGET=my-pi-ext
fi

SSH="ssh -i ~/.ssh/pi_deploy_key $TARGET"
SCP="scp -i ~/.ssh/pi_deploy_key"

echo "🎯 Target: $TARGET"

# --- Frontend ---
echo "🔨 Linting frontend..."
(cd frontend && npm run lint)

# --- Web build ---
echo "🔨 Building Angular for web..."
(cd frontend && npx ng build --configuration production --base-href /photokeeper/)

# --- Bundle Angular into backend static resources ---
echo "📦 Bundling frontend into backend..."
rm -rf backend/src/main/resources/static
mkdir -p backend/src/main/resources/static
cp -r frontend/dist/frontend/browser/. backend/src/main/resources/static/
cp backend/src/main/resources/download.html backend/src/main/resources/static/download.html

# --- Backend ---
echo "🔨 Building backend..."
(cd backend && mvn clean package -q)

# --- Upload ---
echo "📦 Uploading..."
$SCP backend/target/photokeeper-backend-0.1.0-SNAPSHOT.jar \
     $TARGET:/home/ubuntu/photokeeper.jar

# ─────────────────────────────────────────────────────────────────────────────
# Blue/green release
#
# The old deploy overwrote the jar and restarted in place, so every release cost
# a Spring Boot startup of downtime — thirty-odd seconds on a Pi, during which
# phones got a 502 mid-review. Instead two copies live side by side on their own
# ports, and a release starts the idle one, waits for it to actually answer, and
# only then moves nginx across. Traffic never points at a starting JVM.
#
# nginx is the switch because it is already the front door (cloudflared → nginx →
# java) and `reload` is graceful: existing workers finish the requests they are
# holding while new ones go to the new upstream. Nothing in flight is dropped.
#
# The backend keeps no server-side session state — Lightroom tokens live on the
# device — so a swap costs nobody their connection.
# ─────────────────────────────────────────────────────────────────────────────

BLUE_PORT=8080
GREEN_PORT=8081
UPSTREAM_CONF=/etc/nginx/conf.d/photokeeper-upstream.conf
ROUTES_DIR=/etc/nginx/app-routes
ROUTE_CONF=$ROUTES_DIR/photokeeper.conf
NGINX_SITE=/etc/nginx/sites-available/gameroom
READY_TIMEOUT=120   # seconds to wait for the new instance to serve a page
DRAIN_SECONDS=10    # let in-flight requests finish before stopping the old one

# --- Which colour is serving now? ---
# nginx is the source of truth: whatever it points at *is* the live instance, so
# there is no separate state file to drift out of step with reality.
ACTIVE_PORT=$($SSH "grep -oE 'server 127\.0\.0\.1:[0-9]+' $UPSTREAM_CONF 2>/dev/null | grep -oE '[0-9]+$'" || true)

case "$ACTIVE_PORT" in
  "$BLUE_PORT")  COLOUR=green; PORT=$GREEN_PORT; OLD_COLOUR=blue  ;;
  "$GREEN_PORT") COLOUR=blue;  PORT=$BLUE_PORT;  OLD_COLOUR=green ;;
  # First blue/green release: the legacy single service still holds 8080, so go
  # green and retire it once traffic has moved. Even the migration is seamless.
  *)             COLOUR=green; PORT=$GREEN_PORT; OLD_COLOUR=""    ;;
esac

# On the very first run nothing points anywhere yet, and what is actually serving
# is the legacy single instance on the blue port — so that is what the upstream
# gets seeded with, leaving live traffic exactly where it is until the switch.
SEED_PORT=${ACTIVE_PORT:-$BLUE_PORT}

# Assert both ports are numeric before anything is written with them. An empty one
# renders as "server 127.0.0.1:;", which nginx rejects outright — cheap insurance
# against a quoting slip reaching a config file that fronts four sites.
for p in "$SEED_PORT" "$PORT"; do
  case "$p" in
    '' | *[!0-9]*)
      echo "❌ refusing to continue: computed a non-numeric port ('$p')"
      exit 1
      ;;
  esac
done

echo "🔵🟢 Releasing to $COLOUR (port $PORT); currently live: ${ACTIVE_PORT:-legacy single instance}"

# --- Install the new jar beside the running one ---
echo "📁 Installing $COLOUR..."
$SSH "sudo mkdir -p /opt/photokeeper/$COLOUR && sudo mv /home/ubuntu/photokeeper.jar /opt/photokeeper/$COLOUR/photokeeper.jar"

# --- Templated unit, one instance per colour ---
echo "⚙️  Ensuring systemd template exists..."
$SSH "sudo tee /etc/systemd/system/photokeeper@.service > /dev/null << 'EOF'
[Unit]
Description=PhotoKeeper server (%i)
After=network.target

[Service]
User=ubuntu
WorkingDirectory=/opt/photokeeper
EnvironmentFile=/opt/photokeeper/%i.env
ExecStart=/usr/bin/java -jar /opt/photokeeper/%i/photokeeper.jar \\
  --spring.config.additional-location=file:/opt/photokeeper/application-override.properties \\
  --server.port=\${PORT}
Restart=on-failure
RestartSec=5
# A drained instance is stopped with SIGTERM, and Spring exits 143 after shutting down cleanly.
# Without this systemd files that under 'failed', so a textbook blue/green handover leaves the
# retired colour looking like it crashed.
SuccessExitStatus=143

[Install]
WantedBy=multi-user.target
EOF
printf 'PORT=%s\n' $BLUE_PORT | sudo tee /opt/photokeeper/blue.env > /dev/null
printf 'PORT=%s\n' $GREEN_PORT | sudo tee /opt/photokeeper/green.env > /dev/null
sudo systemctl daemon-reload"

# --- Sync override config (always, so credentials stay up to date) ---
# No server.port here: the port is what distinguishes the two colours, so it is
# set per instance by the unit above and must not be pinned for both at once.
echo "⚙️  Syncing application config..."
$SSH "sudo tee /opt/photokeeper/application-override.properties > /dev/null << EOF
adobe.client-id=${ADOBE_CLIENT_ID}
adobe.client-secret=${ADOBE_CLIENT_SECRET}
adobe.redirect-uri=https://antondegroot.uk/photokeeper/api/auth/callback
adobe.frontend-url=https://antondegroot.uk/photokeeper

# Cloudflare Tunnel handles TLS — Spring Boot runs plain HTTP internally
server.servlet.context-path=/photokeeper
server.ssl.enabled=false
EOF"

# --- Point nginx at PhotoKeeper: an upstream it can re-aim, and a route of its own ---
# The route is a file of PhotoKeeper's own in /etc/nginx/app-routes/, included from GameRoom's
# site (GWT_GameRoom/nginx.conf). It used to be a block inside GameRoom's file, and GameRoom's
# setup-pi.sh copies that file over the Pi's — which wiped the block and took PhotoKeeper offline.
# Installed on every release, so the route can never stay lost.
#
# Same nginx serves GameRoom, Keezen, Qwixx and the portfolio, so nothing is reloaded untested: a
# rejected config puts the previous route back and stops the release.
echo "🔀 Ensuring nginx upstream and route..."
$SCP ops/nginx-route.conf "$TARGET:/home/ubuntu/photokeeper-route.conf"
$SSH "
set -e
if [ ! -f $UPSTREAM_CONF ]; then
  printf 'upstream photokeeper_backend { server 127.0.0.1:%s; }\n' '$SEED_PORT' | \
    sudo tee $UPSTREAM_CONF > /dev/null
fi
if ! grep -q 'include $ROUTES_DIR/\*.conf;' $NGINX_SITE; then
  echo '❌ $NGINX_SITE does not include $ROUTES_DIR/*.conf, so PhotoKeeper would not be reachable.'
  echo '   Run GWT_GameRoom/setup-pi.sh (its nginx.conf has the include) and deploy again.'
  exit 1
fi
sudo mkdir -p $ROUTES_DIR
[ -f $ROUTE_CONF ] && sudo cp $ROUTE_CONF $ROUTE_CONF.prev
sudo mv /home/ubuntu/photokeeper-route.conf $ROUTE_CONF
if ! sudo nginx -t; then
  echo '❌ nginx rejected the PhotoKeeper route — restoring the previous one'
  if [ -f $ROUTE_CONF.prev ]; then sudo mv $ROUTE_CONF.prev $ROUTE_CONF; else sudo rm -f $ROUTE_CONF; fi
  exit 1
fi
sudo rm -f $ROUTE_CONF.prev
sudo systemctl reload nginx"

# --- Start the idle colour and wait for it to actually answer ---
# --- Insist the port is ours before trusting anything answering on it ---
# The readiness probe below cannot tell one instance from another. If something
# else already holds this port, the new JVM fails to bind and systemd restarts it
# in a loop while curl happily gets a 200 from the *squatter* — so the release
# reports success and the switch lands on whatever was already there, serving the
# old jar. Checking the port is what makes the probe's 200 mean what it says.
echo "🔎 Checking port $PORT is free..."
$SSH "
sudo systemctl stop photokeeper@$COLOUR 2>/dev/null || true
sleep 1
if ss -tln | grep -q ':$PORT '; then
  echo '❌ port $PORT is already held — refusing to release onto it:'
  sudo ss -tlnp | grep ':$PORT '
  exit 1
fi"

echo "🚀 Starting $COLOUR..."
$SSH "sudo systemctl enable photokeeper@$COLOUR >/dev/null 2>&1; sudo systemctl restart photokeeper@$COLOUR"

echo "⏳ Waiting for $COLOUR to serve (up to ${READY_TIMEOUT}s)..."
# Probes the real page rather than a liveness ping: a 200 here means Spring is up
# *and* the Angular bundle is being served, which is what a phone actually needs.
if ! $SSH "
for i in \$(seq 1 $READY_TIMEOUT); do
  if curl -sf -o /dev/null http://127.0.0.1:$PORT/photokeeper/; then echo ready; exit 0; fi
  sleep 1
done
exit 1"; then
  echo "❌ $COLOUR never came up — traffic left on the running instance, nothing changed."
  echo "   Recent logs:"
  $SSH "sudo journalctl -u photokeeper@$COLOUR -n 30 --no-pager" || true
  $SSH "sudo systemctl stop photokeeper@$COLOUR" || true
  exit 1
fi

# --- Switch traffic over ---
echo "🔀 Switching traffic to $COLOUR..."
$SSH "
set -e
sudo cp $UPSTREAM_CONF $UPSTREAM_CONF.prev
printf 'upstream photokeeper_backend { server 127.0.0.1:%s; }\n' '$PORT' | sudo tee $UPSTREAM_CONF > /dev/null
# Never reload an untested config: the same nginx serves GameRoom, Keezen and
# Qwixx, so a bad file here would take those down too. Put the old one back and
# leave traffic on the instance that is already working.
if ! sudo nginx -t; then
  sudo mv $UPSTREAM_CONF.prev $UPSTREAM_CONF
  exit 1
fi
sudo rm -f $UPSTREAM_CONF.prev
sudo systemctl reload nginx"

# --- Retire the previous instance once it has drained ---
echo "🧹 Draining ${DRAIN_SECONDS}s before retiring the old instance..."
sleep $DRAIN_SECONDS
if [ -n "$OLD_COLOUR" ]; then
  $SSH "sudo systemctl stop photokeeper@$OLD_COLOUR" || true
fi
# The pre-blue/green service is retired whenever it is still up, rather than only
# on a run that looked like the first one. A release that aborts partway can leave
# the upstream file behind, which would make the next run infer a colour was live
# and never retire the legacy instance — stranding it on the blue port, where the
# release after that would find the port taken and refuse to go.
$SSH "sudo systemctl is-active --quiet photokeeper.service && sudo systemctl disable --now photokeeper.service" || true

# --- Confirm it is reachable the way a phone reaches it: through nginx, by hostname ---
# The probes above talk to the instance's port directly, so they pass even when nginx has no
# route to it — which is exactly how PhotoKeeper once went offline with every check green.
if ! $SSH "curl -sf -o /dev/null -H 'Host: antondegroot.uk' http://127.0.0.1/photokeeper/"; then
  echo "❌ $COLOUR is running, but nginx does not route /photokeeper/ to it."
  echo "   Check $ROUTE_CONF and that $NGINX_SITE includes $ROUTES_DIR/*.conf."
  exit 1
fi

echo "✅ Done — $COLOUR live on port $PORT.  https://antondegroot.uk/photokeeper"
echo "   Install page: https://antondegroot.uk/photokeeper/download"
