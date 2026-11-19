import './index.css';

import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { initAutosaveSubscriptions } from './services/autosaveSubscriptions';

// Initialize autosave subscriptions before rendering
initAutosaveSubscriptions();

const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement);

root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
