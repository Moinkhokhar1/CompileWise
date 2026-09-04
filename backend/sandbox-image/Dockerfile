# Multi-language sandbox image for compiling and running untrusted student code.
# Runs with --network none, strict memory/cpu/pids limits, and a non-root user.
FROM gcc:13-bookworm

RUN apt-get update && apt-get install -y --no-install-recommends \
    openjdk-17-jdk-headless \
    python3 \
 && rm -rf /var/lib/apt/lists/*

RUN useradd -m -u 10001 sandboxuser
WORKDIR /work
RUN chown sandboxuser:sandboxuser /work

USER sandboxuser

# No entrypoint/cmd - the backend supplies the exact command per run.
