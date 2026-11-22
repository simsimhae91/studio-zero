#!/bin/bash
# Ends one process and everything it started, by id, and says what is left. For a product copy started here
# (its root id was kept when it was started): never for anything found by a port or a name.
root=$1
[ -n "$root" ] || { echo "end-tree.sh <pid>"; exit 2; }
tree() { for c in $(pgrep -P "$1"); do tree "$c"; done; echo "$1"; }
pids=$(tree "$root")
for p in $pids; do kill "$p" 2>/dev/null; done
sleep 3
for p in $pids; do ps -p "$p" > /dev/null 2>&1 && kill -9 "$p" 2>/dev/null; done
sleep 1
left=0; for p in $pids; do ps -p "$p" > /dev/null 2>&1 && { echo "still up: $p"; left=1; }; done
[ $left = 0 ] && echo "ended: $(echo $pids | tr '\n' ' ')"
exit $left
