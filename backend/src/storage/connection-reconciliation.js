'use strict';
const {encryptCredential,decryptCredential}=require('../utils/encryption.util');
async function apply(pool,rows){
 const client=await pool.connect();
 try{
  await client.begin();
  await client.run(s=>{
   const ids=new Set(rows.map(r=>r.id));
   const activeVcUrls=new Set(rows.filter(r=>r.type==='VCENTER').map(r=>r.baseUrl));
   const isKnownVc=vId=>activeVcUrls.has(vId)||(Boolean(vId)&&Array.from(activeVcUrls).some(u=>Boolean(u)&&vId.replace(/\/+$/,'')===u.replace(/\/+$/,'')));

   const removedConns=s.read('connections').filter(c=>!ids.has(c.id));
   for(const conn of removedConns){
    const cid=conn.id;
    const burl=conn.base_url;
    const isVc=vId=>vId===burl||(Boolean(burl)&&Boolean(vId)&&vId.replace(/\/+$/,'')===burl.replace(/\/+$/,''));
    s.remove('connections',c=>c.id===cid);
    s.remove('vcenters',v=>v.connection_id===cid||isVc(v.vcenter_id));
    s.remove('hosts',h=>isVc(h.vcenter_id));
    s.remove('datastores',d=>isVc(d.vcenter_id));
    s.remove('networks',n=>isVc(n.vcenter_id));
    s.remove('clusters',cl=>isVc(cl.vcenter_id));
    s.remove('datacenters',dc=>isVc(dc.vcenter_id));
    s.remove('resource_pools',rp=>isVc(rp.vcenter_id));
    s.remove('virtual_machines',vm=>isVc(vm.vcenter_id));
    s.remove('vm_datastore_mappings',m=>isVc(m.vcenter_id));
    s.remove('vm_network_mappings',m=>isVc(m.vcenter_id));
    s.remove('host_datastore_mappings',m=>isVc(m.vcenter_id));
    s.remove('host_network_mappings',m=>isVc(m.vcenter_id));
    s.remove('vr_pairings',r=>r.connection_id===cid);
    s.remove('vr_sync_state',r=>r.connection_id===cid);
    s.remove('vr_management_servers',r=>r.connection_id===cid);
    s.remove('vr_replication_servers',r=>r.connection_id===cid);
    s.remove('vr_replications',r=>r.connection_id===cid);
    s.remove('vr_replication_issues',r=>r.connection_id===cid);
    s.remove('vr_tasks',r=>r.connection_id===cid);
    s.remove('vr_connection_links',r=>r.local_vr_connection_id===cid||r.remote_vr_connection_id===cid);
    s.remove('srm_sync_state',r=>r.connection_id===cid);
    s.remove('srm_site_pairs',r=>r.connection_id===cid);
    s.remove('srm_servers',r=>r.connection_id===cid);
    s.remove('srm_protection_groups',r=>r.connection_id===cid);
    s.remove('srm_protected_vms',r=>r.connection_id===cid);
    s.remove('srm_recovery_plans',r=>r.connection_id===cid);
    s.remove('srm_recovery_plan_groups',r=>r.connection_id===cid);
    s.remove('srm_recovery_plan_vms',r=>r.connection_id===cid);
    s.remove('srm_placeholder_datastores',r=>r.connection_id===cid);
    s.remove('srm_inventory_mappings',r=>r.connection_id===cid);
    s.remove('srm_tasks',r=>r.connection_id===cid);
    s.remove('srm_issues',r=>r.connection_id===cid);
    s.remove('tasks',t=>t.connection_id===cid||t.remote_connection_id===cid);
   }

   // Also remove any orphan inventory and replica rows not belonging to any active connection
   s.remove('connections',c=>!ids.has(c.id));
   s.remove('vcenters',v=>!ids.has(v.connection_id)||!isKnownVc(v.vcenter_id));
   s.remove('hosts',h=>!isKnownVc(h.vcenter_id));
   s.remove('datastores',d=>!isKnownVc(d.vcenter_id));
   s.remove('networks',n=>!isKnownVc(n.vcenter_id));
   s.remove('clusters',cl=>!isKnownVc(cl.vcenter_id));
   s.remove('datacenters',dc=>!isKnownVc(dc.vcenter_id));
   s.remove('resource_pools',rp=>!isKnownVc(rp.vcenter_id));
   s.remove('virtual_machines',vm=>!isKnownVc(vm.vcenter_id));
   s.remove('vm_datastore_mappings',m=>!isKnownVc(m.vcenter_id));
   s.remove('vm_network_mappings',m=>!isKnownVc(m.vcenter_id));
   s.remove('host_datastore_mappings',m=>!isKnownVc(m.vcenter_id));
   s.remove('host_network_mappings',m=>!isKnownVc(m.vcenter_id));
   s.remove('vr_pairings',r=>!ids.has(r.connection_id));
   s.remove('vr_sync_state',r=>!ids.has(r.connection_id));
   s.remove('vr_management_servers',r=>!ids.has(r.connection_id));
   s.remove('vr_replication_servers',r=>!ids.has(r.connection_id));
   s.remove('vr_replications',r=>!ids.has(r.connection_id));
   s.remove('vr_replication_issues',r=>!ids.has(r.connection_id));
   s.remove('vr_tasks',r=>!ids.has(r.connection_id));
   s.remove('vr_connection_links',r=>!ids.has(r.local_vr_connection_id)||!ids.has(r.remote_vr_connection_id));
   s.remove('srm_sync_state',r=>!ids.has(r.connection_id));
   s.remove('srm_site_pairs',r=>!ids.has(r.connection_id));
   s.remove('srm_servers',r=>!ids.has(r.connection_id));
   s.remove('srm_protection_groups',r=>!ids.has(r.connection_id));
   s.remove('srm_protected_vms',r=>!ids.has(r.connection_id));
   s.remove('srm_recovery_plans',r=>!ids.has(r.connection_id));
   s.remove('srm_recovery_plan_groups',r=>!ids.has(r.connection_id));
   s.remove('srm_recovery_plan_vms',r=>!ids.has(r.connection_id));
   s.remove('srm_placeholder_datastores',r=>!ids.has(r.connection_id));
   s.remove('srm_inventory_mappings',r=>!ids.has(r.connection_id));
   s.remove('srm_tasks',r=>!ids.has(r.connection_id));
   s.remove('srm_issues',r=>!ids.has(r.connection_id));

   for(const c of rows){
    const old=s.read('connections').find(r=>r.id===c.id);
    let credentialChanged=true;
    if(old?.encrypted_password){try{credentialChanged=decryptCredential(old.encrypted_password,old.encryption_iv,old.encryption_auth_tag)!==c.password;}catch{}}
    const encrypted=credentialChanged?encryptCredential(c.password):null;
    const values={connection_name:c.name,system_type:c.type,site:c.site,base_url:c.baseUrl,username:c.username,verify_tls:c.verifyTls,is_active:true,associated_vcenter_connection_id:c.type==='VCENTER'?null:c.vcenterId,credential_source_connection_id:null};
    if(encrypted)Object.assign(values,{encrypted_password:encrypted.encryptedPassword,encryption_iv:encrypted.encryptionIv,encryption_auth_tag:encrypted.encryptionAuthTag});
    if(credentialChanged||old?.username!==c.username||old?.base_url!==c.baseUrl)Object.assign(values,{last_connection_status:'UNTESTED',last_tested_at:null});
    if(old)s.update('connections',r=>r.id===c.id,()=>values);
    else s.insert('connections',[{id:c.id,...values,last_sync_status:'NEVER_SYNCED'}]);
   }
   s.data.sequences.connections=Math.max(s.data.sequences.connections||0,...rows.map(c=>c.id),0);
  },[],true);
  await client.commit();
 }catch(e){await client.rollback();throw e;}finally{client.release();}
}
module.exports={apply};
