#!/bin/bash
# Installs (or reinstalls) the Studio Zero daemon as a LaunchAgent for the current user.
# Run from anywhere:  deploy/install-launch-agent.sh
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
NODE="$(command -v node)"
LABEL="zero.studio.daemon"
TARGET="$HOME/Library/LaunchAgents/$LABEL.plist"
DOMAIN="gui/$(id -u)"

major="$("$NODE" -p 'process.versions.node.split(".")[0]')"
if [ "$major" -lt 24 ]; then
  echo "Node 24 or newer is required (found $("$NODE" -v) at $NODE)." >&2
  exit 1
fi

(cd "$REPO" && pnpm install --frozen-lockfile && pnpm build)

mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs/studio-zero"
sed -e "s|__NODE_DIR__|$(dirname "$NODE")|g" -e "s|__NODE__|$NODE|g" -e "s|__REPO__|$REPO|g" -e "s|__HOME__|$HOME|g" \
  "$REPO/deploy/launchd/$LABEL.plist" > "$TARGET"
plutil -lint "$TARGET" >/dev/null

launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
launchctl bootstrap "$DOMAIN" "$TARGET"
launchctl kickstart -k "$DOMAIN/$LABEL"

echo "Installed $TARGET"
echo "Status:  launchctl print $DOMAIN/$LABEL | head -20"
echo "Logs:    tail -f $HOME/Library/Logs/studio-zero/daemon.log"
echo "Remove:  launchctl bootout $DOMAIN/$LABEL && rm $TARGET"
