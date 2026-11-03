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
