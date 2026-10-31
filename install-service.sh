#/usr/bin/env bash

ln -s $(pwd)/clara.service ~/.config/systemd/user/clara.service

systemctl --user daemon-reload
systemctl --user enable --now clara.service
systemctl --user restart clara
