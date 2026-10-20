#!/bin/sh
# Checkpoint 1 checks: see bench/briefs/scb/checks/step.sh.
K=1 PROBLEM=mvvault . "$(dirname "$(realpath "$0")")/../../scb/checks/step.sh"
