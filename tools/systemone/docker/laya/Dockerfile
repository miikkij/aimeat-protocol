# Laya (Apache 2.0, Convai Innovations) as a container: POST /v1/systemone on port 8000.
#
#   docker build --build-arg TORCH=cpu   -t aimeat-systemone/laya:0.3.11-cpu   .
#   docker build --build-arg TORCH=cu130 -t aimeat-systemone/laya:0.3.11-cu130 .
#
# The weights (all three checkpoints) are inside the image and the hub is switched off at run time,
# so the container needs no network to start. The weights layer comes before torch, so the CPU and
# the CUDA image share it. LAYA_DEVICE=cuda at run time on the CUDA image.
# Every package is installed from a hash-pinned lock (../lock.sh writes them from requirements.in),
# the weights are a fixed commit of convaiinnovations/laya and the base image is pinned by digest,
# so a build gets exactly what was measured.
ARG TORCH=cpu
FROM python:3.12-slim@sha256:12316debbfb86890f6b2d825820612741ba527ad5a44e3902759141d572bfe8f
ARG TORCH
ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1 HF_HOME=/opt/hf
RUN useradd -m -u 10001 app

# pip before 26.2.2 trusts the compromised emSign intermediates through its own copy of certifi
# (the PSF notice of 2026-10-20), and the base image still carries an older one.
COPY pip.txt /tmp/req/pip.txt
RUN pip install --require-hashes -r /tmp/req/pip.txt

# The weights at one commit. laya-serve asks the cache for the default branch by name, and the hub
# is off at run time, so that name is pointed at the pinned commit: a download by commit writes no
# branch name, and without one the server does not start.
COPY hub.txt /tmp/req/hub.txt
RUN pip install --require-hashes -r /tmp/req/hub.txt \
 && python -c "import pathlib; from huggingface_hub import snapshot_download; rev = '55cf4c4ebb4ebe31b2550e8bdf3bd21b99753851'; p = pathlib.Path(snapshot_download('convaiinnovations/laya', revision=rev)); (p.parents[1] / 'refs').mkdir(exist_ok=True); (p.parents[1] / 'refs' / 'main').write_text(rev); print(p)" \
 && chown -R app /opt/hf

# laya 0.3.11 (0.3.7 was withdrawn from PyPI on 2026-09-23; 0.3.11 answers the same) and torch.
COPY requirements-${TORCH}.txt /tmp/req/requirements.txt
RUN pip install --require-hashes -r /tmp/req/requirements.txt

ENV HF_HUB_OFFLINE=1 LAYA_HOST=0.0.0.0 LAYA_PORT=8000 LAYA_PRELOAD=1 LAYA_DEVICE=cpu
USER app
EXPOSE 8000
CMD ["laya-serve"]
