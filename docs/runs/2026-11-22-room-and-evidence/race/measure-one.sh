#!/bin/zsh
# Does a flow still stop right after it starts the app again, now that a simulator's driver is held up?
# On 2026-11-21, before the held driver, the diet app's path flow stopped in 3 of 4 runs at `stopApp` followed by
# `launchApp` ("Application ... is not running"), and 8 such stops were counted across the run. This runs the two
# ways a flow starts the app, each N times, through `sz-eyes ios flow` as it is now, on one simulator, with the same
# app (the Release build of the specimen diet-d at its last commit).
set -u
N=${N:-10}
S=$HOME/.studio-zero/specimens/2026-11-21/diet-d
W=/Volumes/DEV-SSD/sz-scratch.noindex/diet-race
L=/private/tmp/claude-501/-Users-hosoo-project-conclave/686733b1-3637-4b62-a388-7d33bb3580f5/scratchpad/race
export PATH=/Users/hosoo/project/conclave/plugin/bin:$PATH
mkdir -p $L
log() { echo "$(date '+%H:%M:%S') $*" | tee -a $L/log.txt }

if [ ! -d $W/build/Build/Products/Release-iphonesimulator/app.app ]; then
  log "copy the product (no evidence, no history)"
  rm -rf $W && mkdir -p $W && git -C $S archive HEAD -- . ':(exclude).sz/evidence' | tar -x -C $W || { log "copy failed"; exit 1 }
  cd $W
  log "npm ci"
  npm ci > $L/npm.log 2>&1 || { log "npm ci failed"; exit 1 }
  log "ios build"
  npm run ios:build > $L/ios-build.log 2>&1
  [ -d build/Build/Products/Release-iphonesimulator/app.app ] || { log "ios build failed: no app (see ios-build.log)"; exit 1 }
fi
cd $W
log "stack"
sz-eyes supabase start --runtime docker --exclude studio,analytics --output-format json 2> $L/sb.err | node scripts/stack-env.mjs > $L/stack.out 2>&1
npm run migrate > $L/migrate.log 2>&1 || log "migrate failed (see migrate.log)"
PORT=$(sz-eyes port)
(PORT=$PORT exec node --env-file-if-exists=.local/stack.env --import tsx server/index.ts) >> $L/server.log 2>&1 & spid=$!
URL=http://127.0.0.1:$PORT
for i in $(seq 1 60); do curl -sf $URL/healthz > /dev/null && break; sleep 0.5; done
curl -sf $URL/healthz > /dev/null || log "server did not answer (the app's first screen may still show)"
U=$(sz-eyes ios spare --name sz-race 2>> $L/spare.err | tail -1)
log "simulator $U, server $URL (pid $spid)"
bash scripts/ios-open.sh $U $URL > $L/install.txt 2>&1 || log "install said: $(tail -2 $L/install.txt)"

cat > $L/start.yaml <<'EOF'
appId: kr.studiozero.gamryangbattle
---
- launchApp:
    stopApp: true
- extendedWaitUntil:
    visible: "감량률로 1:1 배틀해요"
    timeout: 30000
EOF
cat > $L/again.yaml <<'EOF'
appId: kr.studiozero.gamryangbattle
---
- launchApp:
    stopApp: true
- extendedWaitUntil:
    visible: "감량률로 1:1 배틀해요"
    timeout: 30000
- stopApp
- launchApp
- extendedWaitUntil:
    visible: "감량률로 1:1 배틀해요"
    timeout: 30000
- stopApp
- launchApp
- extendedWaitUntil:
    visible: "감량률로 1:1 배틀해요"
    timeout: 30000
EOF

for kind in start again; do
  ok=0; notrunning=0; other=0
  for i in $(seq 1 $N); do
    s=$(date +%s)
    sz-eyes ios flow $U $L/$kind.yaml --out $L/out-$kind-$i > $L/$kind-$i.txt 2>&1; rc=$?
    took=$(( $(date +%s) - s ))
    if [ $rc = 0 ]; then ok=$((ok + 1)); what=passed
    elif grep -qi "not running" $L/$kind-$i.txt $L/out-$kind-$i/*.log 2>/dev/null; then notrunning=$((notrunning + 1)); what="NOT RUNNING"
    else other=$((other + 1)); what="other: $(grep -E 'FAILED|stopped at|could not' $L/$kind-$i.txt | head -1 | cut -c1-140)"; fi
    log "$kind $i: ${took}s exit $rc $what"
  done
  log "RESULT $kind: $ok of $N passed, $notrunning stopped with 'not running', $other stopped otherwise"
done

log "cleanup"
kill $spid 2> /dev/null
sz-eyes ios rest $U --erase > /dev/null 2>&1
xcrun simctl delete sz-race > /dev/null 2>&1
sz-eyes supabase stop > $L/sb-stop.log 2>&1
[ "${KEEP:-0}" = 1 ] || rm -rf $W
log "done: internal $(df -h /System/Volumes/Data | tail -1 | awk '{print $4}') free"
