# Проба панели Nginx Proxy Manager на одном сайте

Цель — посмотреть, удобно ли управлять сайтами через панель, не трогая то, что уже работает.
Caddy, Nextcloud, Home Assistant, Frigate остаются как есть. Подопытный — `culture-guide.mooo.com`,
его ещё никто не видит.

Схема на время пробы: интернет → **Caddy** (443, сертификат) → **панель NPM** (8080) → **static-sites**
(файлы из `/srv/sites/culture-guide.mooo.com`).

## Шаг 1. Панель и раздача файлов

```bash
mkdir -p /srv/npm && cd /srv/npm
```

```bash
curl -fsSLO https://raw.githubusercontent.com/qwest65/culture-guide-web/claude/culture-guide-city-schema-4v0qq3/deploy/home-server/npm/docker-compose.yml
```

```bash
curl -fsSLO https://raw.githubusercontent.com/qwest65/culture-guide-web/claude/culture-guide-city-schema-4v0qq3/deploy/home-server/npm/static.conf
```

```bash
docker compose up -d && docker compose ps
```

Если скачивание обрывается с `connection timed out` (Docker Hub из России работает нестабильно),
возьмите образ панели через зеркало Google и повторите `docker compose up -d`:

```bash
docker pull mirror.gcr.io/jc21/nginx-proxy-manager:latest && docker tag mirror.gcr.io/jc21/nginx-proxy-manager:latest jc21/nginx-proxy-manager:latest
```

Оба контейнера (`npm`, `static-sites`) — в состоянии `running`. С компьютера дома откройте
`http://192.168.0.91:81`, при первом входе панель попросит создать учётную запись администратора.

## Шаг 2. Файлы сайта

```bash
git clone --depth 1 --branch gh-pages https://github.com/qwest65/culture-guide-web.git /srv/sites/culture-guide.mooo.com
```

## Шаг 3. Сайт в панели

Hosts → Proxy Hosts → **Add Proxy Host**:
- Domain Names: `culture-guide.mooo.com`
- Scheme: `http`, Forward Hostname: `static-sites`, Forward Port: `80`
- галочка **Block Common Exploits** → Save. Вкладку SSL на пробе не трогаем.

Проверка изнутри сервера:

```bash
curl -s -H "Host: culture-guide.mooo.com" http://127.0.0.1:8080/ | head -3
```

Должен прийти HTML гида.

## Шаг 4. Caddy передаёт новый адрес в панель

В конец `/srv/caddy/Caddyfile` дописать — редактором `nano /srv/caddy/Caddyfile`
(файл подключён в контейнер напрямую; некоторые редакторы, например встроенный в MobaXterm,
сохраняют его как новый файл, и Caddy изменений не увидит):

```
culture-guide.mooo.com {
	reverse_proxy 192.168.0.91:8080
}
```

```bash
docker exec caddy caddy validate --config /etc/caddy/Caddyfile && docker exec caddy caddy reload --config /etc/caddy/Caddyfile
```

`reload` перечитывает настройки без остановки — остальные сайты не прерываются.

## Шаг 5. Автообновление гида с GitHub

```bash
curl -fsSL -o /usr/local/bin/culture-guide-update https://raw.githubusercontent.com/qwest65/culture-guide-web/claude/culture-guide-city-schema-4v0qq3/deploy/home-server/update-site.sh && chmod +x /usr/local/bin/culture-guide-update
```

```bash
( crontab -l 2>/dev/null; echo "*/2 * * * * /usr/local/bin/culture-guide-update >/dev/null 2>&1" ) | crontab -
```

## Откат

```bash
cd /srv/npm && docker compose down
```

и удалить 4 строки `culture-guide.mooo.com { … }` из Caddyfile, затем `docker exec caddy caddy reload --config /etc/caddy/Caddyfile`.

## Переезд всех доменов с Caddy на панель

Подготовка (сделано 3 ноября 2026): в панели заведены без SSL `culture-guide.mooo.com`, `ha.io.mooo.com`
(WebSocket), `frigate.io.mooo.com` (WebSocket), `cloud.io.mooo.com` (WebSocket; в «Своих настройках»
`client_max_body_size 0; proxy_request_buffering off;`), `h2nexus.netcraze.pro` (https → 192.168.0.91:21000,
WebSocket; в «Своих настройках» `location = / { return 302 /hysteria/; }`, `proxy_ssl_server_name on;`,
`proxy_ssl_name h2nexus.netcraze.pro;`). Каждый проверен через порт 8080.

Сертификат для 3x-ui после переезда берёт `sync-npm-xui-cert.sh` (вместо `sync-caddy-xui-cert.sh`):
ищет в `/srv/npm/letsencrypt/live/npm-*/` сертификат `h2nexus.netcraze.pro`, проверяет и кладёт
в `/root/cert/h2nexus.netcraze.pro/`, перезапуская 3x-ui только при изменении.

### Смена «входной двери» (1–2 минуты простоя всех сайтов)

1. Caddy останавливается и не запускается сам после перезагрузки (его настройки и сертификаты остаются):

   ```bash
   docker update --restart=no caddy && docker stop caddy
   ```

2. Панель занимает 80 и 443:

   ```bash
   cd /srv/npm && sed -i 's/"8080:80"/"80:80"/; s/"8443:443"/"443:443"/' docker-compose.yml && docker compose up -d
   ```

3. В панели по одному хосту: «SSL» → «Запросить новый сертификат», включить «Принудительный SSL» и HTTP/2
   (для `cloud` — ещё HSTS) → «Сохранить». Порядок: culture-guide → ha → frigate → cloud → h2nexus.

4. Сертификат для 3x-ui — новый скрипт вместо старого:

   ```bash
   curl -fsSL -o /usr/local/sbin/sync-npm-xui-cert.sh https://raw.githubusercontent.com/qwest65/culture-guide-web/claude/culture-guide-city-schema-4v0qq3/deploy/home-server/sync-npm-xui-cert.sh && chmod +x /usr/local/sbin/sync-npm-xui-cert.sh
   ```

   ```bash
   /usr/local/sbin/sync-npm-xui-cert.sh && journalctl -t sync-npm-xui-cert -n 5 --no-pager
   ```

   ```bash
   crontab -l | sed 's#/usr/local/sbin/sync-caddy-xui-cert.sh#/usr/local/sbin/sync-npm-xui-cert.sh#' | crontab -
   ```

### Откат

```bash
cd /srv/npm && sed -i 's/"80:80"/"8080:80"/; s/"443:443"/"8443:443"/' docker-compose.yml && docker compose up -d
```

```bash
docker update --restart=unless-stopped caddy && docker start caddy
```

и вернуть в crontab `sync-caddy-xui-cert.sh`.
