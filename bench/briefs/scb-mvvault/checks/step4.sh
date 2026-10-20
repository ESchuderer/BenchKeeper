#!/bin/sh
# Checkpoint 4 checks: see bench/briefs/scb/checks/step.sh.
K=4 PROBLEM=mvvault . "$(dirname "$(realpath "$0")")/../../scb/checks/step.sh"
