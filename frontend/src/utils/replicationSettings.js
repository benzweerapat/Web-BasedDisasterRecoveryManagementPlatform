export const formatRpo=minutes=>Number(minutes)%60===0?`${Number(minutes)/60} hour${Number(minutes)===60?'':'s'}`:`${minutes} minutes`;
export function validSettings(config,form) {
  const rpo=Number(form?.rpo),s=config?.settings;
  return Number.isInteger(rpo)&&rpo>=config?.rpo?.min&&rpo<=config?.rpo?.max&&(!s?.encryptionRequired||form.encryption===true)&&
    (!form?.mpit||(s?.mpitSupported===true&&Number.isInteger(Number(form.mpitInstances))&&Number.isInteger(Number(form.mpitDays))&&Number(form.mpitInstances)>0&&Number(form.mpitDays)>0&&Number(form.mpitInstances)*Number(form.mpitDays)<=s.mpitMaxTotal));
}
