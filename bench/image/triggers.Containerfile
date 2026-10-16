# Trigger eval image (#36): an arm image plus Python for the vendored skill-creator eval scripts (`run_eval.py` needs
# Python 3.10 or later; Debian 12 has 3.11). Built by bench/scripts/trigger-eval.sh from the arm image of run-brief.sh.
# podman build -f bench/image/triggers.Containerfile --build-arg ARM=<arm, lower case> -t benchkeeper-trig-<arm> .
ARG ARM
FROM localhost/benchkeeper-arm-${ARM}
USER root
RUN apt-get update && apt-get install -y --no-install-recommends python3=3.11.2-1+b1 && rm -rf /var/lib/apt/lists/*
USER node
