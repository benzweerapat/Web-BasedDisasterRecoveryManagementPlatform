const gateway=require('../services/srm-write-gateway');
const journal=require('../repositories/srm-write.repository');
const {spec,getRecoveryPlanActions}=require('../services/recovery-execution');
const {classifyOperationError,operationError}=require('../utils/operation-error.util');
const {buildSafeError}=require('../utils/api-response.util');

const wrap=fn=>async(req,res)=>{
  try{
    await fn(req,res);
  }catch(e){
    const safe=classifyOperationError(e);
    res.status(safe.httpStatus).json(buildSafeError(req,safe));
  }
};

async function database(fn){
  try{
    return await fn();
  }catch(e){
    if(e.name!=='SafetyError'&&e.constructor?.name!=='SafetyError')e.origin='DATABASE';
    throw e;
  }
}

async function withGatewayAvailable(intent,fn){
  // Local session admission now queues with a bounded timeout in the shared
  // adapter. Do not multiply that wait or retry uncertain login outcomes here.
  return gateway.withGateway(intent,fn);
}

async function context(req){
  const pairId=Number(req.body?.pairId||req.query?.pairId);

  if(!Number.isSafeInteger(pairId)||pairId<1||typeof req.params.id!=='string'||!req.params.id.length)throw operationError('VALIDATION_ERROR');

  const x=await database(()=>gateway.context(pairId));

  return {
    x,
    intent:{
      kind:'execution',
      pairId,
      scopeIdentity:x.identity,
      objectId:req.params.id
    }
  };
}

exports.options=wrap(async(req,res)=>{
  const {intent}=await context(req);

  const {plan,preflight}=await withGatewayAvailable(intent,async g=>{
    const plan=await g.readPlan(intent.objectId);
    let preflight;

    try{
      preflight=await g.preflightPlan(
        intent.objectId,
        ['RECOVERY_COMPLETE','REPROTECT_INTERRUPTED','REPROTECT_INCOMPLETE'].includes(plan.status)
          ?'reprotect'
          :undefined
      );
    }catch(e){
      preflight={
        ready:false,
        blockers:[
          {
            code:'RECOVERY_PREFLIGHT_UNAVAILABLE'
          }
        ],
        errorCode:classifyOperationError(e).code
      };
    }

    return {
      plan,
      preflight
    };
  });

  const active=await database(()=>journal.latestExecution(intent.pairId,intent.objectId));
  const matrix=getRecoveryPlanActions(plan,active,req.session.user.role,preflight);

  res.json({
    data:{
      name:plan.name,
      status:plan.status,
      isRunning:plan.is_running,
      source:plan.protected_site_name,
      target:plan.recovery_site_name,
      actions:matrix.actions,
      actionAvailability:matrix,
      preflight,
      cancelAvailability:'OWNED_ACTIVE_OPERATION_ONLY'
    }
  });
});

exports.submit=wrap(async(req,res)=>{
  const user=req.session.user,action=req.params.action;

  if(!['OPERATOR','ADMIN'].includes(user.role)||(['migration','recovery','reprotect'].includes(action)&&user.role!=='ADMIN'))throw Object.assign(Error(),{code:'FORBIDDEN'});

  const body=req.body||{},key=req.get('Idempotency-Key');

  const allowedFields=action==='test'
    ?['pairId','confirmed','confirmName','syncData']
    :['pairId','confirmed','confirmName'];

  if((action==='test'&&body.syncData!==undefined&&typeof body.syncData!=='boolean')||body.confirmed!==true||typeof body.confirmName!=='string'||Object.keys(body).some(k=>!allowedFields.includes(k))||typeof key!=='string'||key.length<8||key.length>128)throw operationError('VALIDATION_ERROR');

  spec(action,{syncData:body.syncData});

  const {x,intent}=await context(req);

  Object.assign(intent,{
    action,
    confirmName:body.confirmName,
    ...(action==='test'?{syncData:body.syncData===true}:{})
  });

  // Reserve a durable operation before contacting SRM. The worker repeats the
  // authoritative plan/name/action/preflight checks while the operation is in
  // VALIDATING. This guarantees that a transient SRM read or session failure is
  // observable and retryable instead of leaving the UI with an untracked
  // "Operation not confirmed" response.
  res.status(202).json({
    data:journal.safe(
      await database(
        ()=>journal.reserve(intent,user,req.id,key,x.scope)
      )
    )
  });
});

exports.progress=wrap(async(req,res)=>{
  const {intent}=await context(req),op=await database(()=>journal.latestExecution(intent.pairId,intent.objectId));

  // Progress polling is a local journal read. The cancel endpoint and worker
  // independently verify the live plan/task before sending cancellation.
  const role=req.authUser?.role||req.session?.user?.role;

  const cancelAllowed=Boolean(
    op?.state==='TASK_RUNNING'&&
    op.data.vmwareStatus==='RUNNING'&&
    !op.data.cancelState&&
    (
      role==='ADMIN'||
      (
        role==='OPERATOR'&&
        ['test','cleanup'].includes(op.intent.action)
      )
    )
  );

  res.json({
    data:op
      ?{
        ...journal.safe(op),
        cancelAllowed
      }
      :null
  });
});

exports.cancel=wrap(async(req,res)=>{
  if(req.body?.confirmed!==true)throw operationError('VALIDATION_ERROR');

  const {intent}=await context(req);

  const writeRequest=()=>journal.withOperationLock(req.params.operationId,async op=>{
    if(!op||op.intent.kind!=='execution'||op.intent.objectId!==intent.objectId||op.intent.scopeIdentity!==intent.scopeIdentity)throw operationError('INVALID_STATE');

    if(!['ADMIN','OPERATOR'].includes(req.authUser.role)||(['migration','recovery','reprotect'].includes(op.intent.action)&&req.authUser.role!=='ADMIN'))throw Object.assign(Error(),{code:'FORBIDDEN'});

    if(op.data.cancelState)return journal.safe(op);

    // Persist the user's cancellation intent while holding the operation lock.
    // SRM can expose a RUNNING task a few seconds before the plan reaches a
    // cancellable execution phase. The worker rechecks both objects and sends
    // the single cancel POST only when that phase is observable.
    if(op.state!=='TASK_RUNNING'||op.data.vmwareStatus!=='RUNNING'||!op.data.taskId)throw operationError('INVALID_STATE');

    return journal.safe(
      await journal.transition(
        op,
        op.state,
        {
          cancelState:'REQUESTED',
          cancelPolls:0,
          cancelAttempts:0,
          cancelRequestedBy:req.authUser.username,
          cancelRequestedRole:req.authUser.role,
          cancelRequestId:req.id,
          cancelRequestedAt:new Date().toISOString()
        }
      )
    );
  });

  // The worker owns this lock while it performs live reads. Wait briefly for
  // that read cycle instead of exposing a transient OPERATION_BUSY to users.
  let data;

  for(let attempt=0;attempt<60;attempt++){
    try{
      data=await writeRequest();
      break;
    }
    catch(e){
      if(e.code!=='OPERATION_BUSY'||attempt===59)throw e;
      await new Promise(resolve=>setTimeout(resolve,100));
    }
  }

  res.status(202).json({data});
});
