#!/usr/bin/env node
// Clara lifecycle and maintenance tools.
//
//   clara start hub --local
//   clara status adapter
//   clara pair adapter --harness opencode

import { clara } from './clara.mjs'
import { main } from './lib/router.mjs'

await main(clara)
