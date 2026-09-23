# Local decision models (System One)

Three open decision models that answer the node's decision questions on your own machine: no key,
no cost, and the content does not leave the machine. All three serve `POST /v1/systemone`, the same
request the node sends to TypeSafe's Jev, so the node uses them as **decision providers**.

| Model | Licence | Port | Reads Finnish content | Note |
|---|---|---|---|---|
| Laya 0.3.11 (multilingual checkpoint) | Apache 2.0 | 8801 | yes | the fastest on a CPU |
| von 1.1.1 | Apache 2.0 | 8802 | no | |
| jeff 0.1.0 (GLiFormer) | MIT | 8803 | yes | carries 60 options; wants a bearer key |

The ports are the ones the node's built-in providers `laya`, `von` and `jeff` expect.

Two ways to run them:

- **Docker** (`docker/`): one command, CPU or GPU, weights inside the images. Use this.
- **Windows without Docker** (`systemone.ps1`): a Python virtual environment per model.

## Docker

Needs Docker with Compose. For the GPU: an NVIDIA card and the NVIDIA container runtime.

```bash
cd tools/systemone/docker

# CPU: build and start all three (the first build downloads about 8 GB of weights and libraries)
JEFF_API_KEYS=devkey docker compose up -d --build

# GPU instead
JEFF_API_KEYS=devkey docker compose -f compose.yaml -f compose.gpu.yaml up -d --build

# only one of them
JEFF_API_KEYS=devkey docker compose up -d --build laya

docker compose ps          # what runs
docker compose logs -f     # what they say
docker compose down        # stop and remove the containers (the images stay)
```

`JEFF_API_KEYS` is jeff's bearer key; the node sends the same value as `AIMEAT_DECIDE_JEFF_KEY`.
Use a real secret anywhere but your own machine. Compose refuses to start without it.

Other ports: `LAYA_PORT=9801 VON_PORT=9802 JEFF_PORT=9803 docker compose up -d`. The containers
listen on `127.0.0.1` only.

### Check that one answers

```bash
curl -s http://127.0.0.1:8801/v1/systemone -H 'content-type: application/json' -d '{
  "model": "multilingual",
  "state": {"body": "We were billed twice for March and would like a refund today."},
  "questions": {
    "dept": {"type": "choice", "instructions": "Which team should handle this?",
             "criteria": {"billing": "refunds and invoices", "tech": "bugs", "other": "anything else"}},
    "refund": {"type": "noul", "instructions": "The customer asks for money back."}
  }
}'
```

von takes `"model": "von-1.1.0"` on port 8802. jeff takes `"model": "gliformer-large-v1"` on port
8803 and the header `Authorization: Bearer devkey`. Questions are always in English; the content
may be in another language for Laya and jeff.

### What they take (measured 2026-09-23, CPU image capped to 4 cores)

| | Laya | von | jeff |
|---|---|---|---|
| Image, CPU / CUDA | 3.6 / 9.7 GB | 4.4 / 10.5 GB | 7.0 / 10.0 GB |
| Memory when running (CPU) | 4.8 GB | 1.8 GB | 4.5 GB |
| Start to first answer | 10 s | 10 s | 13 s |
| One decision, 4 CPU cores | about 0.6 s | about 1.5 s | about 0.14 s |
| One decision, RTX 4090 | about 22 ms | about 42 ms | about 40 ms |

The answers are the same on the CPU and the GPU; only the time changes. jeff's CPU figure is its
ONNX int8 arm, which compose.yaml switches on for the CPU image (`JEFF_BACKEND=onnx`); its torch arm
takes about 1.7 s on the same 4 cores.

## Connecting a node

The node reaches a model on its own machine only when you name the model's exact address in
`AIMEAT_DECIDE_PROVIDER_EGRESS`. That permission covers the decision call and nothing else.

```bash
# the built-in providers, pointed at the ports above
AIMEAT_DECIDE_BUILTIN_PROVIDERS=laya,von,jeff
AIMEAT_DECIDE_PROVIDER_EGRESS=http://127.0.0.1:8801,http://127.0.0.1:8802,http://127.0.0.1:8803
AIMEAT_DECIDE_JEFF_KEY=devkey
# optional: what an owner who chose no provider gets
AIMEAT_DECIDE_DEFAULT_PROVIDER=laya
```

Restart the node. `GET /v1/ai/decide/providers` then lists them, and a call picks one with
`provider: "laya"`, or the owner chooses a default in the settings.

On a development machine `AIMEAT_ALLOW_PRIVATE_EGRESS=true` also works, but it opens the machine's
loopback to every fetch the server makes. **A public node never sets it**; it uses the list above.

### The node in Docker too

When the node runs in the same Compose project or Docker network, leave the ports unpublished and
name the containers instead. The built-in providers point at 127.0.0.1, so describe the providers
yourself in `AIMEAT_DECIDE_PROVIDERS` (auth `none`, or `env` naming the variable that holds jeff's
key), with the limits the built-ins carry (`aimeat/src/services/decide/providers.ts`):

```bash
AIMEAT_DECIDE_PROVIDER_EGRESS=http://laya:8000,http://jeff:8000
AIMEAT_DECIDE_PROVIDERS='[
  {"id":"laya","title":"Laya (local, multilingual)","kind":"local","url":"http://laya:8000/v1/systemone",
   "model":"multilingual","auth":{"type":"none"},"adapter":"laya",
   "limits":{"context_tokens":1024,"max_choice_options":20}},
  {"id":"jeff","title":"jeff (local, GLiFormer)","kind":"local","url":"http://jeff:8000/v1/systemone",
   "model":"gliformer-large-v1","auth":{"type":"env","env":"AIMEAT_DECIDE_JEFF_KEY"},
   "limits":{"context_tokens":5000,"max_choice_options":60}}
]'
```

The node refuses an owner's own provider at any of these addresses: only the operator's models use
the list.

## Windows without Docker

From `tools/systemone` in PowerShell. Needs Python 3.12 (`py -3.12`); with an NVIDIA card it installs
the CUDA build of torch.

```powershell
.\systemone.ps1 install all    # a virtual environment and the weights per model, under .runtime\
.\systemone.ps1 up all         # start them on 8801, 8802 and 8803
.\systemone.ps1 status         # which are up
.\systemone.ps1 smoke laya     # one real call, prints the answer
.\systemone.ps1 down all       # stop them
```

Each command takes `laya`, `von`, `jeff` or `all`. Everything stays under `.runtime\` (gitignored,
several GB). jeff's key is `devkey` here.

## Measuring

`scripts/measure.mjs` sends the same set of calls to each model and writes what it found: the option
ceiling, how much text it reads, whether it gives a confidence, Finnish content and time per call.

```bash
node tools/systemone/scripts/measure.mjs tools/systemone/results/measure.json            # all three on 8801-8803
node tools/systemone/scripts/measure.mjs tools/systemone/results/measure.json laya       # one of them
SYSTEMONE_PORTS=9801,9802,9803 node tools/systemone/scripts/measure.mjs tools/systemone/results/other-ports.json
```

A number you measure goes into the provider's limits (`providers.ts`), never a guess.
