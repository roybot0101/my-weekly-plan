import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { MarketingLanding } from './MarketingLanding';
import './styles.css';

const marketingHosts = new Set(['planwithtempo.com', 'www.planwithtempo.com']);
const hostname = typeof window !== 'undefined' ? window.location.hostname.toLowerCase() : '';
const searchParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
const forceMarketingView =
  searchParams?.get('marcom') === '1' || searchParams?.get('view') === 'marketing';
const forceAppView = searchParams?.get('app') === '1' || searchParams?.get('view') === 'app';
const showMarketingLanding = forceMarketingView || (!forceAppView && marketingHosts.has(hostname));

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {showMarketingLanding ? <MarketingLanding /> : <App />}
  </React.StrictMode>,
);
