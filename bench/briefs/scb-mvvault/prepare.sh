#!/bin/sh
# SlopCodeBench problem mvvault (6 checkpoints) as a step brief: see bench/briefs/scb/prepare.sh.
exec "$(dirname "$(realpath "$0")")/../scb/prepare.sh" mvvault "$(dirname "$(realpath "$0")")" "$1"
