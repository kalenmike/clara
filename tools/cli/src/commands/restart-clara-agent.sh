#!/usr/bin/env bash

pnpm --filter @clara/hub-server build
systemctl --user restart clara
