# Shelters and camps in Danish off-leash dog forests.
# Python side runs under uv; the UI under node, pinned by mise.

set positional-arguments

# Go through mise explicitly so the pinned node is used whether or not the
# calling shell has mise activated.
npm := "mise exec -- npm"

# List the recipes.
default:
    @just --list

# Install both toolchains.
setup:
    mise install
    uv sync
    {{npm}} --prefix ui install

# Stage 1: find the facilities near dog forests. Slow; rarely needs rerunning.
discover *ARGS:
    uv run hundeskove discover "$@"

# Stage 2: refresh which nights are free. Fast; run this often.
availability *ARGS:
    uv run hundeskove availability "$@"

# Both stages.
data *ARGS:
    uv run hundeskove run "$@"

# Vite dev server with hot reload; reads output/ directly.
dev:
    {{npm}} --prefix ui run dev

# Type-check and build the UI into ui/dist.
build:
    {{npm}} --prefix ui run build

# Serve the built UI plus the data on one origin.
serve *ARGS: build
    uv run hundeskove serve "$@"

# Cold start: fetch everything, build, serve.
ui: data build serve

# Run both test suites.
test *ARGS:
    uv run --group dev pytest "$@"
    {{npm}} --prefix ui run test

# Type-check, run both suites, and re-check the generated output.
# The two parity steps run the real pipeline logic over the data actually on
# disk; the unit suites use fixtures and stay deterministic.
check:
    {{npm}} --prefix ui run typecheck
    just test
    uv run python scripts/check_outputs.py
    {{npm}} --prefix ui run parity

# Drop generated output and the UI build. Keeps cache/, which is slow to rebuild.
clean:
    rm -rf output ui/dist
