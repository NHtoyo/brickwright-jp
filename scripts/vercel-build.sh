#!/bin/bash
set -e

# Vercel runs this if the project's "Build Command" still points here. The
# canonical config now lives in vercel.json at the repo root — installCommand
# + buildCommand + outputDirectory there override anything in the dashboard.
# This script remains as a fallback so existing setups don't break.

# Restore the verified micro:bit firmware import. The prepublish script caches
# the pinned archive and fails the build if the download or hash check fails.
npm run prepublish

CI=true NODE_OPTIONS='--max-old-space-size=8192' ./node_modules/.bin/webpack --bail

# index.html is now produced as the editor directly (see additional
# HtmlWebpackPlugin entry in webpack.config.js); no redirect overwrite
# needed. The TurboWarp player splash lives at /player.html.
