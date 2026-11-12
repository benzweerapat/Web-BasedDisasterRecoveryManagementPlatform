const service=require('../services/srm-write.service');
const journal=require('../repositories/srm-write.repository');
const gateway=require('../services/srm-write-gateway');
const {buildSafeError}=require('../utils/api-response.util');

const safeMessageFor=code=>({
  SRM_PAIR_WRITE_IN_PROGRESS:'A previous SRM operation for this object still needs verification. Other objects can continue in parallel; wait for this one to finish before retrying it.',
  PAIR_NOT_CURRENT:'The selected site pair changed. Refresh the page and select the direction again.',
  PAIR_NOT_FOUND:'The selected site pair is unavailable.',
  REMOTE_PAIR_AMBIGUOUS:'More than one remote SRM pairing matched this direction.',
  SRM_CONNECTION_UNAVAILABLE:'The SRM connection for this direction is unavailable.',
  IDEMPOTENCY_KEY_REUSED:'This request identifier was already used for a different operation.',
  NAME_LENGTH_INVALID:'The name is required and must not exceed 80 characters.',
  NAME_CHARACTERS_INVALID:'Use letters, numbers, spaces, periods, underscores, or hyphens only.'
  ,PROTECTION_GROUP_HAS_NO_VMS:'The selected Protection Group has no protected VM. Add and configure a replicated VM before adding it to a Recovery Plan.'
  ,PG_DIRECTION_MISMATCH:'The Protection Group belongs to the opposite recovery direction. Refresh and select a group from this direction.'
  ,OBJECT_DIRECTION_MISMATCH:'The selected object belongs to the opposite recovery direction. Refresh the page and try again.'
  ,SRM_HTTP_400:'SRM rejected the recovery plan configuration. Refresh the plan and verify that the Protection Group is ready and belongs to the selected protected site.'
}[code]||'The SRM operation could not be accepted. Check the intent, pairing and active operations.');

const wrap=fn=>async(req,res)=>{
  try{
    const data=await fn(req);
    res.status(req.method==='GET'?200:202).json({
      success:true,
      data,
      requestId:req.id
    });
  }catch(e){
    console.error(
      '[SRM Controller Error]',
      e?.message || e,
      e?.code,
      e?.stack
    );

    const code=e.code||'SRM_WRITE_UNAVAILABLE';

    const status=code==='FORBIDDEN'
      ?403
      :code==='OPERATION_NOT_FOUND'
        ?404
        :code.includes('IN_PROGRESS')||code.includes('IDEMPOTENCY_KEY_REUSED')
          ?409
          :400;

    res.status(status).json(
      buildSafeError(req,{
        type:'SRM_WRITE_VALIDATION',
        code,
        httpStatus:status,
        safeMessage:safeMessageFor(code)
      })
    );
  }
};

exports.submit=(kind,action)=>wrap(async req=>{
  let targetId = req.params.id || req.params.mappingId;

  if (kind === 'mapping' && typeof targetId === 'string' && targetId.includes(':')) {
    targetId = targetId.split(':').pop();
  }

  let pairId = req.body?.pairId;

  if (!pairId && kind === 'mapping' && targetId) {
    pairId = await service.legacyMappingPair(targetId);
  }

  return service.submit(
    kind,
    action,
    targetId,
    {
      ...req.body,
      ...(pairId?{pairId}:{}),
      ...(req.params.mappingType?{mappingType:req.params.mappingType}:{})
    },
    req.authUser,
    req.id,
    req.get('Idempotency-Key')
  );
});

exports.operation=wrap(async req=>{
  const op=await journal.get(req.params.operationId);

  if(!op)throw {
    code:'OPERATION_NOT_FOUND'
  };

  return journal.safe(op);
});

exports.protectVm=wrap(async req=>{
  const key=req.get('Idempotency-Key');
  const pairId=req.body.pairId||await service.legacyPair(req.params.id);

  return service.submit(
    'pg',
    'members',
    req.params.id,
    {
      pairId,
      action:'add',
      vmId:req.body.vmId,
      confirmed:true
    },
    req.authUser,
    req.id,
    key
  );
});

exports.configureAllVms=wrap(async req=>{
  const pairId=Number(req.body?.pairId||await service.legacyPair(req.params.id));

  if(!pairId)throw {
    code:'PAIR_NOT_FOUND',
    message:'Unable to resolve site pairing for this protection group'
  };

  const x=await gateway.context(pairId);

  return await gateway.withGateway(
    {
      pairId,
      scopeIdentity:x.identity,
      requestId:req.id
    },
    async g=>{
      return await g.configureAllVms(req.params.id);
    }
  );
});

exports.replicatedVms=wrap(async req=>{
  const pairId=Number(req.params.id);
  const x=await gateway.context(pairId);

  return await gateway.withGateway(
    {
      pairId,
      scopeIdentity:x.identity
    },
    g=>g.listReplicatedVms()
  );
});

exports.inventory=wrap(async req=>{
  const pairId=Number(req.params.id);

  const site=req.query.site==='both'
    ?'both'
    :req.query.site==='target'
      ?'target'
      :'source';

  const x=await gateway.context(pairId);

  return await gateway.withGateway(
    {
      pairId,
      scopeIdentity:x.identity
    },
    async g=>site==='both'
      ? {
          source:await g.listInventory(req.params.mappingType,'source'),
          target:await g.listInventory(req.params.mappingType,'target')
        }
      : g.listInventory(req.params.mappingType,site)
  );
});

const placeholderIntent=async req=>{
  const pairId=Number(req.body?.pairId);

  if(!Number.isSafeInteger(pairId)||pairId<1)throw {
    code:'PAIR_ID_REQUIRED'
  };

  if(req.body?.confirmed!==true)throw {
    code:'CONFIRMATION_REQUIRED'
  };

  const datastoreId=String(req.body?.datastoreId||req.params.id||'');

  if(!datastoreId||datastoreId.length>512)throw {
    code:'INVALID_STABLE_ID'
  };

  const x=await gateway.context(pairId);

  const intent={
    pairId,
    scopeIdentity:x.identity,
    requestId:req.id,
    kind:'mapping'
  };

  return gateway.withGateway(
    intent,
    g=>req.method==='DELETE'
      ? g.deletePlaceholderDatastore(datastoreId)
      : g.createPlaceholderDatastore(datastoreId)
  );
};

exports.createPlaceholderDatastore=wrap(placeholderIntent);
exports.deletePlaceholderDatastore=wrap(placeholderIntent);

exports.placeholderDatastoreTask=wrap(async req=>{
  const pairId=Number(req.query.pairId);

  if(!Number.isSafeInteger(pairId)||pairId<1)throw {
    code:'PAIR_ID_REQUIRED'
  };

  const x=await gateway.context(pairId);

  const intent={
    pairId,
    scopeIdentity:x.identity,
    requestId:req.id,
    kind:'mapping'
  };

  return gateway.withGateway(
    intent,
    async g=>{
      const task=await g.task(req.params.taskId);

      if(task.status==='SUCCESS')await g.collect();

      return task;
    }
  );
});

exports.options=wrap(async req=>{
  console.log(
    '[SRM Controller Options] called with id:',
    req.params.id
  );

  const pairId=Number(req.params.id),
    x=await gateway.context(pairId);

  const res = await gateway.withGateway(
    {
      pairId,
      scopeIdentity:x.identity
    },
    g=>g.options()
  );

  console.log(
    '[SRM Controller Options] returning groups:',
    res?.groups?.map(g => ({
      id: g.id,
      name: g.name,
      status: g.status
    }))
  );

  return res;
});
