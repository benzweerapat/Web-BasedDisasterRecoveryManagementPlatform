const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const {initializeRuntime}=require('./initialize-runtime');
test('first launch creates keys once and restart preserves matching data keys',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'srm-runtime-'));
 try{const a={SRM_DATA_DIR:dir};initializeRuntime(a);assert.equal(a.PORT,'3002');assert.equal(Buffer.from(a.VMWARE_CREDENTIAL_KEY,'base64').length,32);fs.writeFileSync(a.SRM_STATE_FILE,'{}');const b={SRM_DATA_DIR:dir};initializeRuntime(b);assert.equal(a.VMWARE_CREDENTIAL_KEY,b.VMWARE_CREDENTIAL_KEY);fs.unlinkSync(path.join(dir,'runtime-secrets.json'));assert.throws(()=>initializeRuntime({SRM_DATA_DIR:dir}),/original encryption key/);}finally{fs.rmSync(dir,{recursive:true,force:true});}
});
