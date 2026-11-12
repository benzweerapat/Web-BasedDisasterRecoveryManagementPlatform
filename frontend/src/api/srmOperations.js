import api, { invalidateReadCache } from './apiClient';

const keys=new Map();
export function operationKey(method,url,body) {
  const fingerprint=JSON.stringify([method,url,body]);
  if(!keys.has(fingerprint))keys.set(fingerprint,crypto.randomUUID());
  return keys.get(fingerprint);
}
export function clearOperationKey(method,url,body) {
  const fingerprint=JSON.stringify([method,url,body]);
  keys.delete(fingerprint);
}
export function clearAllOperationKeys() {
  keys.clear();
}
export async function submitSrm(method,url,body,customKey) {
  const key=customKey||operationKey(method,url,body);
  try {
    const response=await api.request({method,url,data:body,headers:{'Idempotency-Key':key}});
    if(!response.data?.data?.operationId)throw new Error('SRM did not return an operation ID. Wait for the current request to finish, then refresh before submitting again.');
    return response.data.data;
  } catch(err) {
    if(!customKey) clearOperationKey(method,url,body);
    throw err;
  }
}
export const srmMutation={
  post:async(url,body,config)=>({data:{data:await submitSrm('POST',url,body,config?.headers?.['Idempotency-Key'])}}),
  delete:async(url,config)=>({data:{data:await submitSrm('DELETE',url,config?.data,config?.headers?.['Idempotency-Key'])}})
};
export async function waitSrmOperation(operationId,onStatus=()=>{},options={}) {
  if(!operationId)throw new Error('Missing SRM operation ID.');
  const sleep=options.sleep||((ms)=>new Promise(resolve=>setTimeout(resolve,ms)));
  for(let attempt=0;attempt<(options.attempts??120);attempt++) {
    let response;
    try{response=await api.get(`/srm/operations/${encodeURIComponent(operationId)}`);}
    catch{onStatus('Status unavailable — operation remains pending');await sleep(2000);continue;}
    const op=response.data?.data;
    if(!op?.state)throw new Error('SRM operation status is unavailable. Wait briefly, then refresh the current page.');
    onStatus(op.state);
    if(op.state==='SUCCESS'){
      clearAllOperationKeys();
      invalidateReadCache();
      return op;
    }
    // RECONCILIATION_REQUIRED is transient: the backend performs one
    // authoritative read before deciding success or requiring operator action.
    if(['FAILED','RECONCILIATION_BLOCKED','ROLLBACK_SUCCESS','ROLLBACK_FAILED'].includes(op.state)){
      clearAllOperationKeys();
      const code=op.error||op.state;
      const message=op.safeMessage||op.finalOutcome||`The SRM operation requires attention (${code}).`;
      throw Object.assign(new Error(message),{code,safeMessage:message,operationState:op.state});
    }
    await sleep(2000);
  }
  throw new Error('SRM operation is still pending. Checking again will resume tracking the same operation.');
}
const value=(object,...keys)=>keys.map(key=>object?.[key]).find(item=>item!==undefined&&item!==null);
export function directionalObjectForPair(pairs,object) {
  const observations=Array.isArray(object?.observations)?object.observations:[];
  if(!observations.length)return object;
  const expectedProtected=value(object,'protectedSiteName','protected_site_name');
  const expectedRecovery=value(object,'recoverySiteName','recovery_site_name');
  const ordered=[
    ...observations.filter(observation=>
      (!expectedProtected||value(observation,'protectedSiteName','protected_site_name')===expectedProtected)&&
      (!expectedRecovery||value(observation,'recoverySiteName','recovery_site_name')===expectedRecovery)),
    ...observations.filter(observation=>
      !((!expectedProtected||value(observation,'protectedSiteName','protected_site_name')===expectedProtected)&&
        (!expectedRecovery||value(observation,'recoverySiteName','recovery_site_name')===expectedRecovery)))
  ];
  for(const observation of ordered){
    const pair=pairs.find(candidate=>
      String(value(candidate,'pairing_id','pairingId'))===String(value(observation,'pairingId','pairing_id'))&&
      String(value(candidate,'connection_id','connectionId'))===String(value(observation,'connectionId','connection_id')));
    if(!pair)continue;
    const protectedSite=value(observation,'protectedSiteName','protected_site_name');
    const recoverySite=value(observation,'recoverySiteName','recovery_site_name');
    const localSite=value(pair,'local_site_name','localSiteName');
    const remoteSite=value(pair,'remote_site_name','remoteSiteName');
    if((!protectedSite||!localSite||protectedSite===localSite)&&(!recoverySite||!remoteSite||recoverySite===remoteSite))return observation;
  }
  // Keep the canonical primary when no observation can be proved to match the
  // requested direction. This avoids acting on an arbitrary reversed record.
  return object;
}
export function pairForObject(pairs,object) {
  object=directionalObjectForPair(pairs,object);
  const matches=pairs.filter(p=>
    String(p.pairing_id??p.pairingId)===String(object.pairingId??object.pairing_id)&&
    String(p.connection_id??p.connectionId)===String(object.connectionId??object.connection_id));
  return matches.length===1?matches[0].id:null;
}

// Return every exact object/pair combination for a canonical SRM entity. A
// recovery plan can have a different VMware object ID on each SRM appliance;
// callers may try the preferred direction first and safely fall back to the
// peer observation when the cached direction changes after Test/Cleanup.
export function operationTargetsForObject(pairs,object) {
  const preferred=directionalObjectForPair(pairs,object);
  const observations=Array.isArray(object?.observations)?object.observations:[];
  const seen=new Set();
  const candidates=observations.length?[preferred,...observations]:[object];
  return candidates.flatMap(plan=>{
    if(!plan)return [];
    const pairId=pairForObject(pairs,plan);
    const objectId=value(plan,'recoveryPlanId','recovery_plan_id','protectionGroupId','protection_group_id','id');
    if(!pairId||!objectId)return [];
    const key=`${pairId}:${objectId}`;
    if(seen.has(key))return [];
    seen.add(key);
    return [{plan,pairId}];
  });
}
