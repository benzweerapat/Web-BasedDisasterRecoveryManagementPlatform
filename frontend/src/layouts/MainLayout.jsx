import Button from '../components/shared/Button';
import AiChatAssistant from '../components/shared/AiChatAssistant';
import BackgroundOperationsPanel from '../components/shared/BackgroundOperationsPanel';
import { Link } from '../router';
import { useLocation, useNavigate } from '../router-hooks';
import React, { useEffect, useState } from 'react';
import apiClient, { clearCsrfToken } from '../api/apiClient';
import { systemHealthPresentation } from '../utils/system-health';
import { formatSyncTimestamp } from '../utils/formatters';
import { runSync, getSyncState, subscribeSync } from '../api/sync-schedule';
import { canSyncAll } from '../utils/sync-all';
import { Activity, Database, FileClock, FileText, History, Monitor, Network, Plug, RefreshCw, Settings, Shield, ShieldCheck, PanelLeftClose, PanelLeftOpen, Users as UsersIcon, Layers, Link2 } from 'lucide-react';

export default function MainLayout({ user, setUser, children }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [systemHealth, setSystemHealth] = useState('UNKNOWN');
  const healthPresentation = systemHealthPresentation(systemHealth);
  const [isCollapsed, setIsCollapsed] = useState(() => {
    try {
      const explicitOpen = localStorage.getItem('srm.sidebar.open');
      if (explicitOpen !== null) return explicitOpen === 'false';
      return localStorage.getItem('srm_sidebar_collapsed') === 'true';
    } catch {
      return false;
    }
  });

  const toggleSidebar = () => {
    setIsCollapsed(prev => {
      const next = !prev;
      try {
        localStorage.setItem('srm_sidebar_collapsed', String(next));
        localStorage.setItem('srm.sidebar.open', String(!next));
      } catch {}
      return next;
    });
  };

  const [lastCollectedAt, setLastCollectedAt] = useState(null);

  useEffect(() => {
    const checkHealth = async () => {
      try {
        const response = await apiClient.get('/dr/overview');
        setSystemHealth(response.data?.data?.health?.status || 'UNKNOWN');
        const collected = response.data?.data?.freshness?.overall?.lastCollectedAt;
        if (collected) setLastCollectedAt(collected);
      } catch {
        setSystemHealth('ERROR');
      }
    };
    checkHealth();
    window.addEventListener('inventory-cache-invalidated', checkHealth);
    return () => window.removeEventListener('inventory-cache-invalidated', checkHealth);
  }, [location.pathname]);

  const handleLogout = async () => {
    try { await apiClient.post('/auth/logout'); } catch {}
    setUser?.(null);
    clearCsrfToken();
  };

  const navGroups = [
    { label: 'Overview', items: [
      { name: 'Disaster recovery dashboard', path: '/dr-unified', icon: Activity }
    ] },
    { label: 'Connections', items: [{ name: 'VMware connections', path: '/connections', icon: Plug }] },
    { label: 'Infrastructure', items: [
      { name: 'vCenter inventory', path: '/vcenters', icon: Database },
      { name: 'Virtual machines', path: '/vms', icon: Monitor }
    ] },
    { label: 'Replication', items: [
      { 
        name: 'vSphere Replication', 
        path: '/replications', 
        icon: RefreshCw,
        subItems: [
          { 
            name: 'Replications', 
            path: '/replications',
            icon: Layers,
            isActive: (path, sp) => path === '/replications' && (!sp.get('tab') || sp.get('tab') === 'replications')
          },
          { 
            name: 'Site pairings', 
            path: '/replications?tab=pairings',
            icon: Link2,
            isActive: (path, sp) => path === '/replications' && sp.get('tab') === 'pairings'
          }
        ]
      }
    ] },
    { label: 'Recovery configuration', items: [
      { 
        name: 'Inventory mappings', 
        path: '/inventory-mappings', 
        icon: Network 
      },
      { 
        name: 'Protection groups', 
        path: '/protection-groups', 
        icon: Shield
      },
      { name: 'Recovery plans', path: '/recovery-plans', icon: FileText }
    ] },
    { label: 'Administration', items: [
      { name: 'Settings', path: '/settings', icon: Settings }
    ] }
  ];


  const activeItem = navGroups.flatMap(group => group.items)
    .find(item => location.pathname === item.path || (item.path !== '/overview' && location.pathname.startsWith(item.path)))
    || (location.pathname === '/users' ? { name: 'Users' } : null);


  return (
    <div className="flex h-screen overflow-hidden bg-white font-sans text-slate-800" data-layout="classic-dashboard">
      <aside 
        className={`flex flex-col shrink-0 overflow-hidden bg-[#0A1024] text-white transition-all duration-300 ease-in-out select-none z-20 ${isCollapsed ? 'w-20' : 'w-72'}`} 
        data-classic-sidebar="true"
        data-sidebar-state={isCollapsed ? 'collapsed' : 'expanded'}
        data-floating-rail={isCollapsed ? 'true' : undefined}
      >
        {/* Header with App Title and Toggle */}
        <div className="flex h-16 shrink-0 items-center px-5 border-b border-white/10 select-none">
          <button
            type="button"
            onClick={toggleSidebar}
            title={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-slate-200 hover:bg-white/10 hover:text-white transition-colors cursor-pointer border border-white/15"
          >
            {isCollapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
          </button>
          {!isCollapsed && (
            <div className="ml-3 min-w-0 flex-1 truncate">
              <h1 className="font-display text-base font-semibold tracking-tight text-white leading-tight">VMware SRM</h1>
              <p className="text-xs font-medium capitalize text-indigo-300 leading-tight">Disaster recovery</p>
            </div>
          )}
        </div>

        <nav className="custom-scrollbar flex-1 overflow-y-auto px-5 py-3 space-y-1" aria-label="Main navigation" data-floating-rail={isCollapsed ? 'true' : undefined}>
          {navGroups.map((group, gIdx) => (
            <div key={group.label}>
              {gIdx > 0 && <div className="my-1.5 border-t border-white/10" />}
              <div className="space-y-1">
                {group.items.map(item => {
                  const Icon = item.icon;
                  const searchParams = new URLSearchParams(location.search || (typeof window !== 'undefined' ? window.location.search : ''));
                  const activeSubItem = item.subItems?.find(sub => 
                    sub.isActive ? sub.isActive(location.pathname, searchParams) : location.pathname === sub.path
                  );
                  const isMainPathActive = location.pathname === item.path || (item.path !== '/overview' && location.pathname.startsWith(item.path));
                  const isLinkDirectlyActive = isMainPathActive && !activeSubItem;
                  const isVrNavigation = item.path === '/replications';
                  return (
                    <div key={item.path} className="relative">
                      <Link 
                        to={item.path} 
                        title={item.name}
                        aria-label={item.name}
                        aria-current={isLinkDirectlyActive ? 'page' : undefined} 
                        className={`group/main flex h-10 items-center rounded-xl transition-all ${isVrNavigation ? `vr-sidebar-group ${isMainPathActive ? 'vr-sidebar-group-active' : ''}` : ''} ${
                          isCollapsed ? 'w-10 justify-center' : 'w-full'
                        } ${
                          isLinkDirectlyActive 
                            ? 'bg-[#FE5E37] text-white font-semibold shadow-inner' 
                            : isMainPathActive
                            ? 'bg-white/10 text-white font-semibold'
                            : 'font-normal text-slate-200 hover:bg-white/10 hover:text-white'
                        }`}
                      >
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center">
                          <Icon size={19} strokeWidth={2} className={`shrink-0 transition-transform ${isLinkDirectlyActive ? 'text-white' : isMainPathActive ? (isVrNavigation ? 'text-white' : 'text-[#FE5E37]') : 'text-slate-300 group-hover/main:text-white group-hover/main:scale-105'}`} aria-hidden="true" />
                        </span>
                        {!isCollapsed && (
                          <>
                            <span className="ml-3 min-w-0 flex-1 truncate text-sm font-semibold">{item.name}</span>
                          </>
                        )}
                        {isCollapsed && (
                          <div 
                            role="tooltip" 
                            aria-label={item.name} 
                            className="pointer-events-none absolute left-full ml-3 top-1/2 -translate-y-1/2 z-50 hidden rounded-md bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white shadow-xl whitespace-nowrap group-hover/main:block border border-slate-700"
                          >
                            {item.name}
                          </div>
                        )}
                      </Link>

                      {/* Sub-items (dots): perfectly aligned in BOTH collapsed and expanded states */}
                      {item.subItems && (
                        <div className="space-y-0.5 pt-0.5 pl-2">
                          {item.subItems.map(sub => {
                            const isSubActive = sub.isActive
                              ? sub.isActive(location.pathname, searchParams)
                              : location.pathname === sub.path;
                            const SubIcon = sub.icon;
                            return (
                              <div key={sub.name} className="relative">
                                <button
                                  type="button"
                                  onClick={() => navigate(sub.path)}
                                  title={sub.name}
                                  aria-label={sub.name}
                                  className={`sidebar-subitem group/sub flex h-8 items-center rounded-lg transition-colors cursor-pointer ${isVrNavigation ? 'vr-sidebar-subitem' : ''} ${
                                    isCollapsed ? 'w-10 justify-center' : 'w-full px-1'
                                  } ${
                                    isSubActive ? 'sidebar-subitem-active' : ''
                                  }`}
                                >
                                  <span className="flex h-8 w-8 shrink-0 items-center justify-center">
                                    {SubIcon ? (
                                      <SubIcon
                                        size={15}
                                        strokeWidth={1.8}
                                        style={{ color: isVrNavigation ? '#8ac389' : (isSubActive ? '#fe5e37' : 'rgba(148,163,184,0.85)') }}
                                        className={`transition-all shrink-0 ${isSubActive ? 'scale-105' : 'group-hover/sub:scale-105'}`}
                                        aria-hidden="true"
                                      />
                                    ) : (
                                      <span className={`block rounded-full transition-all ${
                                        isSubActive
                                          ? 'h-2 w-2 bg-[#FE5E37] ring-2 ring-[#FE5E37]/30'
                                          : 'h-2 w-2 bg-slate-400/70 group-hover/sub:bg-white group-hover/sub:scale-125'
                                      }`} aria-hidden="true" />
                                    )}
                                  </span>
                                  {!isCollapsed && (
                                    <span style={{color: isSubActive ? '#fe5e37' : 'rgba(203,213,225,0.9)'}} className={`min-w-0 flex-1 truncate text-xs text-left leading-none ${
                                      isSubActive ? 'font-semibold' : 'font-medium'
                                    }`}>
                                      {sub.name}
                                    </span>
                                  )}
                                  {isCollapsed && (
                                    <div 
                                      role="tooltip" 
                                      className="pointer-events-none absolute left-full ml-3 top-1/2 -translate-y-1/2 z-50 hidden rounded-md bg-slate-900 px-2.5 py-1 text-xs font-semibold text-white shadow-xl whitespace-nowrap group-hover/sub:block border border-slate-700"
                                    >
                                      {sub.name}
                                    </div>
                                  )}
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
          <div className="sr-only">
            {user?.role === 'ADMIN' && <Link to="/users">Users</Link>}
          </div>
        </nav>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-7 xl:px-9">
          <div className="flex min-w-0 items-center gap-3">
            <h2 className="truncate text-base font-semibold text-slate-800">{activeItem?.name || 'Overview'}</h2>
            <div id="main-header-portal-left" className="flex items-center gap-2"></div>
          </div>
          <div className="flex items-center gap-4">
            <div id="main-header-actions" className="flex items-center">
              <HeaderSyncControl user={user} lastCollectedAt={lastCollectedAt} />
            </div>
            <Button className="sr-only" aria-label="Sign out account" onClick={handleLogout}>
              {(user?.username || user?.user || 'A').charAt(0).toUpperCase()}
            </Button>
            <span className="sr-only" data-system-health={systemHealth}>{healthPresentation.label}</span>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-auto bg-white px-7 pt-3.5 pb-6 xl:px-9" data-classic-content>{children}</div>
      </main>
      <BackgroundOperationsPanel />
      <AiChatAssistant />
    </div>
  );
}

function HeaderSyncControl({ user, lastCollectedAt }) {
  const syncState = React.useSyncExternalStore(subscribeSync, getSyncState);
  const [localSyncing, setLocalSyncing] = useState(false);
  const syncing = localSyncing || Boolean(syncState.running || syncState.manualRunning);

  const handleSync = async () => {
    if (syncing) return;
    setLocalSyncing(true);
    try {
      await runSync();
      window.dispatchEvent(new CustomEvent('inventory-cache-invalidated'));
    } catch (err) {
      console.error('Failed to sync VMware data:', err);
    } finally {
      setLocalSyncing(false);
    }
  };

  const timestamp = syncState.lastAt || lastCollectedAt;
  const { dateStr, timeStr } = formatSyncTimestamp(timestamp);
  const canSync = !user || canSyncAll(user);

  return (
    <div className="flex items-center gap-3 select-none" data-unified-header-sync="true">
      <div className="flex items-start gap-1.5 text-xs text-slate-800">
        <span className="h-2 w-2 rounded-full bg-[#8AC389] mt-1 shrink-0" aria-hidden="true" />
        <div className="flex flex-col leading-tight">
          <span className="font-medium text-slate-900 text-xs">{dateStr || 'Today'}</span>
          {timeStr && <span className="font-medium text-slate-800 text-xs font-mono">{timeStr}</span>}
        </div>
      </div>
      {canSync ? (
        <Button
          type="button"
          variant="secondary"
          onClick={handleSync}
          disabled={syncing}
          className="inline-flex items-center justify-center gap-2 h-9 px-4 rounded-xl text-xs font-bold text-slate-950 bg-white border border-slate-200 shadow-sm hover:bg-slate-50 hover:border-slate-300 active:scale-[0.98] transition-all disabled:opacity-50"
          title="Collect the latest VMware data through vCenter, vSphere Replication, and Site Recovery Manager."
          aria-label={syncing ? 'Loading...' : 'Sync'}
        >
          {!syncing && <RefreshCw size={14} className="shrink-0 text-slate-950" aria-hidden="true" />}
          <span>{syncing ? 'Loading...' : 'Sync'}</span>
        </Button>
      ) : (
        <span className="inline-flex items-center justify-center gap-2 h-9 px-4 rounded-xl text-xs font-bold text-slate-400 bg-white border border-slate-200">
          <RefreshCw size={14} className="shrink-0 text-slate-300" aria-hidden="true" />
          <span>Sync</span>
        </span>
      )}
    </div>
  );
}
