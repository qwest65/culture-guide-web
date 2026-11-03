import { createContext, type ComponentChildren } from 'preact';
import { useContext, useEffect, useState } from 'preact/hooks';
import { load, save } from './storage';

type Settings = { large: boolean; toggleLarge: () => void };
const Ctx = createContext<Settings>({ large: false, toggleLarge: () => {} });

export function SettingsProvider({ children }: { children: ComponentChildren }) {
  const [large, setLarge] = useState(() => load('largeText') === '1');
  useEffect(() => {
    document.documentElement.classList.toggle('large-text', large);
    save('largeText', large ? '1' : null);
  }, [large]);
  return <Ctx.Provider value={{ large, toggleLarge: () => setLarge((v) => !v) }}>{children}</Ctx.Provider>;
}

export const useSettings = () => useContext(Ctx);
