#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

pnpm build

mkdir -p "$HOME/.config/systemd/user"
ln -sf "$(pwd)/clara.service" "$HOME/.config/systemd/user/clara.service"

systemctl --user daemon-reload
systemctl --user enable --now clara.service
systemctl --user restart clara.service

echo "Clara hub service installed."
echo "Pair a device with: clara pair"
