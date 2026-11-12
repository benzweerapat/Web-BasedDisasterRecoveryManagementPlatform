const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http'),crypto=require('node:crypto');
const {fork}=require('node:child_process');
test('fresh installation requires no config files and retains accounts, secrets and settings after restart',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'srm-restart-'));let child;
 async function start(){child=fork(path.join(__dirname,'../../server.js'),[],{env:{...process.env,SRM_DATA_DIR:dir,SRM_STATE_FILE:path.join(dir,'application.json'),SESSION_SECRET:'',VMWARE_CREDENTIAL_KEY:'',PORT:'0',HOST:'127.0.0.1',NODE_ENV:'production'},stdio:['ignore','ignore','ignore','ipc']});return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{child.kill();reject(Error('Server did not start'));},10000);child.once('exit',code=>{clearTimeout(timer);reject(Error('Server exited before ready: '+code));});child.on('message',m=>{if(m.type==='ready'){clearTimeout(timer);resolve(m.port);}});});}
 async function stop(){if(!child||child.exitCode!==null)return;await new Promise(resolve=>{const timer=setTimeout(()=>child.kill('SIGKILL'),3000);child.once('exit',()=>{clearTimeout(timer);resolve();});child.kill('SIGTERM');});}
 t.after(async()=>{await stop();fs.rmSync(dir,{recursive:true,force:true});});
 let port=await start(),cookie='',csrf='';
 const request=(url,method='GET',data)=>new Promise((resolve,reject)=>{const body=data?JSON.stringify(data):undefined;const req=http.request({host:'127.0.0.1',port,path:'/api'+url,method,headers:{Cookie:cookie,'X-CSRF-Token':csrf,...(body?{'Content-Type':'application/json'}:{})}},res=>{let text='';res.on('data',part=>text+=part);res.on('end',()=>{if(res.headers['set-cookie'])cookie=res.headers['set-cookie'][0].split(';')[0];if(res.headers['x-csrf-token'])csrf=res.headers['x-csrf-token'];resolve({status:res.statusCode,data:JSON.parse(text)});});});req.on('error',reject);req.end(body);});
 await request('/security/csrf-token');
 const password=crypto.randomBytes(16).toString('hex');
 assert.equal((await request('/auth/setup','POST',{username:'restart-admin',password})).status,200);
 assert.equal((await request('/connections','POST',{name:'Restart vCenter',type:'VCENTER',site:'TEST',baseUrl:'https://vcenter.example.invalid',username:'mock-user',password:crypto.randomBytes(16).toString('hex'),verifyTls:true,vcenterId:null})).status,200);
 assert.equal((await request('/settings/ai','PUT',{enabled:false,model:'mock-model',fallbackModel:'',timeoutMs:30000,apiKey:crypto.randomBytes(16).toString('hex'),allowExternalSharing:false})).status,200);
 const keys=fs.readFileSync(path.join(dir,'runtime-secrets.json'),'utf8');
 await stop();port=await start();
 assert.equal((await request('/auth/me')).status,200);
 assert.equal((await request('/connections')).data[0].connectionName,'Restart vCenter');
 assert.equal((await request('/settings/ai')).data.data.hasApiKey,true);
 assert.equal(fs.readFileSync(path.join(dir,'runtime-secrets.json'),'utf8'),keys);
 assert.equal(fs.existsSync(path.join(dir,'connections.json')),false);
 assert.equal(fs.existsSync(path.join(dir,'.env')),false);
});
