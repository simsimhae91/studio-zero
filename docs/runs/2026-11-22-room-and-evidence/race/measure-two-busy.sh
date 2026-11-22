#!/bin/zsh
# The same relaunch flow on two simulators at the same time, each with a held driver of its own: the condition under
# which flows stopped on 2026-11-21 (two verifiers, a simulator each).
set -u
N=${N:-10}
S=$HOME/.studio-zero/specimens/2026-11-21/diet-d
W=/Volumes/DEV-SSD/sz-scratch.noindex/diet-race
L=/private/tmp/claude-501/-Users-hosoo-project-conclave/686733b1-3637-4b62-a388-7d33bb3580f5/scratchpad/race4
export PATH=/Users/hosoo/project/conclave/.claude/worktrees/stop-wording/plugin/bin:$PATH
mkdir -p $L
log() { echo "$(date '+%H:%M:%S') $*" | tee -a $L/log.txt }
rm -rf $W && mkdir -p $W && git -C $S archive HEAD -- . ':(exclude).sz/evidence' | tar -x -C $W || { log "copy failed"; exit 1 }
cd $W
log "npm ci"; npm ci > $L/npm.log 2>&1 || { log "npm ci failed"; exit 1 }
log "ios build"; npm run ios:build > $L/ios-build.log 2>&1
[ -d build/Build/Products/Release-iphonesimulator/app.app ] || { log "ios build failed"; exit 1 }
log "stack"
sz-eyes supabase start --runtime docker --exclude studio,analytics --output-format json 2> $L/sb.err | node scripts/stack-env.mjs > $L/stack.out 2>&1
npm run migrate > $L/migrate.log 2>&1 || log "migrate failed"
PORT=$(sz-eyes port)
(PORT=$PORT exec node --env-file-if-exists=.local/stack.env --import tsx server/index.ts) >> $L/server.log 2>&1 & spid=$!
URL=http://127.0.0.1:$PORT
for i in $(seq 1 60); do curl -sf $URL/healthz > /dev/null && break; sleep 0.5; done
U1=$(sz-eyes ios spare --name sz-race 2>> $L/spare.err | tail -1)
U2=$(sz-eyes ios spare --name sz-race2 2>> $L/spare.err | tail -1)
log "simulators $U1 and $U2, server $URL"
bash scripts/ios-open.sh $U1 $URL > $L/install-1.txt 2>&1 || log "install 1: $(tail -1 $L/install-1.txt)"
bash scripts/ios-open.sh $U2 $URL > $L/install-2.txt 2>&1 || log "install 2: $(tail -1 $L/install-2.txt)"
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
loop() {
  local who=$1 U=$2 ok=0 nr=0 other=0
  for i in $(seq 1 $N); do
    local s=$(date +%s)
    sz-eyes ios flow $U $L/again.yaml --out $L/out-$who-$i > $L/$who-$i.txt 2>&1; local rc=$?
    local took=$(( $(date +%s) - s )) what
    if [ $rc = 0 ]; then ok=$((ok + 1)); what="passed$(grep -q "^run twice" $L/$who-$i.txt && echo " (RUN TWICE: asked too early, app was up)")"
    elif grep -qi "not running" $L/$who-$i.txt $L/out-$who-$i/*.log 2>/dev/null; then nr=$((nr + 1)); what="NOT RUNNING"
    else other=$((other + 1)); what="other: $(grep -E 'FAILED|stopped at|could not|not ready' $L/$who-$i.txt | head -1 | cut -c1-140)"; fi
    log "$who $i: ${took}s exit $rc $what"
    # A look between flows, as a verifier does.
    sz-eyes ios look $U --out $L/look-$who --name after-$i > /dev/null 2>&1 || log "$who look $i failed"
  done
  log "RESULT $who: $ok of $N passed, $nr stopped with 'not running', $other stopped otherwise"
}
# The processor kept busy, as it was when a driver was started for every command: ten idle loops, ended by their ids.
busy=()
for k in $(seq 1 10); do (while :; do :; done) & busy+=($!); done
log "ten busy loops: ${busy[*]}"
loop sim1 $U1 & p1=$!
loop sim2 $U2 & p2=$!
wait $p1 $p2
for b in $busy; do kill $b 2> /dev/null; done
log "busy loops ended"
log "cleanup"
kill $spid 2> /dev/null
sz-eyes ios rest $U1 --erase > /dev/null 2>&1; sz-eyes ios rest $U2 --erase > /dev/null 2>&1
xcrun simctl delete sz-race > /dev/null 2>&1; xcrun simctl delete sz-race2 > /dev/null 2>&1
sz-eyes supabase stop > $L/sb-stop.log 2>&1
rm -rf $W
log "done: internal $(df -h /System/Volumes/Data | tail -1 | awk '{print $4}') free"
