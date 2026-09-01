import './index.css';

import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { initAutosaveSubscriptions } from './services/autosaveSubscriptions';
import { initAnalytics } from './services/analyticsConsent';

// Initialize autosave subscriptions before rendering
initAutosaveSubscriptions();

// Analytics loads here and nowhere else, and only for a visitor who already
// accepted it. Everyone else reaches the banner with no tag on the page.
initAnalytics();

const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement);

root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
