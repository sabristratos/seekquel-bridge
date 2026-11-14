#!/bin/sh
set -eu

IMAGE="${SEEKQUEL_BRIDGE_IMAGE:-ghcr.io/sabristratos/seekquel-bridge:latest}"
NAME="seekquel-bridge"
VOLUME="seekquel-bridge-data"
PORT="${SEEKQUEL_BRIDGE_PORT:-4410}"
ABS_INTERNAL_PORT="80"

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

abs_id="$(docker ps --format '{{.ID}} {{.Image}} {{.Names}}' | grep -i audiobookshelf | grep -vi "$NAME" | head -n 1 | cut -d ' ' -f 1 || true)"
network_args=""
address_args=""

if [ -n "$abs_id" ]; then
  abs_name="$(docker inspect -f '{{.Name}}' "$abs_id" | sed 's#^/##')"
  abs_network="$(docker inspect -f '{{range $name, $_ := .NetworkSettings.Networks}}{{$name}} {{end}}' "$abs_id" | cut -d ' ' -f 1)"

  case "$abs_network" in
    "" | bridge | host | none)
      abs_host_port="$(docker port "$abs_id" "$ABS_INTERNAL_PORT" 2>/dev/null | head -n 1 | sed 's/.*://' || true)"
      if [ -n "$abs_host_port" ]; then
        address_args="-e ABS_URL=http://host.docker.internal:$abs_host_port"
      fi
      ;;
    *)
      network_args="--network $abs_network"
      address_args="-e ABS_URL=http://$abs_name:$ABS_INTERNAL_PORT"
      ;;
  esac

  say "Found Audiobookshelf running as \"$abs_name\"."
else
  say "No Audiobookshelf container found on this machine. You can type its address on the next page."
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

host_ip="$(hostname -I 2>/dev/null | cut -d ' ' -f 1 || true)"
[ -n "$host_ip" ] || host_ip="localhost"

say ""
say "Seekquel Bridge is running. Open this page to finish (two short steps):"
say ""
say "  http://$host_ip:$PORT"
say ""
say "It starts by itself after a restart. To update it later, run this same command again."
