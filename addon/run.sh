#!/usr/bin/with-contenv bashio
export PORT=3210
export HOST=0.0.0.0
export MEALS_DATA_DIR=/data/meal-atlas
cd /app
node server/index.js
