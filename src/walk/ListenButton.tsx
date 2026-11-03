import { useEffect, useState } from 'preact/hooks';
import { player } from './player';

/** «Слушать рассказ» на карточке объекта. Нажатие само разблокирует звук на iPhone. */
export function ListenButton({ url }: { url: string }) {
  const [current, setCurrent] = useState(player.current);
  useEffect(() => {
    const off = player.subscribe(() => setCurrent(player.current));
    return () => {
      off();
      if (player.current === url) player.stop();
    };
  }, [url]);
  const playing = current === url;
  return (
    <button
      type="button"
      class="button listen"
      aria-pressed={playing}
      onClick={() => {
        if (playing) player.stop();
        else {
          player.unlock();
          player.play(url);
        }
      }}
    >
      {playing ? '⏸ Остановить' : '▶ Слушать рассказ'}
    </button>
  );
}
