# jeff (MIT) as a container: POST /v1/systemone on port 8000, GLiFormer underneath.
#
#   docker build --build-arg TORCH=cpu   -t aimeat-systemone/jeff:0.1.0-cpu   .
#   docker build --build-arg TORCH=cu128 -t aimeat-systemone/jeff:0.1.0-cu128 .
#
# jeff is not on PyPI, so the source comes from the repository at a fixed commit. No key is baked
# in: JEFF_API_KEYS is given at run time, and the server refuses calls without one.
# JEFF_DEVICE=cuda on the CUDA image. On the CPU image, JEFF_BACKEND=onnx JEFF_QUANT=int8 switches
# on jeff's own CPU arm, which gives the same answers as the torch one and is much faster.
# Every package is installed from a hash-pinned lock (../lock.sh writes them from requirements.in),
# jeff's source is a fixed commit, and the base image is pinned by digest.
FROM python:3.12-slim@sha256:2f17fc044b579bab302c2e8054d3a686e2cb9a83de48e70534b94cd8ebbe06a9 AS src
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates \
 && git clone https://github.com/logan-markewich/jeff /src \
 && git -C /src checkout 34b32f99a727c47b679adde33f4702a001e02979 \
 && rm -rf /src/.git

ARG TORCH=cpu
FROM python:3.12-slim@sha256:2f17fc044b579bab302c2e8054d3a686e2cb9a83de48e70534b94cd8ebbe06a9
ARG TORCH
ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1
RUN useradd -m -u 10001 app

COPY hub.txt /tmp/req/hub.txt
RUN pip install --require-hashes -r /tmp/req/hub.txt \
 && python -c "from huggingface_hub import snapshot_download; snapshot_download('knowledgator/gliformer-large-v1', local_dir='/opt/models/gliformer-large-v1')" \
 && chown -R app /opt/models

# jeff's dependencies, ONNX, torch and jeff's build backend, all from the lock. jeff itself then
# installs from its source with nothing fetched.
COPY requirements-${TORCH}.txt /tmp/req/requirements.txt
RUN pip install --require-hashes -r /tmp/req/requirements.txt
COPY --from=src /src /opt/jeff-src
RUN pip install --no-deps --no-build-isolation /opt/jeff-src
# The CPU image also carries the encoder exported to ONNX, fp32 and int8.
RUN if [ "$TORCH" = cpu ]; then \
      python /opt/jeff-src/scripts/export_onnx.py /opt/models/gliformer-large-v1 --int8 \
      && chown -R app /opt/models/gliformer-large-v1/onnx; \
    fi

ENV HF_HUB_OFFLINE=1 JEFF_HOST=0.0.0.0 JEFF_PORT=8000 \
    JEFF_MODEL=/opt/models/gliformer-large-v1 JEFF_MODEL_NAME=gliformer-large-v1
USER app
EXPOSE 8000
CMD ["jeff"]
