#!/bin/sh
set -eu

IMAGE="ghcr.io/sabristratos/seekquel-bridge"
VERSION="$(node -p "require('./package.json').version")"

npm run typecheck
npm test

docker buildx build \
  --platform linux/amd64,linux/arm64 \
  --tag "$IMAGE:$VERSION" \
  --tag "$IMAGE:latest" \
  --push \
  .

printf '%s\n' "Published $IMAGE:$VERSION and $IMAGE:latest"
