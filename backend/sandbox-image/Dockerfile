# Minimal, locked-down image used ONLY to compile/run untrusted student C code.
# Runs with --network none, strict memory/cpu/pids limits, and a non-root user.
FROM gcc:13-bookworm

RUN useradd -m -u 10001 sandboxuser
WORKDIR /work
RUN chown sandboxuser:sandboxuser /work

USER sandboxuser

# No entrypoint/cmd - the backend supplies the exact command per run
# (compile step, then execute step) via `docker run --rm ...`.
