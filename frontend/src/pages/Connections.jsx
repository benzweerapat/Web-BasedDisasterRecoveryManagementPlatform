import ConnectionEditor from '../components/shared/ConnectionEditor';
import Button from '../components/shared/Button';
import { useEffect, useState, useRef } from 'react';
import { Activity, CheckCircle2, RefreshCw } from 'lucide-react';
import apiClient from '../api/apiClient';
import { PageActionHeader } from '../components/shared';
import {runSync} from '../api/sync-schedule';



const formatDate = value => value ? new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : 'Not collected';
const endpointHost = value => { try { return new URL(value).host; } catch { return value || 'Not configured'; } };
const statusTone = value => {
  const status = String(value || '').toUpperCase();
  if (['CONNECTED', 'OK', 'SUCCESS', 'SYNCED'].includes(status)) return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  if (['FAILED', 'ERROR', 'DISCONNECTED'].includes(status)) return 'bg-red-50 text-red-700 border-red-200';
  return 'bg-slate-100 text-slate-600 border-slate-200';
};
const statusLabel = value => ({ CONNECTED:'Connected', DISCONNECTED:'Disconnected', FAILED:'Failed', ERROR:'Failed', AUTH_FAILED:'Authentication failed', TLS_ERROR:'TLS failed', TIMEOUT:'Timed out', UNREACHABLE:'Unreachable', SYNCING:'Syncing', UNTESTED:'Not tested' }[String(value || 'UNTESTED').toUpperCase()] || String(value).replaceAll('_',' ').toLowerCase().replace(/^./, char => char.toUpperCase()));
const requestErrorMessage = (requestError, fallback) => {
  const body = requestError?.response?.data || {};
  const code = body?.error?.code || body?.code;
  const message = body?.error?.safeMessage || body?.safeMessage || body?.message || fallback;
  return code && !String(message).includes(code) ? `${message} (${code})` : message;
};

export default function Connections({ user }) {
  const [editor,setEditor]=useState(null);
  const [connections, setConnections] = useState(() => apiClient.peek?.('/connections')?.data || []);
  const [loading, setLoading] = useState(() => !apiClient.peek?.('/connections'));
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [syncingId, setSyncingId] = useState(null);
  const [testingId, setTestingId] = useState(null);
  const [refreshing,setRefreshing]=useState(false);
  const requestSequence=useRef(0);

  const fetchConnections = async (preserveFeedback = false, force = true) => {
    const sequence=++requestSequence.current;if(force!==false)setRefreshing(true);
    setLoading(!connections.length && !apiClient.peek?.('/connections')); if (!preserveFeedback) setError('');
    try { const response = await apiClient.get('/connections', {refresh:force}); if(sequence===requestSequence.current)setConnections(Array.isArray(response.data) ? response.data : []); }
    catch { if(sequence===requestSequence.current)setError('Unable to load VMware connections.'); }
    finally { if(sequence===requestSequence.current){setLoading(false);setRefreshing(false);} }
  };
  useEffect(() => { fetchConnections(false,false);const refresh=()=>fetchConnections(true,true);window.addEventListener('inventory-cache-invalidated',refresh);return()=>window.removeEventListener('inventory-cache-invalidated',refresh); }, []);

  const syncPathFor = connection => connection.systemType === 'VR' ? `/vr/connections/${connection.id}/sync` : connection.systemType === 'SRM' ? `/srm/connections/${connection.id}/sync` : `/connections/${connection.id}/sync`;
  
  const testConnection = async connection => {
    setTestingId(connection.id); setError(''); setNotice('');
    try {
      const response = await apiClient.post(`/connections/${connection.id}/test`);
      setNotice(response.data?.message || `Connected to ${connection.connectionName}`);
      await fetchConnections(true);
    } catch (requestError) {
      setError(requestErrorMessage(requestError, `Unable to connect to ${connection.connectionName}.`));
    } finally {
      setTestingId(null);
    }
  };

  const syncConnection = async connection => {
    setSyncingId(connection.id); setError(''); setNotice('');
    const path = syncPathFor(connection);
    try { await runSync(() => apiClient.post(path)); setNotice(`${connection.connectionName} sync completed.`); await fetchConnections(true); }
    catch (requestError) { setError(requestErrorMessage(requestError, `Unable to sync ${connection.connectionName}.`)); }
    finally { setSyncingId(null); }
  };
  const removeConnection=async connection=>{if(!window.confirm(`Remove ${connection.connectionName} and its cached inventory? This does not remove VMware objects.`))return;setError('');try{await apiClient.delete(`/connections/${connection.id}`);await fetchConnections(true);}catch(e){setError(requestErrorMessage(e,'Unable to remove server.'));}};
  return <div className="mx-auto max-w-[1600px] space-y-6">
    {editor&&<ConnectionEditor connection={editor.id?editor:null} connections={connections} onSaved={()=>fetchConnections(true)} onClose={()=>setEditor(null)}/>}
    {user?.role==='ADMIN'&&<button onClick={()=>setEditor({})} className="rounded-lg bg-slate-950 px-4 py-2 text-white">Add server</button>}
    <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <h1 className="sr-only">VMware connections</h1>
      <PageActionHeader
        onRefresh={() => fetchConnections(true)}
        refreshing={refreshing}
        refreshLabel="Reload list"
        refreshAriaLabel="Reload connection list"
        refreshTitle="Reload saved connection status only. This does not contact VMware."
        user={user}
        onSyncCompleted={() => fetchConnections(true)}
      />
      <span className="sr-only">{'Use test or sync' + ' to contact VMware'}</span>
    </header>
    {notice && <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700" role="status"><CheckCircle2 size={17} />{notice}</div>}
    {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">{error}</div>}
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="overflow-x-auto"><table className="min-w-[1180px] w-full text-left text-sm"><thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold tracking-wider text-slate-500"><tr>{['Server name','Type','Host / IP','Username','Last collected','Actions'].map(label => <th key={label} className="px-5 py-3">{label}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">
        {connections.map(connection => {
          const connected = String(connection.lastConnectionStatus || '').toUpperCase() === 'CONNECTED';
          const canSync = connection.systemType !== 'VCENTER' || connected;
          const isActive = testingId === connection.id || syncingId === connection.id;
          return (
            <tr key={connection.id} className={isActive ? 'bg-[#ECEDEF]' : 'hover:bg-slate-50'}>
              <td className="px-5 py-4"><p className="font-medium text-slate-900">{connection.connectionName}</p><p className="text-xs text-slate-500">{connection.site}</p></td>
              <td className="px-5 py-4 font-normal text-slate-600">{connection.systemType}</td>
              <td className="px-5 py-4 font-mono text-xs text-slate-600">{endpointHost(connection.baseUrl)}</td>
              <td className="px-5 py-4 text-slate-600">{connection.username || 'Not available'}</td>
              <td className="px-5 py-4 text-xs text-slate-600">{formatDate(connection.lastCollectedAt)}</td>
              <td className="px-5 py-4">
                <div className="flex items-center gap-1">
                  {user?.role==='ADMIN'&&<><button onClick={()=>setEditor(connection)} disabled={isActive} className="rounded border px-2 py-1 text-xs">Edit</button><button onClick={()=>removeConnection(connection)} disabled={isActive} className="rounded border px-2 py-1 text-xs text-red-700">Remove</button></>}
                  <Button
                    variant="secondary"
                    onClick={() => testConnection(connection)}
                    disabled={testingId === connection.id || syncingId === connection.id}
                    title="Test connection"
                    aria-label={`Test ${connection.connectionName}`}
                    className={`rounded-lg bg-white p-2 text-slate-950 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 ${testingId === connection.id ? 'border-slate-950' : 'border-slate-200'}`}
                  >
                    {testingId === connection.id ? 'Loading...' : <Activity size={17} />}
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => syncConnection(connection)}
                    disabled={syncingId === connection.id || testingId === connection.id || !canSync}
                    title="Sync"
                    aria-label={`Sync ${connection.connectionName}`}
                    className={`rounded-lg bg-white p-2 text-slate-950 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 ${syncingId === connection.id ? 'border-slate-950' : 'border-slate-200'}`}
                  >
                    {syncingId === connection.id ? 'Loading...' : <RefreshCw size={17} />}
                  </Button>
                </div>
              </td>
            </tr>
          );
        })}
        {!loading && !connections.length && <tr><td colSpan="6" className="px-6 py-14 text-center text-slate-500">{error ? 'Unable to load VMware connections.' : 'No connections found.'}</td></tr>}
        {loading && !connections.length && (
          <tr>
            <td colSpan="6" className="px-6 py-14 text-center text-slate-500">
              Loading...
            </td>
          </tr>
        )}
      </tbody></table></div>
    </section>
      </div>;
}
