# Laya (Apache 2.0, Convai Innovations) as a container: POST /v1/systemone on port 8000.
#
#   docker build --build-arg TORCH=cpu   -t aimeat-systemone/laya:0.3.11-cpu   .
#   docker build --build-arg TORCH=cu128 -t aimeat-systemone/laya:0.3.11-cu128 .
#
# The weights (all three checkpoints) are inside the image and the hub is switched off at run time,
# so the container needs no network to start. The weights layer comes before torch, so the CPU and
# the CUDA image share it. LAYA_DEVICE=cuda at run time on the CUDA image.
# Every package is installed from a hash-pinned lock (../lock.sh writes them from requirements.in)
# and the base image is pinned by digest, so a build gets exactly what was measured.
ARG TORCH=cpu
FROM python:3.12-slim@sha256:2f17fc044b579bab302c2e8054d3a686e2cb9a83de48e70534b94cd8ebbe06a9
ARG TORCH
ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1 HF_HOME=/opt/hf
RUN useradd -m -u 10001 app

COPY hub.txt /tmp/req/hub.txt
RUN pip install --require-hashes -r /tmp/req/hub.txt \
 && python -c "from huggingface_hub import snapshot_download; print(snapshot_download('convaiinnovations/laya'))" \
 && chown -R app /opt/hf

# laya 0.3.11 (0.3.7 was withdrawn from PyPI on 2026-09-23; 0.3.11 answers the same) and torch.
COPY requirements-${TORCH}.txt /tmp/req/requirements.txt
RUN pip install --require-hashes -r /tmp/req/requirements.txt

ENV HF_HUB_OFFLINE=1 LAYA_HOST=0.0.0.0 LAYA_PORT=8000 LAYA_PRELOAD=1 LAYA_DEVICE=cpu
USER app
EXPOSE 8000
CMD ["laya-serve"]
