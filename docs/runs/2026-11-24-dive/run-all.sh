#!/bin/sh
# The eight runs of 9.3, four at a time, each batch mixing the two arms.
here="$(cd "$(dirname "$0")" && pwd)"
out="${1:-$HOME/.studio-zero/specimens/2026-11-24/dive-eval}"
mkdir -p "$out"
one() { node "$here/drive.mjs" --profile "$here/profiles/$1" --arm "$2" --out "$out/$1-$2" > "$out/$1-$2.log" 2>&1; echo "$1-$2 exit $?"; }
one app-other dive & one app-own grilling & one game-a dive & one game-b grilling & wait
one app-other grilling & one app-own dive & one game-a grilling & one game-b dive & wait
