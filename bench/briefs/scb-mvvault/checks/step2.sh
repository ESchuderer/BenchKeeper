#!/bin/sh
# Checkpoint 2 checks: see bench/briefs/scb/checks/step.sh.
K=2 PROBLEM=mvvault . "$(dirname "$(realpath "$0")")/../../scb/checks/step.sh"
