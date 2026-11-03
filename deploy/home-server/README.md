# Культурный гид на домашнем сервере (Caddy)

Сайт — статические файлы. Готовую проверенную сборку workflow **Deploy** кладёт в ветку `gh-pages`.
Сервер раз в 2 минуты сам забирает её с GitHub (`update-site.sh`), а Caddy отдаёт по HTTPS.
Снаружи не нужно открывать ничего, кроме уже открытых 80/443, а паролей от сервера в GitHub нет.

| Файл | Что это |
|---|---|
| `Caddyfile.snippet` | блок сайта для вашего Caddyfile |
| `update-site.sh` | забирает свежую сборку из `gh-pages` |
| `culture-guide-update.service`, `.timer` | запуск обновления раз в 2 минуты (systemd) |

## 1. Поддомен

На [duckdns.org](https://www.duckdns.org) войдите через GitHub или Google, создайте поддомен
(например, `kulturgid`) и в поле **current ip** впишите статический IP сервера → **update ip**.
Проверка с любого компьютера:

```bash
nslookup kulturgid.duckdns.org
```

Должен вернуться ваш IP.

## 2. Файлы сайта

На сервере (нужен `git`: `sudo apt install git`):

```bash
sudo mkdir -p /srv/sites
sudo curl -fsSL -o /usr/local/bin/culture-guide-update https://raw.githubusercontent.com/qwest65/culture-guide-web/claude/culture-guide-city-schema-4v0qq3/deploy/home-server/update-site.sh
sudo chmod +x /usr/local/bin/culture-guide-update
sudo /usr/local/bin/culture-guide-update
ls /srv/sites/culture-guide
```

В конце должны быть видны `index.html`, `assets`, `map`, `audio`, `photos`.

## 3. Caddy

Добавьте блок из `Caddyfile.snippet` в ваш Caddyfile (обычно `/etc/caddy/Caddyfile`),
заменив `kulturgid.duckdns.org` на свой поддомен. Затем:

```bash
sudo caddy validate --config /etc/caddy/Caddyfile
```

```bash
sudo systemctl reload caddy
```

**Если Caddy в Docker:** папку сайта нужно подключить в контейнер — в `docker-compose.yml`
у сервиса caddy в `volumes:` добавить `- /srv/sites:/srv/sites:ro` и пересоздать контейнер
(`docker compose up -d caddy`). Перезагрузка настроек: `docker compose exec caddy caddy reload --config /etc/caddy/Caddyfile`.

## 4. Автообновление

```bash
sudo curl -fsSL -o /etc/systemd/system/culture-guide-update.service https://raw.githubusercontent.com/qwest65/culture-guide-web/claude/culture-guide-city-schema-4v0qq3/deploy/home-server/culture-guide-update.service
sudo curl -fsSL -o /etc/systemd/system/culture-guide-update.timer https://raw.githubusercontent.com/qwest65/culture-guide-web/claude/culture-guide-city-schema-4v0qq3/deploy/home-server/culture-guide-update.timer
```

В `.service` обновление запускается от пользователя `caddy` (он есть, если Caddy установлен пакетом).
Отдайте ему папку сайта и включите таймер:

```bash
sudo chown -R caddy:caddy /srv/sites/culture-guide
```

```bash
sudo systemctl daemon-reload && sudo systemctl enable --now culture-guide-update.timer
```

Если Caddy в Docker и пользователя `caddy` нет — в `.service` замените `User=caddy` на своего пользователя
и сделайте `chown` на него.

Проверка: `systemctl list-timers culture-guide-update.timer` — время следующего запуска;
`journalctl -u culture-guide-update -n 20` — что скачивалось.

## 5. Проверка

Откройте `https://<поддомен>/` на телефоне. Первое открытие может занять до минуты:
Caddy получает сертификат Let's Encrypt.

С компьютера:

```bash
curl -sI https://kulturgid.duckdns.org/ | head -5
```

```bash
curl -sI https://kulturgid.duckdns.org/map/troitsk/style.json | grep -i cache-control
```

Первая команда — `HTTP/2 200`, вторая — `max-age=86400`.

## Если что-то пошло не так

- **Сертификат не выдаётся** (`journalctl -u caddy -n 50`): проверьте, что поддомен указывает на ваш IP
  и что порты 80/443 проброшены на сервер.
- **Сайт старый:** `sudo systemctl start culture-guide-update` и посмотрите журнал.
- **Откатиться:** сайт продолжает работать на GitHub Pages — https://qwest65.github.io/culture-guide-web/
