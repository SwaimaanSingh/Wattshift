import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import './styles/index.css';

// Follow the OS colour scheme. Tailwind is in `class` dark mode so we mirror
// the media query onto <html> and keep listening for changes.
const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
const applyTheme = (isDark) =>
  document.documentElement.classList.toggle('dark', isDark);
applyTheme(darkQuery.matches);
darkQuery.addEventListener('change', (e) => applyTheme(e.matches));

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);

/**
 * Service worker — production only. `/sw.js` is emitted by the build, so it
 * doesn't exist under `vite dev`, and a caching worker would fight HMR anyway.
 * Registered after load so it never competes with the first render for
 * bandwidth; failure is non-fatal, the app simply stays online-only.
 */
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((error) => {
      console.warn('Service worker registration failed:', error);
    });
  });
}
