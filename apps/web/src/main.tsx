import { createRoot } from 'react-dom/client';
import { setupI18n, initialLocale } from './i18n.js';
import { stored } from './api.js';
import { App } from './App.js';
import './styles.css';
await setupI18n(initialLocale(stored('craft.locale'), navigator.languages));
createRoot(document.getElementById('root')!).render(<App/>);
