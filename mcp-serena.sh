#!/usr/bin/env bash
exec uvx \
  --from git+https://github.com/oraios/serena \
  serena start-mcp-server \
  --context ide-assistant \
  --project "$(pwd)"