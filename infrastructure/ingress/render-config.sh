#!/bin/sh
# Renders the deployment-specific nginx includes, then runs nginx in the foreground.
set -eu
umask 077

fail() {
  echo "pr0-ingress: $1" >&2
  exit 64
}

# Addresses and CIDRs only: hexadecimal digits, dots, colons and one prefix slash.
valid_address() {
  case "$1" in
    "" | */*/* | *[!0-9A-Fa-f.:/]*) return 1 ;;
  esac
  return 0
}

list() {
  printf '%s\n' "$1" | tr ',' ' '
}

if [ -n "${PR0_INGRESS_SECRET_FILE:-}" ]; then
  [ -r "$PR0_INGRESS_SECRET_FILE" ] || fail "PR0_INGRESS_SECRET_FILE is not readable"
  secret=$(tr -d ' \t\r\n' <"$PR0_INGRESS_SECRET_FILE")
else
  secret=${PR0_INGRESS_SECRET:-}
fi
[ "${#secret}" -ge 32 ] || fail "PR0_INGRESS_SECRET(_FILE) must contain at least 32 characters"
case "$secret" in
  *[!A-Za-z0-9._~+/=-]*) fail "PR0_INGRESS_SECRET(_FILE) may only contain A-Z a-z 0-9 . _ ~ + / = -" ;;
esac

upstream=${PR0_INGRESS_UPSTREAM:-web:3000}
case "$upstream" in
  *:*:* | *[!A-Za-z0-9.:-]* | :* | *:) fail "PR0_INGRESS_UPSTREAM must be host:port" ;;
  *:*) ;;
  *) fail "PR0_INGRESS_UPSTREAM must be host:port" ;;
esac
resolver=${PR0_INGRESS_RESOLVER:-127.0.0.11}
valid_address "$resolver" || fail "PR0_INGRESS_RESOLVER must be an address"

output=/tmp/pr0-ingress
rm -rf "$output"
mkdir -p "$output"

trusted=0
: >"$output/trusted.conf"
for address in $(list "${PR0_INGRESS_TRUSTED_PROXIES:-}"); do
  valid_address "$address" || fail "invalid PR0_INGRESS_TRUSTED_PROXIES entry: $address"
  printf 'set_real_ip_from %s;\n' "$address" >>"$output/trusted.conf"
  trusted=1
done
[ "$trusted" -eq 1 ] || fail "PR0_INGRESS_TRUSTED_PROXIES must name the edge proxy addresses"

: >"$output/metrics.conf"
for address in $(list "${PR0_INGRESS_METRICS_ALLOW:-}"); do
  valid_address "$address" || fail "invalid PR0_INGRESS_METRICS_ALLOW entry: $address"
  printf '%s 1;\n' "$address" >>"$output/metrics.conf"
done

printf 'proxy_set_header X-Pr0-Ingress-Secret "%s";\n' "$secret" >"$output/secret.conf"
cat >"$output/upstream.conf" <<EOF
resolver $resolver valid=10s ipv6=off;
upstream pr0_web {
    zone pr0_web 64k;
    server $upstream resolve;
    keepalive 16;
}
EOF

exec nginx -g 'daemon off;'
