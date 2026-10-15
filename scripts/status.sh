#!/bin/bash
cd "$(dirname "$0")/.."
docker compose ps; docker compose run --rm tools status
