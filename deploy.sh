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

# --- Install ---
echo "📁 Installing..."
$SSH "sudo mkdir -p /opt/photokeeper && sudo mv /home/ubuntu/photokeeper.jar /opt/photokeeper/photokeeper.jar"

# --- Systemd service ---
echo "⚙️  Ensuring systemd service exists..."
$SSH "
if [ ! -f /etc/systemd/system/photokeeper.service ]; then
  sudo tee /etc/systemd/system/photokeeper.service > /dev/null << 'EOF'
[Unit]
Description=PhotoKeeper server
After=network.target

[Service]
User=ubuntu
WorkingDirectory=/opt/photokeeper
ExecStart=/usr/bin/java -jar /opt/photokeeper/photokeeper.jar \
  --spring.config.additional-location=file:/opt/photokeeper/application-override.properties
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
  sudo systemctl daemon-reload
  sudo systemctl enable photokeeper
fi"

# --- Sync override config (always, so credentials stay up to date) ---
echo "⚙️  Syncing application config..."
$SSH "sudo tee /opt/photokeeper/application-override.properties > /dev/null << EOF
adobe.client-id=${ADOBE_CLIENT_ID}
adobe.client-secret=${ADOBE_CLIENT_SECRET}
adobe.redirect-uri=https://antondegroot.uk/photokeeper/api/auth/callback
adobe.frontend-url=https://antondegroot.uk/photokeeper

# Cloudflare Tunnel handles TLS — Spring Boot runs plain HTTP internally
server.servlet.context-path=/photokeeper
server.port=8080
server.ssl.enabled=false
EOF"

# --- Restart ---
echo "🔄 Restarting..."
$SSH "sudo systemctl restart photokeeper"

echo "✅ Done.  https://antondegroot.uk/photokeeper"
echo "   Install page: https://antondegroot.uk/photokeeper/download"