# von (Apache 2.0) as a container: POST /v1/systemone on port 8000.
#
#   docker build --build-arg TORCH=cpu   -t aimeat-systemone/von:1.1.1-cpu   .
#   docker build --build-arg TORCH=cu128 -t aimeat-systemone/von:1.1.1-cu128 .
#
# The server comes from the PyPI package von-sdk (it carries `von serve`); the weights (wfzyx/von)
# are inside the image and the hub is switched off at run time. VON_DEVICE=cuda on the CUDA image.
# Every package is installed from a hash-pinned lock (../lock.sh writes them from requirements.in)
# and the base image is pinned by digest, so a build gets exactly what was measured.
ARG TORCH=cpu
FROM python:3.12-slim@sha256:2f17fc044b579bab302c2e8054d3a686e2cb9a83de48e70534b94cd8ebbe06a9
ARG TORCH
ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1 HF_HOME=/opt/hf
RUN useradd -m -u 10001 app

COPY hub.txt /tmp/req/hub.txt
RUN pip install --require-hashes -r /tmp/req/hub.txt \
 && python -c "from huggingface_hub import snapshot_download; print(snapshot_download('wfzyx/von'))" \
 && chown -R app /opt/hf

# von-sdk 1.1.1 and torch.
COPY requirements-${TORCH}.txt /tmp/req/requirements.txt
RUN pip install --require-hashes -r /tmp/req/requirements.txt

ENV HF_HUB_OFFLINE=1 VON_DEVICE=cpu
USER app
WORKDIR /home/app
EXPOSE 8000
CMD ["sh", "-c", "exec von serve --host 0.0.0.0 --port 8000 --device \"$VON_DEVICE\""]
