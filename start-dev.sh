#!/bin/bash
# Wolfcha dev server launcher - starts server detached with output to dev.log
# Uses disown + unset PID trick so the process survives parent shell exit
cd /home/z/my-project

rm -f dev.log

# Start dev server in background, output to dev.log
bun run dev > dev.log 2>&1 &
DEV_PID=$!

# Detach from shell so it survives parent exit
disown "$DEV_PID" 2>/dev/null || true

# Write PID file for tracking
echo "$DEV_PID" > .zscripts/dev.pid

# Unset so cleanup traps won't kill it
unset DEV_PID

echo "Wolfcha dev server started (PID in .zscripts/dev.pid), logs in dev.log"
