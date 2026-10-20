#!/bin/sh
# Checkpoint 3 checks: see bench/briefs/scb/checks/step.sh.
K=3 PROBLEM=mvvault . "$(dirname "$(realpath "$0")")/../../scb/checks/step.sh"
