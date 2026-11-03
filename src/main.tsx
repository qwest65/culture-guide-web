import { render } from 'preact';
import { App } from './app';
import { SettingsProvider } from './settings';
import './styles.css';

render(
  <SettingsProvider>
    <App />
  </SettingsProvider>,
  document.getElementById('app')!,
);
