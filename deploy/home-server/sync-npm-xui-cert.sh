#!/usr/bin/env bash
# Сертификат h2nexus.netcraze.pro из панели Nginx Proxy Manager → 3x-ui.
# Замена /usr/local/sbin/sync-caddy-xui-cert.sh после переезда с Caddy на NPM:
# всё то же самое (проверки, атомарная замена, перезапуск 3x-ui только при изменении),
# но сертификат берётся из /srv/npm/letsencrypt, а не из контейнера Caddy.
set -euo pipefail

DOMAIN="h2nexus.netcraze.pro"
LIVE="/srv/npm/letsencrypt/live"   # NPM хранит сертификаты в live/npm-<номер>/
DEST="/root/cert/${DOMAIN}"
LOG_TAG="sync-npm-xui-cert"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

CERT="$TMP/fullchain.pem"
KEY="$TMP/privkey.pem"

logger -t "$LOG_TAG" "Checking NPM certificate"

# Номер папки у NPM заранее неизвестен — ищем сертификат нашего домена с самым поздним сроком.
BEST=""
BEST_END=0
for dir in "$LIVE"/npm-*/; do
	[[ -f "$dir/fullchain.pem" && -f "$dir/privkey.pem" ]] || continue
	openssl x509 -in "$dir/fullchain.pem" -noout -checkhost "$DOMAIN" 2>/dev/null | grep -q "does match" || continue
	END="$(date -d "$(openssl x509 -in "$dir/fullchain.pem" -noout -enddate | cut -d= -f2)" +%s)"
	if (( END > BEST_END )); then
		BEST="$dir"
		BEST_END="$END"
	fi
done

if [[ -z "$BEST" ]]; then
	logger -t "$LOG_TAG" "ERROR: no NPM certificate for ${DOMAIN} in ${LIVE}"
	exit 1
fi

# В live/ лежат ссылки на файлы в archive/ — копируем сами файлы.
cp -L "$BEST/fullchain.pem" "$CERT"
cp -L "$BEST/privkey.pem" "$KEY"

# Проверяем домен и срок действия (не менее 14 дней)
openssl x509 -in "$CERT" -noout -checkhost "$DOMAIN"
openssl x509 -in "$CERT" -noout -checkend 1209600

# Проверяем, что сертификат соответствует приватному ключу
CERT_PUB="$(openssl x509 -in "$CERT" -pubkey -noout | openssl pkey -pubin -outform DER | sha256sum | awk '{print $1}')"
KEY_PUB="$(openssl pkey -in "$KEY" -pubout -outform DER | sha256sum | awk '{print $1}')"

if [[ "$CERT_PUB" != "$KEY_PUB" ]]; then
	logger -t "$LOG_TAG" "ERROR: certificate and key do not match"
	exit 1
fi

mkdir -p "$DEST"
chmod 700 "$DEST"

# Если сертификат не изменился, перезапуск не требуется
if [[ -f "$DEST/fullchain.pem" && -f "$DEST/privkey.pem" ]] &&
	cmp -s "$CERT" "$DEST/fullchain.pem" &&
	cmp -s "$KEY" "$DEST/privkey.pem"; then
	logger -t "$LOG_TAG" "Certificate unchanged"
	exit 0
fi

# Готовим новые файлы до замены действующих
install -m 600 "$CERT" "$DEST/fullchain.pem.new"
install -m 600 "$KEY" "$DEST/privkey.pem.new"

mv -f "$DEST/fullchain.pem.new" "$DEST/fullchain.pem"
mv -f "$DEST/privkey.pem.new" "$DEST/privkey.pem"

logger -t "$LOG_TAG" "Certificate updated from ${BEST}; restarting 3X-UI"
x-ui restart

logger -t "$LOG_TAG" "3X-UI restart command completed"
