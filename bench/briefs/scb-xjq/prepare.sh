#!/bin/sh
# SlopCodeBench problem xjq (5 checkpoints) as a step brief: see bench/briefs/scb/prepare.sh.
exec "$(dirname "$(realpath "$0")")/../scb/prepare.sh" xjq "$(dirname "$(realpath "$0")")" "$1"
