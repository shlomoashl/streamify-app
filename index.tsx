import React from 'react';
import ReactDOM from 'react-dom/client';
import { Capacitor } from '@capacitor/core';
import { CapacitorUpdater } from '@capgo/capacitor-updater';
import App from './App';
import './index.css';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error("Could not find root element");
}

const root = ReactDOM.createRoot(rootElement);

root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// מיד אחרי render
if (Capacitor.isNativePlatform()) {
  setTimeout(() => {
    CapacitorUpdater.notifyAppReady()
      .then(() => console.log("notifyAppReady immediate"))
      .catch(console.error);
  }, 100);
}