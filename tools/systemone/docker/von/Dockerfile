# von (Apache 2.0) as a container: POST /v1/systemone on port 8000.
#
#   docker build --build-arg TORCH=cpu   -t aimeat-systemone/von:1.1.1-cpu   .
#   docker build --build-arg TORCH=cu128 -t aimeat-systemone/von:1.1.1-cu128 .
#
# The server comes from the PyPI package von-sdk (it carries `von serve`); the weights (wfzyx/von)
# are inside the image and the hub is switched off at run time. VON_DEVICE=cuda on the CUDA image.
# Every package is installed from a hash-pinned lock (../lock.sh writes them from requirements.in),
# the weights are a fixed commit of wfzyx/von and the base image is pinned by digest, so a build
# gets exactly what was measured.
ARG TORCH=cpu
FROM python:3.12-slim@sha256:2f17fc044b579bab302c2e8054d3a686e2cb9a83de48e70534b94cd8ebbe06a9
ARG TORCH
ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1 HF_HOME=/opt/hf
RUN useradd -m -u 10001 app

# The weights at one commit: the von 1.1 weights this image was measured with, which von-sdk 1.1.1
# serves. The repository's newer commits carry the von 1.2.0 weights. von asks the cache for the
# default branch by name, and the hub is off at run time, so that name is pointed at the pinned
# commit: a download by commit writes no branch name, and without one the server does not start.
COPY hub.txt /tmp/req/hub.txt
RUN pip install --require-hashes -r /tmp/req/hub.txt \
 && python -c "import pathlib; from huggingface_hub import snapshot_download; rev = 'd8bb5e0745d8ee1fb65d536d6d4892d54d5a93fd'; p = pathlib.Path(snapshot_download('wfzyx/von', revision=rev)); (p.parents[1] / 'refs').mkdir(exist_ok=True); (p.parents[1] / 'refs' / 'main').write_text(rev); print(p)" \
 && chown -R app /opt/hf

# von-sdk 1.1.1 and torch.
COPY requirements-${TORCH}.txt /tmp/req/requirements.txt
RUN pip install --require-hashes -r /tmp/req/requirements.txt

ENV HF_HUB_OFFLINE=1 VON_DEVICE=cpu
USER app
WORKDIR /home/app
EXPOSE 8000
CMD ["sh", "-c", "exec von serve --host 0.0.0.0 --port 8000 --device \"$VON_DEVICE\""]
