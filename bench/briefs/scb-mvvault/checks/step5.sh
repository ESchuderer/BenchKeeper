#!/bin/sh
# Checkpoint 5 checks: see bench/briefs/scb/checks/step.sh.
K=5 PROBLEM=mvvault . "$(dirname "$(realpath "$0")")/../../scb/checks/step.sh"
