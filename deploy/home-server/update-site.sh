#!/bin/sh
# Забирает свежую сборку «Культурного гида» из ветки gh-pages на GitHub.
# Её туда кладёт workflow Deploy — только после того, как прошли все проверки.
# Запускается таймером раз в 2 минуты; если GitHub недоступен — сайт остаётся как был.
set -eu
REPO="https://github.com/qwest65/culture-guide-web.git"
DIR="${1:-/srv/sites/culture-guide.mooo.com}"

if [ ! -d "$DIR/.git" ]; then
	git clone --quiet --depth 1 --branch gh-pages "$REPO" "$DIR"
	echo "Сайт скачан: $(git -C "$DIR" log -1 --format=%s)"
	exit 0
fi

git -C "$DIR" fetch --quiet --depth 1 origin gh-pages
if [ "$(git -C "$DIR" rev-parse HEAD)" != "$(git -C "$DIR" rev-parse FETCH_HEAD)" ]; then
	git -C "$DIR" reset --quiet --hard FETCH_HEAD
	git -C "$DIR" clean --quiet -fdx
	echo "Сайт обновлён: $(git -C "$DIR" log -1 --format=%s)"
fi
