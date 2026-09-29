# shellcheck shell=bash
#
# The quality gates each release script runs, in the order it runs them.
# `typecheck` builds first.
#
# Sourced by npm-publish.sh, docker-build-push.sh and release.sh. release.sh
# runs the union of the two lists once and then both scripts with
# --skip-gates, so a gate added to either list here is one it runs too.

# shellcheck disable=SC2034 # read by the scripts that source this file
readonly NPM_GATES=(lint format:check typecheck test test:11ty)
# shellcheck disable=SC2034
readonly DOCKER_GATES=(lint format:check typecheck test)
