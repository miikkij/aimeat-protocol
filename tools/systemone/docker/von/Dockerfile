# von (Apache 2.0) as a container: POST /v1/systemone on port 8000.
#
#   docker build --build-arg TORCH=cpu   -t aimeat-systemone/von:1.1.1-cpu   .
#   docker build --build-arg TORCH=cu128 -t aimeat-systemone/von:1.1.1-cu128 .
#
# The server comes from the PyPI package von-sdk (it carries `von serve`); the weights (wfzyx/von)
# are inside the image and the hub is switched off at run time. VON_DEVICE=cuda on the CUDA image.
ARG TORCH=cpu
FROM python:3.12-slim
ARG TORCH
ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1 HF_HOME=/opt/hf
RUN useradd -m -u 10001 app

RUN pip install "huggingface_hub>=1.0" \
 && python -c "from huggingface_hub import snapshot_download; print(snapshot_download('wfzyx/von'))" \
 && chown -R app /opt/hf

RUN pip install torch --index-url https://download.pytorch.org/whl/${TORCH}
RUN pip install "von-sdk==1.1.1"

ENV HF_HUB_OFFLINE=1 VON_DEVICE=cpu
USER app
WORKDIR /home/app
EXPOSE 8000
CMD ["sh", "-c", "exec von serve --host 0.0.0.0 --port 8000 --device \"$VON_DEVICE\""]
