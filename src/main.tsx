import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { MarketingLanding } from './MarketingLanding';
import './styles.css';

const marketingHosts = new Set(['planwithtempo.com', 'www.planwithtempo.com']);
const hostname = typeof window !== 'undefined' ? window.location.hostname.toLowerCase() : '';
const showMarketingLanding = marketingHosts.has(hostname);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {showMarketingLanding ? <MarketingLanding /> : <App />}
  </React.StrictMode>,
);
