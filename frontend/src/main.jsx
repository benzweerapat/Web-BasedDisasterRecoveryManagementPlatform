import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

// Recover once if a deployment replaces a lazy-loaded page bundle.
window.addEventListener('vite:preloadError', event => {
  const key='srm-preload-reload';
  try {
    const previous=Number(sessionStorage.getItem(key)||0);
    if(Date.now()-previous<60000)return;
    sessionStorage.setItem(key,String(Date.now()));
    event.preventDefault();
    window.location.reload();
  } catch { /* Preserve the original error if storage is unavailable. */ }
});

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)