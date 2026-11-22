#!/bin/bash
# The control run is needed only as far as its first look: what its builder left and what its verifiers found
# before any fix. When the watcher has kept that (snap-<arm>/look-head.txt), the run is ended by the id kept for
# it, with everything it started, and what is left running from its folder is listed (not ended by name).
arm=$1
W=/Volumes/DEV-SSD/sz-scratch.noindex/drawing-compare
S=$W/snap-$arm
until [ -s $S/look-head.txt ] || grep -q "build end" $W/arm-$arm/clock.txt; do sleep 15; done
if grep -q "build end" $W/arm-$arm/clock.txt; then echo "$(date '+%H:%M:%S') the run ended by itself" >> $S/watch.log; exit 0; fi
sleep 20   # the watcher's copy of the evidence is done before its line is written; a little room all the same
root=$(cat $W/.run-$arm.pid)
echo "$(date '+%H:%M:%S') first look kept; ending the run (root $root)" >> $S/watch.log
bash $W/tools/end-tree.sh $root >> $S/watch.log 2>&1
echo "$(date '+%Y-%m-%d %H:%M:%S') build end (stopped after its first look by whoever started it)" >> $W/arm-$arm/clock.txt
ps -ax -o pid,etime,command | grep "drawing-compare/arm-$arm" | grep -v grep | cut -c1-150 >> $S/watch.log
echo "$(date '+%H:%M:%S') stopped; what is listed above, if anything, still runs from its folder" >> $S/watch.log
