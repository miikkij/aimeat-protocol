# @file test/fixtures/party-engine-read.py
# @description What test/e2e-party-invite.ts asks DuckDB and pandas to read as an outside party with a
#   party token (canvas board Power-BI-Excel, rows DuckDB and pandas): DuckDB reads the CSV address with
#   an http secret holding the bearer token, and the Frictionless descriptor's relative path; pandas
#   reads the rows a page at a time, and the CSV of an earlier version. Prints one JSON line.
# @usage uv run --with duckdb --with pandas python -I party-engine-read.py <base> <token> <owner> <node> <pkg> <resource> <v1> <v2hex>
# @version-history
#   v1.0.0 — 2026-11-01 — Initial (WP9b).
import json
import sys
import urllib.request

import duckdb
import pandas as pd

base, token, owner, node, pkg, res, v1, v2hex = sys.argv[1:9]
auth = {"Authorization": f"Bearer {token}"}
out = {}

con = duckdb.connect()
con.execute("INSTALL httpfs; LOAD httpfs;")
con.execute(f"CREATE SECRET jako (TYPE http, BEARER_TOKEN '{token}')")
csv_url = f"{base}/v1/datapackages/{owner}/{pkg}/rows/{res}?format=csv"
out["duckdb_csv_rows"] = con.execute(f"SELECT count(*) FROM read_csv('{csv_url}')").fetchone()[0]
out["duckdb_csv_sum"] = con.execute(f"SELECT sum(amount) FROM read_csv('{csv_url}')").fetchone()[0]

# Frictionless: the permanent descriptor of the newest version, and its resource by its relative path.
root = f"{base}/v1/pub/{owner}@{node}/datapkg/{pkg}/{v2hex}"
req = urllib.request.Request(f"{root}/datapackage.json", headers=auth)
desc = json.loads(urllib.request.urlopen(req).read())
path = desc["resources"][0]["path"]
out["frictionless_path"] = path
out["duckdb_frictionless_rows"] = con.execute(f"SELECT count(*) FROM read_csv('{root}/{path}')").fetchone()[0]

# pandas: the rows a page at a time (offset and limit), then the CSV of the first version.
frames, offset, pages = [], 0, 0
while True:
    url = f"{base}/v1/datapackages/{owner}/{pkg}/rows/{res}?offset={offset}&limit=500"
    page = json.loads(urllib.request.urlopen(urllib.request.Request(url, headers=auth)).read())["data"]
    rows = page["rows"]
    if not rows:
        break
    frames.append(pd.DataFrame(rows))
    pages += 1
    offset += len(rows)
    if offset >= page["total"]:
        break
df = pd.concat(frames, ignore_index=True)
out["pandas_pages"] = pages
out["pandas_rows"] = len(df)
out["pandas_unique_ids"] = int(df["id"].nunique())
old = pd.read_csv(f"{csv_url}&version={v1}", storage_options=auth)
out["pandas_v1_rows"] = len(old)
print(json.dumps(out))
