#!/usr/bin/env bash
# PGE DB Isolation Catalog — Entry 3 (named-volume-clone): per-AC clone script
#
# baseline DB の named volume を tar pipe で複製し、新 volume を mount した DB container を起動する
# (host port publish なし・network 内 container_name 経由でアクセス)。
# 一次資料: .claude/references/db-isolation-catalog.md Entry 3。
#
# 必須引数 (long option only・ハードコード禁止):
#   --base-volume     baseline DB の named volume 名 (e.g. docker-compose の volumes 名)
#   --target-volume   clone 先 volume 名 (e.g. <prefix>_ac_<K>_data)
#   --db-image        DB engine image (PJ が使用する image:tag・例: <db-engine-image>:<tag>)
#   --container-name  起動する DB container 名 (e.g. <prefix>_ac_<K>_db)
#   --network         接続する docker network 名 (host SUT から container 名で reachable にする)
#   --data-dir        baseline volume 内の DB data directory (DB engine の image doc 参照)
#
# 任意引数:
#   --env             DB image に渡す環境変数 (-e で複数回指定可・e.g. <DB_ENGINE>_ROOT_PASSWORD=...)
#   --health-cmd      healthcheck 用 command (省略時は image default を期待)
#   --health-timeout  健全化待ち timeout 秒 (default 60)
#
# 設計上の注意:
# - host port publish は **行わない** (clone container へのアクセスは network 内 container_name 経由で完結する設計)
# - container 内 listen port は DB image (engine) が決定する・engine literal は FW に持たず PJ が runtime config の
#   per_ac_datasource.url_template に inline で declare する (例: `jdbc:<engine>://{container}:<image_internal_port>/...`)

set -euo pipefail

BASE_VOLUME=""
TARGET_VOLUME=""
DB_IMAGE=""
CONTAINER_NAME=""
NETWORK=""
DATA_DIR=""
HEALTH_CMD=""
HEALTH_TIMEOUT=60
ENV_FLAGS=()

usage() {
  sed -n '2,21p' "$0" >&2
  exit 2
}

while [ $# -gt 0 ]; do
  case "$1" in
    --base-volume)    BASE_VOLUME="$2"; shift 2 ;;
    --target-volume)  TARGET_VOLUME="$2"; shift 2 ;;
    --db-image)       DB_IMAGE="$2"; shift 2 ;;
    --container-name) CONTAINER_NAME="$2"; shift 2 ;;
    --network)        NETWORK="$2"; shift 2 ;;
    --data-dir)       DATA_DIR="$2"; shift 2 ;;
    --env)            ENV_FLAGS+=("-e" "$2"); shift 2 ;;
    --health-cmd)     HEALTH_CMD="$2"; shift 2 ;;
    --health-timeout) HEALTH_TIMEOUT="$2"; shift 2 ;;
    -h|--help)        usage ;;
    *) echo "unknown argument: $1" >&2; usage ;;
  esac
done

for required in BASE_VOLUME TARGET_VOLUME DB_IMAGE CONTAINER_NAME NETWORK DATA_DIR; do
  if [ -z "${!required}" ]; then
    echo "missing required argument: --${required,,}" | tr '_' '-' >&2
    usage
  fi
done

if ! command -v docker >/dev/null 2>&1; then
  echo "docker CLI not available" >&2
  exit 3
fi

if ! docker volume inspect "$BASE_VOLUME" >/dev/null 2>&1; then
  echo "base volume not found: $BASE_VOLUME" >&2
  exit 4
fi

if docker volume inspect "$TARGET_VOLUME" >/dev/null 2>&1; then
  echo "target volume already exists: $TARGET_VOLUME (use dispose script first)" >&2
  exit 5
fi

if docker ps -a --format '{{.Names}}' | grep -Fxq "$CONTAINER_NAME"; then
  echo "container name already in use: $CONTAINER_NAME (use dispose script first)" >&2
  exit 6
fi

echo "[1/4] create target volume: $TARGET_VOLUME" >&2
docker volume create "$TARGET_VOLUME" >/dev/null

echo "[2/4] copy data: $BASE_VOLUME -> $TARGET_VOLUME (via tar pipe)" >&2
# alpine ベースで tar 経由 copy (baseline 側を read-only mount で risk 軽減)
docker run --rm \
  -v "${BASE_VOLUME}:/from:ro" \
  -v "${TARGET_VOLUME}:/to" \
  alpine sh -c "cd /from && tar cf - . | (cd /to && tar xf -)"

echo "[3/4] start container: $CONTAINER_NAME (image: $DB_IMAGE)" >&2
run_args=(
  -d
  --name "$CONTAINER_NAME"
  --network "$NETWORK"
  -v "${TARGET_VOLUME}:${DATA_DIR}"
)
if [ "${#ENV_FLAGS[@]}" -gt 0 ]; then
  run_args+=("${ENV_FLAGS[@]}")
fi
docker run "${run_args[@]}" "$DB_IMAGE" >/dev/null

echo "[4/4] wait healthy (timeout: ${HEALTH_TIMEOUT}s)" >&2
elapsed=0
interval=2
while [ "$elapsed" -lt "$HEALTH_TIMEOUT" ]; do
  if [ -n "$HEALTH_CMD" ]; then
    if docker exec "$CONTAINER_NAME" sh -c "$HEALTH_CMD" >/dev/null 2>&1; then
      echo "container healthy: $CONTAINER_NAME" >&2
      exit 0
    fi
  else
    state=$(docker inspect --format '{{.State.Health.Status}}' "$CONTAINER_NAME" 2>/dev/null || echo "no-health")
    if [ "$state" = "healthy" ]; then
      echo "container healthy: $CONTAINER_NAME" >&2
      exit 0
    fi
    if [ "$state" = "no-health" ]; then
      running=$(docker inspect --format '{{.State.Running}}' "$CONTAINER_NAME" 2>/dev/null || echo "false")
      if [ "$running" = "true" ]; then
        echo "container running (no healthcheck defined): $CONTAINER_NAME" >&2
        exit 0
      fi
    fi
  fi
  sleep "$interval"
  elapsed=$((elapsed + interval))
done

echo "container did not become healthy within ${HEALTH_TIMEOUT}s: $CONTAINER_NAME" >&2
docker logs --tail 50 "$CONTAINER_NAME" >&2 || true
exit 7
