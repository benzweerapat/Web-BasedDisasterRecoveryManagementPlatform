import React, { useCallback, useEffect, useMemo, useState } from 'react';
import RouterContext from './router-context';
import { useNavigate } from './router-hooks';

function normalizePath(path) {
  const value = String(path || '/').split('?')[0].split('#')[0];
  if (value === '/') return '/';
  return `/${value.replace(/^\/+|\/+$/g, '')}`;
}

export function RouterProvider({ children }) {
  const [pathname, setPathname] = useState(() => normalizePath(window.location.pathname));
  const [search, setSearch] = useState(() => (typeof window !== 'undefined' ? window.location.search : ''));

  useEffect(() => {
    const onPopState = () => {
      setPathname(normalizePath(window.location.pathname));
      setSearch(window.location.search || '');
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const navigate = useCallback((to, options = {}) => {
    const next = normalizePath(to);
    const searchString = String(to).includes('?') ? `?${String(to).split('?')[1]}` : '';
    if (options.replace) window.history.replaceState({}, '', to);
    else window.history.pushState({}, '', to);
    setPathname(next);
    setSearch(searchString);
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, []);

  const value = useMemo(() => ({ pathname, search, navigate }), [navigate, pathname, search]);
  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>;
}

export function Link({ to, onClick, target, children, ...props }) {
  const navigate = useNavigate();
  const handleClick = event => {
    onClick?.(event);
    if (event.defaultPrevented || target === '_blank' || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(to);
  };
  return <a href={to} target={target} onClick={handleClick} {...props}>{children}</a>;
}

export function Redirect({ to, replace = true }) {
  const navigate = useNavigate();
  useEffect(() => navigate(to, { replace }), [navigate, replace, to]);
  return null;
}