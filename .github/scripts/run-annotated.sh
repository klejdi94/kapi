#!/usr/bin/env bash
# Runs a command; if it fails, publishes the tail of its output as a workflow
# annotation, which is readable on the run page (and through the API) without
# downloading logs.
#   .github/scripts/run-annotated.sh "title" command args...
title="$1"
shift
log="$(mktemp)"
"$@" 2>&1 | tee "$log"
status=${PIPESTATUS[0]}
if [ "$status" -ne 0 ]; then
  echo "::error title=${title}::$(tail -c 6000 "$log" | sed 's/%/%25/g' | tr '\n' '|')"
fi
exit "$status"
