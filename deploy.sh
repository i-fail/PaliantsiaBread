sudo -u pal -H bash -c "cd /home/pal/pal_website && /home/pal/.bun/bin/bun run db:migrate"
systemctl restart palianytsia
sudo -u pal -H bash -c "cd /home/pal/pal_website && /home/pal/.bun/bin/bun run build"