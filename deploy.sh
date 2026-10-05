#!/usr/bin/env bash
set -euo pipefail
APP=/home/pal/pal_website

echo -e "\033[0;32mStep 1: git pull...\033[0m"
echo -e "\033[0;32m================================\033[0m"
git pull
echo -e "\033[0;32mStep 2: DB migrations...\033[0m"
echo -e "\033[0;32m================================\033[0m"
bun run db:migrate
echo -e "\033[0;32mStep 3: Restarting backend...\033[0m"
echo -e "\033[0;32m================================\033[0m"
sudo systemctl restart palianytsia
echo -e "\033[0;32mStep 4: Building frontend...\033[0m"
echo -e "\033[0;32m================================\033[0m"
bun run build
echo -e "\033[0;32m================================\033[0m"
echo -e "\033[0;32mDONE\033[0m"