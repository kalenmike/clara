#!/usr/bin/env bash

pnpm --filter @clara/server build
systemctl --user restart clara
