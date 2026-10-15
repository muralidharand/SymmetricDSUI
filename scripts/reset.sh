#!/bin/bash
# DESTROYS all containers and the SQL Server volume.
cd "$(dirname "${BASH_SOURCE[0]}")/.." && docker compose down -v
