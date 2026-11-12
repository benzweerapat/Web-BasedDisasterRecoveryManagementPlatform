const fs=require('node:fs');
const path=require('node:path');
const {pool}=require('../../db');

const filename=path.join(
  path.dirname(pool.filename),
  'sync-schedule.json'
);

let state={
  seconds:0,
  running:false,
  lastAt:null,
  status:null,
  nextAt:null,
  error:null
};

let timer;

try {
  const saved=JSON.parse(
    fs.readFileSync(filename,'utf8')
  );

  if(
    Number.isInteger(saved.seconds) &&
    saved.seconds>=0 &&
    saved.seconds<=86400 &&
    (saved.seconds===0 || saved.seconds>=60)
  ){
    state={
      ...state,
      seconds:saved.seconds,
      lastAt:saved.lastAt||null,
      status:saved.status||null
    };
  }
} catch(e){
  if(e.code!=='ENOENT'){
    console.warn(
      'Sync schedule could not be loaded; automatic sync is disabled.'
    );
  }
}

function snapshot(){
  return {...state};
}

function persist(){
  const tmp=filename+'.tmp';

  fs.writeFileSync(
    tmp,
    JSON.stringify({
      seconds:state.seconds,
      lastAt:state.lastAt,
      status:state.status
    }),
    {mode:0o600}
  );

  fs.renameSync(tmp,filename);
}

function schedule(){
  clearTimeout(timer);
  state.nextAt=null;

  if(!state.seconds || state.running){
    return;
  }

  state.nextAt=new Date(
    Date.now()+state.seconds*1000
  ).toISOString();

  timer=setTimeout(run,state.seconds*1000);
  timer.unref?.();
}

function configure(seconds){
  if(
    !Number.isInteger(seconds) ||
    seconds<0 ||
    seconds>86400 ||
    (seconds>0 && seconds<60)
  ){
    throw Object.assign(
      Error('Use 0 or 60–86400 seconds'),
      {status:400}
    );
  }

  const old=state.seconds;
  state.seconds=seconds;

  try{
    persist();
  }catch(e){
    state.seconds=old;
    throw e;
  }

  schedule();
  return snapshot();
}

async function run(){
  if(state.running){
    return;
  }

  // A collection opens the same VMware sessions used by write verification.
  // Defer the scheduled collection until accepted writes have reached a
  // terminal state instead of competing with them and causing 429/session busy.
  const [srmPending,vrPending]=await Promise.all([
    require('../repositories/srm-write.repository').pending(),
    require('../repositories/vr-management.repository').pending()
  ]);

  if(srmPending.length || vrPending.length){
    state.status='DEFERRED';
    state.error='Automatic sync is waiting for background operations.';

    try{
      persist();
    }catch{
      state.error='Unable to save synchronization status';
    }

    schedule();
    return;
  }

  state.running=true;
  state.nextAt=null;
  state.error=null;

  try{
    const result=await require('./sync-all.service')
      .syncAllVmwareData({
        requestedBy:{
          username:'Automatic sync',
          role:'ADMIN'
        }
      });

    state.lastAt=
      result.completedAt ||
      new Date().toISOString();

    state.status=result.overallStatus;
  }catch(e){
    state.status=
      e.code==='SYNC_IN_PROGRESS'
        ? 'DEFERRED'
        : 'FAILED';

    state.error=
      e.code==='SYNC_IN_PROGRESS'
        ? 'Another synchronization is running.'
        : 'Automatic sync failed';
  }finally{
    state.running=false;

    try{
      persist();
    }catch{
      state.error='Unable to save synchronization status';
    }

    schedule();
  }
}

function record(result){
  state.lastAt=
    result.completedAt ||
    new Date().toISOString();

  state.status=
    result.overallStatus ||
    result.status ||
    'COMPLETED';

  try{
    persist();
  }catch{
    state.error='Unable to save synchronization status';
  }
}

module.exports={
  snapshot,
  configure,
  record,
  start:schedule,
  stop:()=>clearTimeout(timer)
};