'use strict';
const { app, BrowserWindow, utilityProcess, safeStorage, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
app.setName('SRM Monitoring');
let child, window, quitting = false;
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.focus(); } });
  app.whenReady().then(start).catch(() => {
    dialog.showErrorBox('Unable to start SRM Monitoring', 'The application could not open its secure storage or local service. Ensure your OS account vault is unlocked and another copy is not using this profile. Existing data has been preserved.');
    app.quit();
  });
}
async function vaultKeys(dataDir) {
  if (!await safeStorage.isAsyncEncryptionAvailable()) throw Error('OS vault unavailable');
  const filename = path.join(dataDir, 'vault.bin');
  if (fs.existsSync(filename)) {
    const result = await safeStorage.decryptStringAsync(fs.readFileSync(filename));
    const keys = JSON.parse(result.result);
    if (result.shouldReEncrypt) fs.writeFileSync(filename, await safeStorage.encryptStringAsync(JSON.stringify(keys)), {mode:0o600});
    return keys;
  }
  if (fs.existsSync(path.join(dataDir,'application.json'))) throw Error('Data exists without its vault key');
  const keys = { sessionSecret:crypto.randomBytes(48).toString('hex'), encryptionKey:crypto.randomBytes(32).toString('base64') };
  fs.writeFileSync(filename,await safeStorage.encryptStringAsync(JSON.stringify(keys)),{mode:0o600,flag:'wx'});
  return keys;
}
async function start() {
  const profile = process.env.SRM_DESKTOP_PROFILE || app.getPath('userData');
  const dataDir = path.join(profile,'data');
  fs.mkdirSync(dataDir,{recursive:true,mode:0o700});
  const keys = await vaultKeys(dataDir);
  const token = crypto.randomBytes(32).toString('hex');
  const source = app.isPackaged ? path.join(process.resourcesPath,'server') : path.join(__dirname,'..');
  child = utilityProcess.fork(path.join(source,'backend/server.js'),[],{
    cwd:source, serviceName:'SRM local service', stdio:'pipe',
    env:{...process.env,NODE_ENV:'production',HOST:'127.0.0.1',PORT:'0',SRM_DATA_DIR:dataDir,SRM_STATE_FILE:path.join(dataDir,'application.json'),SESSION_SECRET:keys.sessionSecret,VMWARE_CREDENTIAL_KEY:keys.encryptionKey,SRM_OS_VAULT:'true',SRM_DESKTOP_TOKEN:token,FRONTEND_ORIGIN:''}
  });
  // Do not stream backend diagnostics containing inventory to installer logs.
  child.stdout?.resume();child.stderr?.resume();
  const port = await new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>reject(Error('Local service timed out')),30000);
    child.once('exit',()=>{clearTimeout(timeout);reject(Error('Local service exited'));});
    child.on('message',message=>{if(message?.type==='ready'){clearTimeout(timeout);resolve(message.port);}});
  });
  const origin=`http://127.0.0.1:${port}`;
  window=new BrowserWindow({width:1440,height:960,minWidth:980,minHeight:700,show:false,title:'SRM Monitoring',webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true}});
  const ses=window.webContents.session;
  ses.setPermissionRequestHandler((_webContents,_permission,callback)=>callback(false));
  ses.setPermissionCheckHandler(()=>false);
  ses.webRequest.onBeforeRequest((details,callback)=>{
    let allowed=false;try{allowed=new URL(details.url).origin===origin;}catch{}
    // Packaged UI is fully local; external navigation/subresources are denied.
    callback({cancel:!allowed});
  });
  ses.webRequest.onBeforeSendHeaders((details,callback)=>{
    if(new URL(details.url).origin===origin)details.requestHeaders['X-Desktop-Token']=token;
    callback({requestHeaders:details.requestHeaders});
  });
  window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  window.webContents.on('will-navigate',(event,url)=>{if(new URL(url).origin!==origin)event.preventDefault();});
  window.on('closed',()=>{window=null;app.quit();});
  await window.loadURL(origin);
  window.show();
  child.on('exit',()=>{if(!quitting){dialog.showErrorBox('Local service stopped','Please restart the application. Your saved data remains in your profile.');app.quit();}});
}
app.on('before-quit',event=>{
  if(child?.pid&&!quitting){event.preventDefault();quitting=true;child.postMessage({type:'shutdown'});const timer=setTimeout(()=>{child.kill();app.quit();},4000);child.once('exit',()=>{clearTimeout(timer);app.quit();});}
});
