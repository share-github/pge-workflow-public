#!/usr/bin/env bash
# PGE DB Isolation Catalog — Entry 3 (named-volume-clone): per-AC dispose script
#
# clone-named-volume.sh で起動した per-AC DB container + volume を停止 / 削除する。
# 一次資料: .claude/references/db-isolation-catalog.md Entry 3。
#
# 必須引数:
#   --container-name  停止対象 container 名 (clone 時の --container-name と同じ値)
#   --target-volume   削除対象 volume 名 (clone 時の --target-volume と同じ値)
#
# 任意引数:
#   --keep-logs       停止前に `docker logs --tail 200` を /tmp に保存 (debug 用)

set -euo pipefail

CONTAINER_NAME=""
TARGET_VOLUME=""
KEEP_LOGS=false

usage() {
  sed -n '2,14p' "$0" >&2
  exit 2
}

while [ $# -gt 0 ]; do
  case "$1" in
    --container-name) CONTAINER_NAME="$2"; shift 2 ;;
    --target-volume)  TARGET_VOLUME="$2"; shift 2 ;;
    --keep-logs)      KEEP_LOGS=true; shift ;;
    -h|--help)        usage ;;
    *) echo "unknown argument: $1" >&2; usage ;;
  esac
done

for required in CONTAINER_NAME TARGET_VOLUME; do
  if [ -z "${!required}" ]; then
    echo "missing required argument: --${required,,}" | tr '_' '-' >&2
    usage
  fi
done

if ! command -v docker >/dev/null 2>&1; then
  echo "docker CLI not available" >&2
  exit 3
fi

if docker ps -a --format '{{.Names}}' | grep -Fxq "$CONTAINER_NAME"; then
  if [ "$KEEP_LOGS" = true ]; then
    log_path=$(mktemp -t "${CONTAINER_NAME}.XXXXXX.log")
    docker logs --tail 200 "$CONTAINER_NAME" > "$log_path" 2>&1 || true
    echo "saved logs: $log_path" >&2
  fi
  echo "[1/2] stop + remove container: $CONTAINER_NAME" >&2
  docker stop "$CONTAINER_NAME" >/dev/null 2>&1 || true
  docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
else
  echo "container not found (already removed): $CONTAINER_NAME" >&2
fi

if docker volume inspect "$TARGET_VOLUME" >/dev/null 2>&1; then
  echo "[2/2] remove volume: $TARGET_VOLUME" >&2
  docker volume rm -f "$TARGET_VOLUME" >/dev/null
else
  echo "volume not found (already removed): $TARGET_VOLUME" >&2
fi

exit 0
