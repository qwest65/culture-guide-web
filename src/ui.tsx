import type { ComponentChildren } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { href } from './router';
import { useSettings } from './settings';

/** Заголовок экрана. При смене экрана фокус переходит на него — экранный чтец объявит новую страницу. */
export function PageTitle({ children, eyebrow }: { children: ComponentChildren; eyebrow?: ComponentChildren }) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
    scrollTo(0, 0);
  }, []);
  return (
    <header class="page-head">
      {eyebrow && <p class="eyebrow">{eyebrow}</p>}
      <h1 ref={ref} tabIndex={-1}>
        {children}
      </h1>
    </header>
  );
}

export function TopBar({ back }: { back?: { href: string; label: string } }) {
  const { large, toggleLarge } = useSettings();
  return (
    <nav class="topbar" aria-label="Навигация">
      {back ? (
        <a class="topbar-back" href={back.href}>
          <span aria-hidden="true">←</span> {back.label}
        </a>
      ) : (
        <a class="topbar-brand" href={href.home()}>
          Культурный гид
        </a>
      )}
      <button
        type="button"
        class="topbar-font"
        aria-pressed={large}
        onClick={toggleLarge}
        title="Крупный шрифт"
      >
        <span aria-hidden="true">Аа</span>
        <span class="visually-hidden">Крупный шрифт</span>
      </button>
    </nav>
  );
}

export function Loading() {
  return (
    <p class="status" role="status">
      Загружаем…
    </p>
  );
}

export function LoadError({ retry }: { retry: () => void }) {
  return (
    <div class="status" role="alert">
      <p>Не удалось загрузить данные. Проверьте интернет.</p>
      <button type="button" class="button" onClick={retry}>
        Повторить
      </button>
    </div>
  );
}

export function NotFound() {
  return (
    <>
      <TopBar />
      <main id="main" class="page">
        <PageTitle>Такой страницы нет</PageTitle>
        <p>
          <a href={href.home()}>К выбору города</a>
        </p>
      </main>
    </>
  );
}
