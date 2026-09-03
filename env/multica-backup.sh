#!/usr/bin/env bash
set -euo pipefail

umask 077

NAMESPACE="${MULTICA_NAMESPACE:-multica}"
BACKUP_ROOT="${MULTICA_BACKUP_ROOT:-/home/multica-backups}"
RETENTION_DAYS="${MULTICA_BACKUP_RETENTION_DAYS:-14}"
STAMP="$(date +%Y%m%d-%H%M%S)"
PARTIAL_DIR="${BACKUP_ROOT}/.partial-${STAMP}"
FINAL_DIR="${BACKUP_ROOT}/${STAMP}"
LOCK_FILE="/run/lock/multica-backup.lock"

if [[ "${BACKUP_ROOT}" != /* || "${BACKUP_ROOT}" == "/" ]]; then
  echo "MULTICA_BACKUP_ROOT must be an absolute non-root path" >&2
  exit 1
fi

for command_name in kubectl tar sha256sum flock; do
  command -v "${command_name}" >/dev/null
done

exec 9>"${LOCK_FILE}"
if ! flock -n 9; then
  echo "Another Multica backup is already running"
  exit 0
fi

cleanup() {
  rm -rf -- "${PARTIAL_DIR}"
}
trap cleanup EXIT

mkdir -p "${BACKUP_ROOT}" "${PARTIAL_DIR}"
chmod 0700 "${BACKUP_ROOT}" "${PARTIAL_DIR}"

kubectl -n "${NAMESPACE}" exec -c postgres deploy/multica-postgres -- \
  sh -c 'export PGPASSWORD="$POSTGRES_PASSWORD"; exec pg_dump \
    -U multica -d multica --format=custom --compress=6 --no-owner --no-acl' \
  >"${PARTIAL_DIR}/multica.dump"
test -s "${PARTIAL_DIR}/multica.dump"

tar --one-file-system -C /var/lib/multica \
  -czf "${PARTIAL_DIR}/uploads.tar.gz" uploads
test -s "${PARTIAL_DIR}/uploads.tar.gz"

{
  kubectl get namespace "${NAMESPACE}" -o yaml
  echo "---"
  kubectl get pv multica-postgres-pv multica-uploads-pv -o yaml
  echo "---"
  kubectl -n "${NAMESPACE}" get \
    pvc,configmap,secret,deployment,service,networkpolicy -o yaml
} >"${PARTIAL_DIR}/kubernetes-resources.yaml"

ETCDCTL="${ETCDCTL:-/opt/kube/bin/etcdctl}"
ETCD_CA="${ETCD_CA:-/etc/kubernetes/ssl/ca.pem}"
ETCD_CERT="${ETCD_CERT:-/etc/kubernetes/ssl/etcd.pem}"
ETCD_KEY="${ETCD_KEY:-/etc/kubernetes/ssl/etcd-key.pem}"
NODE_IP="$(kubectl get node -o jsonpath='{.items[0].status.addresses[?(@.type=="InternalIP")].address}')"

if [[ -x "${ETCDCTL}" && -n "${NODE_IP}" &&
      -r "${ETCD_CA}" && -r "${ETCD_CERT}" && -r "${ETCD_KEY}" ]]; then
  ETCDCTL_API=3 "${ETCDCTL}" \
    --endpoints="https://${NODE_IP}:2379" \
    --cacert="${ETCD_CA}" \
    --cert="${ETCD_CERT}" \
    --key="${ETCD_KEY}" \
    snapshot save "${PARTIAL_DIR}/etcd.snapshot"
else
  echo "Unable to create etcd snapshot with the configured client and certificates" >&2
  exit 1
fi

cat >"${PARTIAL_DIR}/metadata.txt" <<EOF
created_at=$(date --iso-8601=seconds)
hostname=$(hostname --fqdn 2>/dev/null || hostname)
kubernetes_server_version=$(kubectl version --short 2>/dev/null | awk -F': ' '/Server Version/{print $2}')
namespace=${NAMESPACE}
retention_days=${RETENTION_DAYS}
EOF

(
  cd "${PARTIAL_DIR}"
  sha256sum \
    multica.dump \
    uploads.tar.gz \
    kubernetes-resources.yaml \
    etcd.snapshot \
    metadata.txt >SHA256SUMS
)
chmod 0600 "${PARTIAL_DIR}"/*

mv "${PARTIAL_DIR}" "${FINAL_DIR}"
ln -sfn "${STAMP}" "${BACKUP_ROOT}/latest"
trap - EXIT

find "${BACKUP_ROOT}" -mindepth 1 -maxdepth 1 -type d \
  -name '20??????-??????' -mtime "+${RETENTION_DAYS}" \
  -print -exec rm -rf -- {} +

echo "Multica backup completed: ${FINAL_DIR}"
