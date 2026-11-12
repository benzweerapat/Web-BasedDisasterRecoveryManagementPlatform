import SignIn from './pages/SignIn';
import { Redirect, RouterProvider } from './router';
import { useLocation } from './router-hooks';
import Connections from './pages/Connections';
import VMs from './pages/VMs';
import ProtectionGroups from './pages/ProtectionGroups';
import RecoveryPlans from './pages/RecoveryPlans';
import Mappings from './pages/Mappings';
import VCenters from './pages/VCenters';
import Users from './pages/Users';
import Settings from './pages/Settings';
import DisasterRecoveryDashboard from './pages/DisasterRecoveryDashboard';
import VRDashboard from './pages/VR/VRDashboard';
import MainLayout from './layouts/MainLayout';

import { useState, useEffect } from 'react';
import {getSyncState,refreshSyncSchedule} from './api/sync-schedule';
import apiClient, { setCsrfToken, clearCsrfToken } from './api/apiClient';

const AUTHENTICATED_ROUTES = {
  '/vcenters': VCenters,
  '/vms': VMs,
  '/replications': VRDashboard,
  '/protection-groups': ProtectionGroups,
  '/recovery-plans': RecoveryPlans,
  '/inventory-mappings': Mappings,
  '/connections': Connections,
  '/dr-unified': DisasterRecoveryDashboard,
  '/users': Users,
  '/settings': Settings
};

function RoutedApplication({ user, setUser }) {
  const { pathname } = useLocation();
  if (pathname === '/login' && user) return <Redirect to="/dr-unified" />;
  if (!user) return <SignIn onSignedIn={setUser} />;
  if (pathname === '/' || pathname === '/overview') return <Redirect to="/dr-unified" />;
  if (pathname === '/vr') return <Redirect to="/replications" />;
  const Page = AUTHENTICATED_ROUTES[pathname];
  if (!Page) return <Redirect to="/dr-unified" />;
  return <MainLayout user={user} setUser={setUser}><Page user={user} /></MainLayout>;
}

function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchUser = async () => {
      try {
        const res = await apiClient.get('/auth/me');
        setUser(res.data.user);
        
        // Fetch CSRF token after confirming auth
        const csrfRes = await apiClient.get('/security/csrf-token');
        if (csrfRes.data?.csrfToken) {
          setCsrfToken(csrfRes.data.csrfToken);
        }
      } catch {
        setUser(null);
        clearCsrfToken();
      } finally {
        setLoading(false);
      }
    };
    fetchUser();

    // Listen for global unauthorized events (from apiClient interceptor)
    const handleUnauthorized = () => {
      setUser(null);
      clearCsrfToken();
    };
    window.addEventListener('auth:unauthorized', handleUnauthorized);

    return () => {
      window.removeEventListener('auth:unauthorized', handleUnauthorized);
    };
  }, []);

  useEffect(()=>{
    if(!user)return;
    const refresh=()=>refreshSyncSchedule().catch(()=>{});
    refresh();
    const timer=setInterval(()=>{const state=getSyncState();if(state.seconds||state.running)refresh();},10000);
    window.addEventListener('focus',refresh);
    return()=>{clearInterval(timer);window.removeEventListener('focus',refresh);};
  },[user]);

  if (loading) {
    return <div className="flex h-screen items-center justify-center bg-slate-50 text-slate-600">Loading...</div>;
  }

  return <RouterProvider><RoutedApplication user={user} setUser={setUser} /></RouterProvider>;
}

export default App;