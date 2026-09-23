# Laya (Apache 2.0, Convai Innovations) as a container: POST /v1/systemone on port 8000.
#
#   docker build --build-arg TORCH=cpu   -t aimeat-systemone/laya:0.3.11-cpu   .
#   docker build --build-arg TORCH=cu128 -t aimeat-systemone/laya:0.3.11-cu128 .
#
# The weights (all three checkpoints) are inside the image and the hub is switched off at run time,
# so the container needs no network to start. The weights layer comes before torch, so the CPU and
# the CUDA image share it. LAYA_DEVICE=cuda at run time on the CUDA image.
ARG TORCH=cpu
FROM python:3.12-slim
ARG TORCH
ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1 HF_HOME=/opt/hf
RUN useradd -m -u 10001 app

RUN pip install "huggingface_hub>=1.0" \
 && python -c "from huggingface_hub import snapshot_download; print(snapshot_download('convaiinnovations/laya'))" \
 && chown -R app /opt/hf

RUN pip install torch --index-url https://download.pytorch.org/whl/${TORCH}
# 0.3.7 was withdrawn from PyPI on 2026-09-23; 0.3.11 answers the same.
RUN pip install "laya[serve]==0.3.11"

ENV HF_HUB_OFFLINE=1 LAYA_HOST=0.0.0.0 LAYA_PORT=8000 LAYA_PRELOAD=1 LAYA_DEVICE=cpu
USER app
EXPOSE 8000
CMD ["laya-serve"]
