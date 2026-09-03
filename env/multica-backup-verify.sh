#!/usr/bin/env bash
set -euo pipefail

umask 077

NAMESPACE="${MULTICA_NAMESPACE:-multica}"
BACKUP_ROOT="${MULTICA_BACKUP_ROOT:-/home/multica-backups}"
LATEST_DIR="$(readlink -f "${BACKUP_ROOT}/latest")"
RESTORE_DB="multica_restore_verify_$(date +%Y%m%d_%H%M%S)"

if [[ -z "${LATEST_DIR}" || "${LATEST_DIR}" != "${BACKUP_ROOT}/"* ]]; then
  echo "Latest backup does not resolve below ${BACKUP_ROOT}" >&2
  exit 1
fi

cleanup() {
  kubectl -n "${NAMESPACE}" exec -c postgres deploy/multica-postgres -- \
    sh -c "export PGPASSWORD=\"\$POSTGRES_PASSWORD\"; \
      dropdb -U multica --if-exists '${RESTORE_DB}'" >/dev/null 2>&1 || true
}
trap cleanup EXIT

(
  cd "${LATEST_DIR}"
  sha256sum -c SHA256SUMS
)
tar -tzf "${LATEST_DIR}/uploads.tar.gz" >/dev/null

ETCDCTL="${ETCDCTL:-/opt/kube/bin/etcdctl}"
ETCDCTL_API=3 "${ETCDCTL}" snapshot status "${LATEST_DIR}/etcd.snapshot" \
  --write-out=table

kubectl -n "${NAMESPACE}" exec -c postgres deploy/multica-postgres -- \
  sh -c "export PGPASSWORD=\"\$POSTGRES_PASSWORD\"; \
    createdb -U multica '${RESTORE_DB}'"

kubectl -n "${NAMESPACE}" exec -i -c postgres deploy/multica-postgres -- \
  sh -c "export PGPASSWORD=\"\$POSTGRES_PASSWORD\"; \
    pg_restore --exit-on-error --no-owner --no-acl \
      -U multica -d '${RESTORE_DB}'" \
  <"${LATEST_DIR}/multica.dump"

RESTORED_COUNTS="$(
  kubectl -n "${NAMESPACE}" exec -c postgres deploy/multica-postgres -- \
    sh -c "export PGPASSWORD=\"\$POSTGRES_PASSWORD\"; \
      psql -U multica -d '${RESTORE_DB}' -Atqc \"
        SELECT json_build_object(
          'tables', (SELECT count(*) FROM pg_tables WHERE schemaname = 'public'),
          'migrations', (SELECT count(*) FROM schema_migrations),
          'users', (SELECT count(*) FROM \\\"user\\\"),
          'workspaces', (SELECT count(*) FROM workspace),
          'issues', (SELECT count(*) FROM issue),
          'attachments', (SELECT count(*) FROM attachment)
        );\""
)"

kubectl -n "${NAMESPACE}" exec -c postgres deploy/multica-postgres -- \
  sh -c "export PGPASSWORD=\"\$POSTGRES_PASSWORD\"; \
    dropdb -U multica '${RESTORE_DB}'"
trap - EXIT

echo "Multica backup restore verification passed: ${RESTORED_COUNTS}"
