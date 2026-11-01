# Pull research implementation status

The implementation is in progress under the active user goal. Do not mark it
complete based on unit tests or an empty library screen.

Implemented source: generic company registry and NSE resolution; six seed
companies; migration-owned document/version/chunk/job/question tables and FTS5;
streamed private R2 originals and extracted page artifacts; leased preparation
and question protocols; internal coverage/search/read tools; atomic index
publication; question evidence retrieval and source-version cache invalidation;
bounded model-answer validation; new /research UI with original desk retained at
/research/reliance and legacy API aliases.

The Python VM worker uses Poppler page batches and bounded optional OCR. No MCP,
local embedding model, Docling or MarkItDown dependency is required. Conversion
subprocesses have memory/CPU/file-size limits. The systemd service has 192 MiB
MemoryHigh, 256 MiB MemoryMax, 128 MiB swap limit, one job at a time, one CPU quota
and an available-memory guard. Model execution is disabled by default and the
existing sign-out is preserved.

Evidence so far: real 360-page TCS annual report processed completely on the VM
in about 5.1 seconds, with 26.1 MiB parent and 20.8 MiB child peak RSS. Eight Linux
worker tests pass. Research protocol/SQLite/FTS tests and existing portfolio
tests pass; type checks and an initial production build pass. Local migration
has been applied. Local preview is running at http://127.0.0.1:5173/research.

Still required: finish real-source selection checks; publish current source and
R2/schema changes; install/enable protected service; bootstrap and verify all six
company libraries with actual documents; exercise an unseeded ticker; verify
search/evidence/caching/recovery and mobile UI against real data; review resource
limits and observed usage under service; verify model answer path with authorised
model access (currently deliberately signed out); record deployment, tests,
coverage gaps and operations/rollback instructions. Do not restore authentication
without the owner taking the required sign-in action.
