# Entry point for the scripts in scripts/ and infrastructure/. Run `just` to list recipes.

# Pass arguments through as "$@", so quoted ones (like an ssh command) stay one argument.
set positional-arguments
set quiet

[private]
default:
    @just --list --unsorted

# Backend on :5000 + Vite on :5173; Ctrl+C stops both
dev:
    scripts/dev.sh

# Every local check; --no-browser skips smoke + a11y
test *args:
    scripts/test.sh "$@"

# Format every file (Ruff + Prettier)
format:
    scripts/format.sh

alias fmt := format

# Check doc links, and doc names/headings cited in code
check-docs:
    scripts/check-docs.sh

# Regenerate the PNG/ICO icons from frontend/public/favicon.svg
icons:
    scripts/gen-icons.sh

# Deploy origin/main to production
[confirm("Deploy origin/main to production? [y/N]")]
deploy:
    scripts/deploy.sh

# Terraform with the Cloudflare token loaded, e.g. `just tf plan`
[working-directory('infrastructure')]
tf *args:
    ./tf.sh "$@"

# Shell (or a command) on the VM over IAP
ssh *args:
    infrastructure/ssh.sh "$@"

# VM scripts + swap ordering in local containers (~5 min; Docker)
test-infra:
    infrastructure/test/run.sh
