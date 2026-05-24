import React from 'react';
import ReactDOM from 'react-dom/client';
import { Capacitor } from '@capacitor/core';
import { CapacitorUpdater } from '@capgo/capacitor-updater';
import './index.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

// קריטי: לפני טעינת App
if (Capacitor.isNativePlatform()) {
  CapacitorUpdater.notifyAppReady()
    .then(() => console.log("notifyAppReady OK - bootstrap"))
    .catch(err => console.error("notifyAppReady failed - bootstrap", err));
}

// טוענים את App רק אחרי notify
import('./App').then(({ default: App }) => {
  const root = ReactDOM.createRoot(rootElement);

  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
});