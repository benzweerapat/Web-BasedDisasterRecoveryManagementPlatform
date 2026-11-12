import { useContext } from 'react';
import RouterContext from './router-context';

export function useNavigate() {
  const context = useContext(RouterContext);
  if (!context) return (to) => { if (typeof window !== 'undefined') window.location.assign(to); };
  return context.navigate;
}

export function useLocation() {
  const context = useContext(RouterContext);
  if (!context) return { 
    pathname: typeof window !== 'undefined' ? window.location.pathname : '/',
    search: typeof window !== 'undefined' ? window.location.search : ''
  };
  return { 
    pathname: context.pathname,
    search: context.search ?? (typeof window !== 'undefined' ? window.location.search : '')
  };
}