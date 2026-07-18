# @file runtime/Dockerfile
# @description Custom OpenHands agent-server RUNTIME image with the aimeat-app-builder skill
#   baked in. OpenHands runs the agent in this container (spawned by the app via the Docker
#   socket), separate from the app container. It loads user skills from its OWN
#   ~/.openhands/skills — which is why the skill must be inside the image, not bind-mounted
#   (a HOME-subtree bind mount makes Docker create ~/.openhands as root before the entrypoint,
#   and the uid-10001 `openhands` user then can't create profiles/ + cache/ → conversations
#   500). Built by scripts/build-runtime.sh; referenced by docker-compose.yml via
#   AGENT_SERVER_IMAGE_REPOSITORY/TAG.
ARG BASE=ghcr.io/openhands/agent-server:1.26.0-python
FROM ${BASE}

# COPY runs as root and creates the parent dirs; the chown below is mandatory so the runtime
# user owns all of ~/.openhands (profiles/ and the public-skills cache clone need to be
# writable at startup).
USER root
COPY skills/aimeat-app-builder /home/openhands/.openhands/skills/aimeat-app-builder
RUN chown -R openhands:openhands /home/openhands/.openhands
USER openhands
