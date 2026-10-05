#!/usr/bin/env bash
set -euo pipefail
APP=/home/pal/pal_website

bun run db:migrate
sudo systemctl restart palianytsia
bun run build