/**
 * @file test/unit/check-supply-chain.test.ts
 * @description Proof that `pnpm check:supply-chain` refuses each shape it names and stays quiet for
 *   the shape the workflows and model files now have. The findings functions are pure, so every
 *   case is a file's text in and a list of findings out.
 * @usage cd aimeat && pnpm exec vitest run test/unit/check-supply-chain.test.ts
 * @version-history
 *   v1.1.0 — 2026-09-24 — The pip rules in every workflow step, whatever the job holds.
 *   v1.0.0 — 2026-09-24 — Initial, with the gate.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { commandFindings, composeFindings, modelFindings, scan, workflowFindings } from '../../scripts/check-supply-chain.js';

const PIN = '0000000000000000000000000000000000000000';
const SHA = 'a06c9096dcb9727c13555b6be26c7effa707b01f06a4c561ba7a3635443cf2cc';

const rules = (list: { rule: string }[]): string[] => [...new Set(list.map(f => f.rule))].sort();

const BAD_WORKFLOW = `name: bad
on: push
permissions:
  contents: write
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@${PIN} # v7
      - run: pnpm install --frozen-lockfile
      - name: Tool
        run: curl -sSfL https://github.com/example/tool/releases/latest/download/tool_linux_amd64.tar.gz | tar xz tool
      - name: Login
        run: ./tool login --key \${{ secrets.TOOL_KEY }}
`;

const GOOD_WORKFLOW = `name: good
on: push
permissions:
  contents: read
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@${PIN} # v7
        with:
          persist-credentials: false
      - run: pnpm install --frozen-lockfile
      - name: Tool
        run: |
          curl -sSfL -o tool.tar.gz https://github.com/example/tool/releases/download/v1.2.3/tool_linux_amd64.tar.gz
          echo "${SHA}  tool.tar.gz" | sha256sum -c -
          tar xzf tool.tar.gz tool
  publish:
    needs: build
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - uses: actions/download-artifact@${PIN} # v8
      - name: Login
        env:
          TOOL_KEY: \${{ secrets.TOOL_KEY }}
        run: ./tool login --key "$TOOL_KEY"
      - name: Ask the API
        env:
          API_KEY: \${{ secrets.API_KEY }}
        run: |
          curl --fail-with-body -sS -X POST https://api.example.com/v1/refresh \\
            -H "Authorization: Bearer $API_KEY"
`;

describe('check:supply-chain, workflows', () => {
  it('refuses every shape in a bad workflow, each on its own line', () => {
    const found = workflowFindings('.github/workflows/bad.yml', BAD_WORKFLOW);
    expect(rules(found)).toEqual(['checkout-credentials', 'latest-release', 'secret-and-deps', 'secret-in-run', 'unverified-download', 'write-and-deps']);
    const at = (rule: string) => found.filter(f => f.rule === rule).map(f => f.line);
    expect(at('checkout-credentials')).toEqual([9]);
    expect(at('write-and-deps')).toEqual([10]);
    expect(at('unverified-download')).toEqual([12]);
    expect(at('secret-in-run')).toEqual([14]);
    expect(found.find(f => f.rule === 'write-and-deps')?.fix).toContain('contents: write');
  });

  it('accepts the fixed shape: read-only build, checked download, secret through env, a writing job with no dependency code', () => {
    expect(workflowFindings('.github/workflows/good.yml', GOOD_WORKFLOW)).toEqual([]);
  });

  it('reads a job without permissions as the workflow\'s, and a workflow without any as able to write', () => {
    const job = (perm: string) => `on: push\n${perm}jobs:\n  j:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm ci\n`;
    expect(rules(workflowFindings('w.yml', job('permissions: write-all\n')))).toEqual(['write-and-deps']);
    expect(rules(workflowFindings('w.yml', job('')))).toEqual(['write-and-deps']);
    expect(workflowFindings('w.yml', job('permissions: read-all\n'))).toEqual([]);
    const override = 'on: push\npermissions:\n  issues: write\njobs:\n  j:\n    permissions: {}\n    runs-on: ubuntu-latest\n    steps:\n      - run: pnpm build\n';
    expect(workflowFindings('w.yml', override)).toEqual([]);
  });

  it('wants one sha256 literal per download in the step', () => {
    const wf = `on: push\npermissions: {}\njobs:\n  j:\n    runs-on: ubuntu-latest\n    steps:\n      - run: |\n          curl -sfL -o a.tar.gz https://example.com/a.tar.gz\n          curl -sfL -o b https://github.com/x/b/releases/download/v1/b_linux_amd64\n          echo "${SHA}  a.tar.gz" | sha256sum -c -\n`;
    const found = workflowFindings('w.yml', wf);
    expect(found.map(f => [f.rule, f.line])).toEqual([['unverified-download', 8], ['unverified-download', 9]]);
  });

  it('sees gh release download and a download through PowerShell', () => {
    const gh = `on: push\npermissions: {}\njobs:\n  j:\n    runs-on: ubuntu-latest\n    steps:\n      - run: |\n          gh release download v1 --repo x/y \\\n            --pattern tool.tar.zst --dir "$RUNNER_TEMP"\n`;
    expect(workflowFindings('w.yml', gh).map(f => [f.rule, f.line])).toEqual([['unverified-download', 8]]);
    const pwsh = `on: push\npermissions: {}\njobs:\n  j:\n    runs-on: windows-latest\n    steps:\n      - shell: pwsh\n        run: |\n          Invoke-WebRequest -Uri https://example.com/t.zip -OutFile t.zip\n          if ((Get-FileHash -Algorithm SHA256 t.zip).Hash -ne '${SHA}') { throw 'sha256' }\n`;
    expect(workflowFindings('w.yml', pwsh)).toEqual([]);
  });

  it('refuses a script piped into a shell, whatever else the step checks', () => {
    const wf = `on: push\npermissions: {}\njobs:\n  j:\n    runs-on: ubuntu-latest\n    steps:\n      - run: |\n          curl -fsSL https://example.com/install.sh | sh\n          echo "${SHA}  other.tar.gz" | sha256sum -c -\n`;
    expect(workflowFindings('w.yml', wf).map(f => [f.rule, f.line])).toEqual([['pipe-to-shell', 8]]);
  });

  it('holds the pip rules in every step, also in a job that can only read', () => {
    const job = (run: string) => `on: push\npermissions:\n  contents: read\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - run: |\n          ${run}\n`;
    const found = (run: string) => workflowFindings('w.yml', job(run)).map(f => [f.rule, f.line]);
    // Refused: a name without ==, a requirements file without hashes, a local install that fetches
    // what it needs, a build that fills its own environment, and a git+ address without a commit.
    expect(found('python -m pip install --upgrade pip build')).toEqual([['pip-unpinned', 9], ['pip-unpinned', 9]]);
    expect(found('pip install -r requirements.txt')).toEqual([['pip-unpinned', 9]]);
    expect(found('pip install -e ".[dev]"')).toEqual([['pip-unpinned', 9]]);
    expect(found('python -m build')).toEqual([['pip-unpinned', 9]]);
    expect(found('pip install git+https://github.com/x/y.git')).toEqual([['git-unpinned', 9]]);
    // Accepted: a hash-locked file, an exact version, a local install with everything already in
    // place, and a build in the environment the job filled.
    expect(found('python -m pip install --require-hashes --only-binary :all: -r requirements-ci.txt')).toEqual([]);
    expect(found('pip install semgrep==1.178.0')).toEqual([]);
    expect(found('python -m pip install --no-deps --no-build-isolation -e .')).toEqual([]);
    expect(found('python -m build --no-isolation')).toEqual([]);
    expect(workflowFindings('w.yml', job('pip install semgrep'))[0]?.fix).toMatch(/^job "build": pin "semgrep" with ==/);
  });
});

describe('check:supply-chain, the desktop runtime scripts', () => {
  const FILE = 'aimeat-desktop/src-tauri/resources/agent-runtime/provision.mjs';

  it('refuses the install script piped into PowerShell', () => {
    const js = "const r = await run('powershell', ['-NoProfile', '-Command', 'irm https://astral.sh/uv/install.ps1 | iex']);";
    expect(rules(commandFindings(FILE, js))).toEqual(['pipe-to-shell', 'unverified-download']);
  });

  it('accepts a fixed release checked against a sha256 in the file, and wants one literal per address', () => {
    const js = [
      "const UV_ZIP_SHA256 = '" + SHA + "';",
      'const res = await fetch(`https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/${UV_ZIP}`);',
      "if (createHash('sha256').update(zip).digest('hex') !== UV_ZIP_SHA256) return 'refused';",
    ].join('\n');
    expect(commandFindings(FILE, js)).toEqual([]);
    const second = js + '\nconst other = await fetch(`https://github.com/x/y/releases/download/v1/y.zip`);';
    expect(commandFindings(FILE, second).map(f => f.rule)).toEqual(['unverified-download', 'unverified-download']);
  });

  it('reads a clone from its argument list, not from a message that names one', () => {
    expect(commandFindings(FILE, "progress('fetch-fleet', 'error', (r.err || 'git clone failed').trim());")).toEqual([]);
    const clone = "const r = await run('git', ['clone', '--depth', '1', REPO, REPO_DIR]);";
    expect(rules(commandFindings(FILE, clone))).toEqual(['git-unpinned']);
    expect(commandFindings(FILE, `${clone}\nawait run('git', ['-C', REPO_DIR, 'checkout', '${PIN}']);`)).toEqual([]);
  });

  it('drops a finding its exemption covers, and refuses an exemption that covers nothing', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'supply-chain-'));
    try {
      const put = (rel: string, text: string) => {
        mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
        writeFileSync(path.join(root, rel), text);
      };
      put('.github/workflows/ok.yml', GOOD_WORKFLOW);
      put('tools/systemone/README.md', 'Local models.\n');
      put(FILE, "const r = await run('git', ['clone', '--depth', '1', REPO, REPO_DIR]);\n");
      expect(scan(root).findings).toEqual([]);
      put(FILE, "console.log('nothing is cloned here');\n");
      expect(scan(root).findings.map(f => f.rule)).toEqual(['exemption']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('check:supply-chain, tools/systemone', () => {
  it('wants a commit on every weights download', () => {
    const unpinned = `RUN python -c "from huggingface_hub import snapshot_download; snapshot_download('org/model')"`;
    const branch = `RUN python -c "from huggingface_hub import snapshot_download; snapshot_download('org/model', revision='main')"`;
    const pinned = `RUN python -c "from huggingface_hub import snapshot_download; snapshot_download('org/model', revision='${PIN}')"`;
    const named = `$dl = "rev = '${PIN}'; p = snapshot_download('org/model', revision=rev)"`;
    expect(rules(modelFindings('docker/x/Dockerfile', unpinned))).toEqual(['weights-revision']);
    expect(rules(modelFindings('docker/x/Dockerfile', branch))).toEqual(['weights-revision']);
    expect(modelFindings('docker/x/Dockerfile', pinned)).toEqual([]);
    expect(modelFindings('systemone.ps1', named)).toEqual([]);
  });

  it('reports the physical line inside a continued RUN command', () => {
    const df = `FROM python:3.12-slim\nRUN pip install --require-hashes -r hub.txt \\\n && python -c "from huggingface_hub import snapshot_download; snapshot_download('org/m')"\n`;
    expect(modelFindings('docker/x/Dockerfile', df).map(f => [f.rule, f.line])).toEqual([['weights-revision', 3]]);
  });

  it('refuses an unpinned pip install and accepts a pinned or hash-checked one', () => {
    expect(rules(modelFindings('systemone.ps1', "Invoke-Native 'x' { & $py -m pip install --upgrade 'laya[serve]' }"))).toEqual(['pip-unpinned']);
    expect(rules(modelFindings('systemone.ps1', 'Invoke-Native "x" { & $py -m pip install --upgrade $src }'))).toEqual(['pip-unpinned']);
    expect(rules(modelFindings('docker/x/Dockerfile', 'RUN pip install -r req.txt'))).toEqual(['pip-unpinned']);
    expect(modelFindings('docker/x/Dockerfile', 'RUN pip install --require-hashes -r /tmp/req/requirements.txt')).toEqual([]);
    expect(modelFindings('systemone.ps1', "Invoke-Native 'x' { & $py -m pip install --quiet --constraint $c --extra-index-url $Index 'laya[serve]==0.3.11' }")).toEqual([]);
  });

  it('wants a clone checked out at a commit, and a git+ address pinned to one', () => {
    expect(rules(modelFindings('systemone.ps1', 'git clone --depth 1 https://github.com/x/jeff $src'))).toEqual(['git-unpinned']);
    expect(modelFindings('systemone.ps1', `git clone https://github.com/x/jeff $src\ngit -C $src checkout --quiet ${PIN}`)).toEqual([]);
    expect(rules(modelFindings('systemone.ps1', "& $py -m pip install 'git+https://github.com/x/von.git'"))).toEqual(['git-unpinned']);
    expect(modelFindings('systemone.ps1', `& $py -m pip install 'git+https://github.com/x/von.git@${PIN}'`)).toEqual([]);
  });

  it('refuses a fixed or empty model key, in code, in commands and in a compose file', () => {
    expect(rules(modelFindings('systemone.ps1', "  jeff = @{ Port = 8803; Model = 'm'; Auth = 'devkey' }"))).toEqual(['model-key']);
    expect(rules(modelFindings('systemone.ps1', "  laya = @{ Port = 8801; Model = 'm'; Auth = '' }"))).toEqual(['model-key']);
    expect(rules(modelFindings('systemone.ps1', "    JEFF_HOST = '127.0.0.1'; JEFF_API_KEYS = 'devkey'"))).toEqual(['model-key']);
    expect(rules(modelFindings('README.md', 'JEFF_API_KEYS=devkey docker compose up -d --build'))).toEqual(['model-key']);
    expect(rules(modelFindings('README.md', '8803 and the header `Authorization: Bearer devkey`.'))).toEqual(['model-key']);
    expect(modelFindings('systemone.ps1', '    $envs[$keyVar] = $key; JEFF_API_KEYS = $key')).toEqual([]);
    expect(modelFindings('README.md', 'AIMEAT_DECIDE_JEFF_KEY=<the value of JEFF_API_KEYS in .env>')).toEqual([]);
    expect(modelFindings('systemone.ps1', '$headers[\'Authorization\'] = "Bearer $key"')).toEqual([]);

    const compose = (laya: string) => `services:\n  laya:\n    image: x\n    environment:\n      ${laya}\n    ports: ["127.0.0.1:8801:8000"]\n  jeff:\n    image: y\n    environment:\n      JEFF_API_KEYS: "\${JEFF_API_KEYS:?set JEFF_API_KEYS}"\n    ports: ["127.0.0.1:8803:8000"]\n`;
    expect(composeFindings('docker/compose.yaml', compose('LAYA_DEVICE: cpu')).map(f => [f.rule, f.line])).toEqual([['model-key', 2]]);
    expect(composeFindings('docker/compose.yaml', compose('LAYA_API_KEY: "${LAYA_API_KEY:?set LAYA_API_KEY}"'))).toEqual([]);
    expect(modelFindings('docker/compose.yaml', compose('LAYA_API_KEY: "${LAYA_API_KEY:?set LAYA_API_KEY}"'))).toEqual([]);
    const override = 'services:\n  laya:\n    build: { context: ./laya }\n    environment: { LAYA_DEVICE: cuda }\n';
    expect(composeFindings('docker/compose.gpu.yaml', override)).toEqual([]);
  });

  it('reads past comments for the commands, and not for the keys', () => {
    expect(modelFindings('docker/x/Dockerfile', '# pip install torch, the old way\nFROM x')).toEqual([]);
    expect(rules(modelFindings('docker/compose.yaml', '#   CPU:  JEFF_API_KEYS=devkey docker compose up -d --build'))).toEqual(['model-key']);
  });
});
