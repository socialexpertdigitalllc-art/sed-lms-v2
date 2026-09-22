#!/bin/sh
# macOS / Linux: start the SED LMS agent worker in the background.
# Safe to run repeatedly - a second copy exits at once - so it also works as
# an auto-restart from cron:
#   @reboot      /path/to/agent-worker/start-worker.sh
#   */3 * * * *  /path/to/agent-worker/start-worker.sh
cd "$(dirname "$0")" || exit 1
nohup node agent-worker.mjs >> worker.log 2>&1 &
