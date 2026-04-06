#!/usr/bin/env bash
# Compare variable names in .env.example vs .env (values are ignored).
# Usage: from repo root, ./scripts/check-env-keys.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXAMPLE="${REPO_ROOT}/.env.example"
LOCAL="${REPO_ROOT}/.env"

extract_keys() {
  local file="$1"
  while IFS= read -r line || [[ -n "${line}" ]]; do
    [[ -z "${line//[[:space:]]/}" ]] && continue
    [[ "${line}" =~ ^[[:space:]]*# ]] && continue
    [[ "${line}" != *"="* ]] && continue
    local key="${line%%=*}"
    key="${key#"${key%%[![:space:]]*}"}"
    key="${key%"${key##*[![:space:]]}"}"
    [[ -z "${key}" ]] && continue
    printf '%s\n' "${key}"
  done < "${file}" | sort -u
}

if [[ ! -f "${EXAMPLE}" ]]; then
  echo "error: missing ${EXAMPLE}" >&2
  exit 1
fi

keys_example_file="$(mktemp)"
keys_local_file="$(mktemp)"
trap 'rm -f "${keys_example_file}" "${keys_local_file}"' EXIT

extract_keys "${EXAMPLE}" > "${keys_example_file}"

if [[ ! -f "${LOCAL}" ]]; then
  echo "Note: ${LOCAL} not found (create from .env.example for local dev)."
  echo "Keys in .env.example ($(wc -l < "${keys_example_file}" | tr -d ' ')):"
  sed 's/^/  /' "${keys_example_file}"
  exit 0
fi

extract_keys "${LOCAL}" > "${keys_local_file}"

missing="$(comm -23 "${keys_example_file}" "${keys_local_file}" || true)"
extra="$(comm -13 "${keys_example_file}" "${keys_local_file}" || true)"

echo "Compared keys: .env.example vs .env"

if [[ -n "${missing}" ]]; then
  echo ""
  echo "Missing in .env (present in .env.example):"
  sed 's/^/  /' <<< "${missing}"
fi

if [[ -n "${extra}" ]]; then
  echo ""
  echo "Extra in .env (not in .env.example):"
  sed 's/^/  /' <<< "${extra}"
fi

if [[ -z "${missing}" && -z "${extra}" ]]; then
  echo "OK: keys match (same set of variable names)."
  exit 0
fi

exit 1
