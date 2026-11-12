export function displayName(value,fallback='Unavailable') {
  if(typeof value!=='string'||!value.trim())return fallback;
  if(/(?:VirtualMachine|DrRecovery|DrReplication|ProtectionGroup|RecoveryPlan|StorageProfile|HostSystem|ResourcePool|Network|Folder|Datastore):|\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b|^(?:vm|group|host|datastore|network|resgroup|domain|plan)-\d+$/i.test(value))return fallback;
  return value;
}
export const displayVmName=value=>displayName(value,'Unknown VM');
export const displaySiteName=value=>displayName(value,'Unknown site');
export const displayDatastoreName=value=>displayName(value,'Unavailable');
export const displayNetworkName=value=>displayName(value,'Unavailable');
export const displayResourceName=value=>displayName(value,'Unavailable');
export const displayProtectionGroupName=value=>displayName(value,'Unavailable');
export const displayRecoveryPlanName=value=>displayName(value,'Unavailable');
