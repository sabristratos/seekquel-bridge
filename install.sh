#!/bin/sh
set -eu

IMAGE="${SEEKQUEL_BRIDGE_IMAGE:-ghcr.io/sabristratos/seekquel-bridge:latest}"
NAME="seekquel-bridge"
VOLUME="seekquel-bridge-data"
PORT="${SEEKQUEL_BRIDGE_PORT:-4410}"

say() {
  printf '%s\n' "$1"
}

if ! command -v docker >/dev/null 2>&1; then
  say "Docker is not installed. Install Docker, then run this again."
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  say "Docker is installed but not running, or this user may not use it. Start Docker (or run with sudo), then run this again."
  exit 1
fi

network_args=""
address_args=""
extra_networks=""
found=""

find_server() {
  pattern="$1"
  internal_port="$2"
  env_name="$3"
  label="$4"
  id="$(docker ps --format '{{.ID}} {{.Image}} {{.Names}}' | grep -i "$pattern" | grep -vi "$NAME" | head -n 1 | cut -d ' ' -f 1 || true)"

  [ -n "$id" ] || return 0

  name="$(docker inspect -f '{{.Name}}' "$id" | sed 's#^/##')"
  network="$(docker inspect -f '{{range $name, $_ := .NetworkSettings.Networks}}{{$name}} {{end}}' "$id" | cut -d ' ' -f 1)"

  case "$network" in
    "" | bridge | host | none)
      host_port="$(docker port "$id" "$internal_port" 2>/dev/null | head -n 1 | sed 's/.*://' || true)"
      if [ -n "$host_port" ]; then
        address_args="$address_args -e $env_name=http://host.docker.internal:$host_port"
      fi
      ;;
    *)
      if [ -z "$network_args" ]; then
        network_args="--network $network"
      elif [ "$network_args" != "--network $network" ]; then
        extra_networks="$extra_networks $network"
      fi
      address_args="$address_args -e $env_name=http://$name:$internal_port"
      ;;
  esac

  found="$found $label"
  say "Found $label running as \"$name\"."
}

find_server audiobookshelf 80 ABS_URL Audiobookshelf
find_server storyteller 8001 STORYTELLER_URL Storyteller

if [ -z "$found" ]; then
  say "No Audiobookshelf or Storyteller container found on this machine. You can type its address on the next page."
fi

seekquel_args=""
[ -z "${SEEKQUEL_API_URL:-}" ] || seekquel_args="$seekquel_args -e SEEKQUEL_API_URL=$SEEKQUEL_API_URL"
[ -z "${SEEKQUEL_APP_URL:-}" ] || seekquel_args="$seekquel_args -e SEEKQUEL_APP_URL=$SEEKQUEL_APP_URL"

case "$IMAGE" in
  */*) docker pull -q "$IMAGE" >/dev/null ;;
esac

docker rm -f "$NAME" >/dev/null 2>&1 || true

docker run -d \
  --name "$NAME" \
  --restart unless-stopped \
  --add-host host.docker.internal:host-gateway \
  -v "$VOLUME:/data" \
  -p "$PORT:4410" \
  $network_args \
  $address_args \
  $seekquel_args \
  "$IMAGE" >/dev/null

for network in $extra_networks; do
  docker network connect "$network" "$NAME" >/dev/null
done

host_ip="$(hostname -I 2>/dev/null | cut -d ' ' -f 1 || true)"
[ -n "$host_ip" ] || host_ip="localhost"

say ""
say "Seekquel Bridge is running. Open this page to finish (two short steps):"
say ""
say "  http://$host_ip:$PORT"
say ""
say "It starts by itself after a restart. To update it later, run this same command again."
