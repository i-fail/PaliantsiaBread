sudo -u pal -H bash -c "cd /home/pal/pal_website && bun run db:migrate"
systemctl restart palianytsia
sudo -u pal -H bash -c "cd /home/pal/pal_website && bun run build"