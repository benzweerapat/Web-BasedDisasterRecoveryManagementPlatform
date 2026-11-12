// Durable saga driver. Every write is preceded by a committed journal transition.
// Gateway objects contain stable IDs only; callers supply intentions, not memberships.
const {createHash}=require('crypto');

const stable=value=>JSON.stringify(
  value,
  (_,v)=>v&&typeof v==='object'&&!Array.isArray(v)
    ?Object.fromEntries(
      Object.entries(v).sort(
        ([a],[b])=>a.localeCompare(b)
      )
    )
    :v
);

const fingerprint=v=>createHash('sha256')
  .update(stable(v))
  .digest('hex');

const unique=xs=>[...new Set(xs)].sort();

const same=(a,b)=>
  fingerprint(a)===fingerprint(b);

const moidOf=x=>
  typeof x==='string'&&x.split(':').length===3
    ?x.split(':')[1]
    :String(x||'');

const sameMappingSpec=(a,b)=>
  same(a,b)||
  (
    Boolean(a)&&
    Boolean(b)&&
    moidOf(a.sourceObject)===moidOf(b.sourceObject)&&
    moidOf(a.targetObject)===moidOf(b.targetObject)
  );

const members=(before,action,id)=>
  action==='add'
    ?unique([...before,id])
    :unique(before.filter(x=>x!==id));

const terminal=new Set([
  'SUCCESS',
  'FAILED',
  'ROLLBACK_SUCCESS'
]);

class SafetyError extends Error {
  constructor(code){
    super(code);
    this.code=code;
  }
}

const exactMapping=(list,spec)=>
  list.filter(x=>sameMappingSpec(x,spec));

async function step(op,gateway,journal) {
  if(terminal.has(op.state))return op;

  const move=async(state,extra={})=>{
    op=await journal.transition(op,state,extra);
    return op;
  };

  const i=op.intent;
  const d=op.data||{};
  const mapping=i.kind==='mapping';

  // A VMware task can report failure after applying all or part of a change.
  // Re-read the authoritative object once and release the pair guard only when
  // the observed state proves the requested result was applied exactly.
  if(op.state==='RECONCILIATION_REQUIRED') {
    if(mapping) {
      const list=await gateway.listMappings(i);

      if(i.action==='delete') {
        const oldId=d.before?.id||i.objectId;

        if(!list.some(x=>x.id===oldId)) {
          return move('VERIFIED',{
            observed:list,
            reconciliationOutcome:
              'DESIRED_STATE_CONFIRMED'
          });
        }
      } else {
        const found=exactMapping(
          list,
          d.desired
        );

        const sourceMatches=list.filter(
          x=>
            moidOf(x.sourceObject)===
            moidOf(d.desired?.sourceObject)
        );

        if(
          found.length===1&&
          sourceMatches.length===1
        ) {
          return move('VERIFIED',{
            resolvedId:found[0].id,
            observed:list,
            reconciliationOutcome:
              'DESIRED_STATE_CONFIRMED'
          });
        }
      }
    } else {
      const current=
        i.action==='create'
          ?await gateway.listObjects(i)
          :await gateway.readObject(i);

      if(i.action==='create') {
        const previous=new Set(
          (d.before||[]).map(x=>x.id)
        );

        const candidates=current.filter(
          x=>
            !previous.has(x.id)&&
            gateway.matches(x,d.desired)
        );

        if(candidates.length===1) {
          return move('VERIFIED',{
            resolvedId:candidates[0].id,
            observed:current,
            reconciliationOutcome:
              'DESIRED_STATE_CONFIRMED'
          });
        }
      } else if(
        i.action==='delete'
          ?current===null
          :gateway.matches(
            current,
            d.desired
          )
      ) {
        return move('VERIFIED',{
          observed:current,
          reconciliationOutcome:
            'DESIRED_STATE_CONFIRMED'
        });
      }
    }

    return move(
      'RECONCILIATION_BLOCKED',
      {
        reconciliationCheckedAt:
          new Date().toISOString(),

        error:
          d.error||
          'RECONCILIATION_NOT_PROVEN'
      }
    );
  }

  // A process died after journaling intent to POST: never replay it.
  if(op.state==='SUBMITTING') {
    return move('SUBMISSION_UNKNOWN');
  }

  if(op.state==='VALIDATING') {
    await gateway.validate(i);

    if(mapping) {
      const list=
        await gateway.listMappings(i);

      const old=
        i.action==='create'
          ?null
          :(
            list.find(
              x=>x.id===i.objectId
            )||
            (
              i.expected
                ?list.find(
                  x=>
                    sameMappingSpec(
                      x,
                      i.expected
                    )
                )
                :null
            )
          );

      if(old?.complex) {
        throw new SafetyError(
          'MAPPING_HAS_DEPENDENT_CONFIGURATION'
        );
      }

      if(
        i.action!=='create'&&
        (
          !old||
          !sameMappingSpec(
            {
              sourceObject:
                old.sourceObject,

              targetObject:
                old.targetObject
            },
            i.expected
          )
        )
      ) {
        throw new SafetyError(
          'MAPPING_CHANGED'
        );
      }

      const desired=
        i.action==='delete'
          ?null
          :{
            sourceObject:
              old?.sourceObject||
              i.sourceObject,

            targetObject:
              i.targetObject
          };

      if(
        desired&&
        list.some(
          x=>
            moidOf(x.sourceObject)===
              moidOf(
                desired.sourceObject
              )&&
            x.id!==old?.id
        )
      ) {
        throw new SafetyError(
          'MAPPING_CONFLICT'
        );
      }

      if(
        old&&
        desired&&
        same(
          desired,
          {
            sourceObject:
              old.sourceObject,

            targetObject:
              old.targetObject
          }
        )
      ) {
        return move('VERIFIED',{
          before:old,
          desired
        });
      }

      return move(
        old
          ?'OLD_MAPPING_VERIFIED'
          :'READY_CREATE',
        {
          before:old,
          desired
        }
      );
    }

    const before=
      i.action==='create'
        ?await gateway.listObjects(i)
        :await gateway.readObject(i);

    if(
      i.action!=='create'&&
      !before
    ) {
      throw new SafetyError(
        'OBJECT_NOT_FOUND'
      );
    }

    const desired=
      i.action==='members'
        ?{
          ...before,
          members:members(
            before.members,
            i.memberAction,
            i.memberId
          )
        }
        :i.action==='edit'
          ?{
            ...before,
            ...i.changes
          }
          :i.action==='create'
            ?i.changes
            :null;

    if(
      i.action==='create'&&
      before.some(
        x=>
          x.name===desired.name&&
          x.source===desired.source
      )
    ) {
      throw new SafetyError(
        'CREATE_NAME_CONFLICT'
      );
    }

    if(i.action==='delete') {
      await gateway.validateDelete(
        i,
        before
      );
    }

    if(i.action==='members') {
      await gateway.validateMember(
        i,
        before
      );
    }

    return move('PREPARED',{
      before,
      desired
    });
  }

  if(op.state==='PREPARED') {
    const latest=
      i.action==='create'
        ?await gateway.listObjects(i)
        :await gateway.readObject(i);

    if(!same(latest,d.before)) {
      return move('FAILED',{
        error:
          'CONCURRENT_MODIFICATION_BEFORE_WRITE'
      });
    }

    if(
      i.action!=='create'&&
      same(d.before,d.desired)
    ) {
      return move('VERIFIED');
    }

    await move('SUBMITTING');

    try {
      const task=
        await gateway.writeObject(
          i,
          d.desired
        );

      return move('WAIT_TASK',{
        taskId:task.id,
        vmwareStatus:task.status
      });
    } catch(e) {
      return move(
        e.definite
          ?'FAILED'
          :'SUBMISSION_UNKNOWN',
        {
          error:
            e.code||
            'UPSTREAM_UNCERTAIN'
        }
      );
    }
  }

  if(op.state==='WAIT_TASK') {
    const task=
      await gateway.task(d.taskId);

    if(
      ![
        'QUEUED',
        'RUNNING',
        'SUCCESS',
        'ERROR',
        'CANCELLED'
      ].includes(task.status)
    ) {
      throw new SafetyError(
        'TASK_CONTRACT'
      );
    }

    if(
      ['ERROR','CANCELLED']
        .includes(task.status)
    ) {
      // A failed task may have made partial changes. Reconcile before releasing the guard.
      const current=
        i.action==='create'
          ?await gateway.listObjects(i)
          :await gateway.readObject(i);

      return move(
        same(current,d.before)
          ?'FAILED'
          :'RECONCILIATION_REQUIRED',
        {
          vmwareStatus:task.status,
          error:'TASK_FAILED',
          observed:current
        }
      );
    }

    return move(
      task.status==='SUCCESS'
        ?'VERIFYING'
        :'WAIT_TASK',
      {
        vmwareStatus:task.status
      }
    );
  }

  if(
    [
      'VERIFYING',
      'SUBMISSION_UNKNOWN'
    ].includes(op.state)
  ) {
    const current=
      i.action==='create'
        ?await gateway.listObjects(i)
        :await gateway.readObject(i);

    let verified=false;
    let resolvedId=i.objectId;

    if(i.action==='create') {
      const previous=new Set(
        d.before.map(x=>x.id)
      );

      const candidates=current.filter(
        x=>
          !previous.has(x.id)&&
          gateway.matches(
            x,
            d.desired
          )
      );

      if(candidates.length>1) {
        return move(
          'RECONCILIATION_REQUIRED',
          {
            error:
              'CREATE_IDENTITY_AMBIGUOUS'
          }
        );
      }

      verified=
        candidates.length===1;

      resolvedId=
        candidates[0]?.id;
    } else {
      verified=
        i.action==='delete'
          ?current===null
          :gateway.matches(
            current,
            d.desired
          );
    }

    if(verified) {
      return move('VERIFIED',{
        resolvedId,
        observed:current,

        submissionOutcome:
          op.state==='SUBMISSION_UNKNOWN'
            ?'STATE_CONVERGED_WITHOUT_TASK'
            :'TASK_CONFIRMED'
      });
    }

    if(!same(current,d.before)) {
      return move(
        'RECONCILIATION_REQUIRED',
        {
          observed:current,
          error:
            'CONCURRENT_OR_PARTIAL_CHANGE'
        }
      );
    }

    return op;
  }

  if(
    mapping&&
    op.state==='OLD_MAPPING_VERIFIED'
  ) {
    const list=
      await gateway.listMappings(i);

    const old=list.find(
      x=>x.id===d.before.id
    );

    if(!same(old,d.before)) {
      return move('FAILED',{
        error:
          'MAPPING_CHANGED_BEFORE_DELETE'
      });
    }

    await move('DELETE_SUBMITTED');

    try {
      await gateway.deleteMapping(
        i,
        d.before.id
      );

      return move('CHECK_DELETE');
    } catch(e) {
      return move(
        e.definite
          ?'CHECK_DELETE_REJECTED'
          :'DELETE_SUBMITTED',
        {
          error:
            e.code||
            'DELETE_UNCERTAIN'
        }
      );
    }
  }

  if(
    mapping&&
    [
      'DELETE_SUBMITTED',
      'CHECK_DELETE',
      'CHECK_DELETE_REJECTED'
    ].includes(op.state)
  ) {
    const list=
      await gateway.listMappings(i);

    if(
      !list.some(
        x=>x.id===d.before.id
      )
    ) {
      return move(
        'OLD_MAPPING_REMOVED'
      );
    }

    if(
      op.state===
      'CHECK_DELETE_REJECTED'
    ) {
      return move('FAILED',{
        error:'DELETE_REJECTED'
      });
    }

    return op;
  }

  if(
    mapping&&
    op.state==='OLD_MAPPING_REMOVED'
  ) {
    return move(
      i.action==='delete'
        ?'VERIFIED'
        :'READY_CREATE'
    );
  }

  if(
    mapping&&
    op.state==='READY_CREATE'
  ) {
    const list=
      await gateway.listMappings(i);

    if(
      exactMapping(
        list,
        d.desired
      ).length===1
    ) {
      return move(
        'NEW_MAPPING_CREATED'
      );
    }

    if(
      list.some(
        x=>
          moidOf(x.sourceObject)===
          moidOf(
            d.desired.sourceObject
          )
      )
    ) {
      return move(
        'RECONCILIATION_REQUIRED',
        {
          error:
            'MAPPING_CONFLICT_BEFORE_CREATE'
        }
      );
    }

    await move('CREATE_SUBMITTED');

    try {
      await gateway.createMapping(
        i,
        d.desired
      );

      return move('CHECK_CREATE');
    } catch(e) {
      return move(
        e.definite
          ?'CREATE_REJECTED'
          :'CREATE_SUBMITTED',
        {
          error:
            e.code||
            'CREATE_UNCERTAIN'
        }
      );
    }
  }

  if(
    mapping&&
    [
      'CREATE_SUBMITTED',
      'CHECK_CREATE',
      'CREATE_REJECTED'
    ].includes(op.state)
  ) {
    const list=
      await gateway.listMappings(i);

    const found=
      exactMapping(
        list,
        d.desired
      );

    if(found.length===1) {
      return move(
        'NEW_MAPPING_CREATED',
        {
          resolvedId:found[0].id
        }
      );
    }

    if(
      found.length>1||
      list.some(
        x=>
          moidOf(x.sourceObject)===
          moidOf(
            d.desired.sourceObject
          )
      )
    ) {
      return move(
        'RECONCILIATION_REQUIRED',
        {
          error:
            'REPLACEMENT_CONFLICT'
        }
      );
    }

    if(
      op.state==='CREATE_REJECTED'
    ) {
      return move(
        d.before
          ?'PARTIAL_FAILURE'
          :'FAILED',
        {
          error:d.before
            ?'The previous mapping was removed, but the replacement mapping could not be created.'
            :'CREATE_REJECTED'
        }
      );
    }

    return op;
  }

  if(
    mapping&&
    op.state==='PARTIAL_FAILURE'
  ) {
    const list=
      await gateway.listMappings(i);

    const old={
      sourceObject:
        d.before.sourceObject,

      targetObject:
        d.before.targetObject
    };

    if(
      exactMapping(list,old)
        .length===1
    ) {
      return move(
        'ROLLBACK_VERIFIED'
      );
    }

    if(
      list.some(
        x=>
          [
            moidOf(
              old.sourceObject
            ),
            moidOf(
              d.desired.sourceObject
            )
          ].includes(
            moidOf(x.sourceObject)
          )
      )
    ) {
      return move(
        'ROLLBACK_FAILED',
        {
          rollbackOutcome:
            'CONFLICT'
        }
      );
    }

    await gateway.validateMappingSpec(
      i,
      old
    );

    await move(
      'ROLLBACK_ATTEMPTED'
    );

    try {
      await gateway.createMapping(
        i,
        old
      );

      return move(
        'CHECK_ROLLBACK'
      );
    } catch(e) {
      return move(
        e.definite
          ?'ROLLBACK_REJECTED'
          :'ROLLBACK_ATTEMPTED',
        {
          error:
            e.code||
            'ROLLBACK_UNCERTAIN'
        }
      );
    }
  }

  if(
    mapping&&
    [
      'ROLLBACK_ATTEMPTED',
      'CHECK_ROLLBACK',
      'ROLLBACK_REJECTED'
    ].includes(op.state)
  ) {
    const list=
      await gateway.listMappings(i);

    const old={
      sourceObject:
        d.before.sourceObject,

      targetObject:
        d.before.targetObject
    };

    if(
      exactMapping(list,old)
        .length===1
    ) {
      return move(
        'ROLLBACK_VERIFIED',
        {
          rollbackOutcome:
            'RESTORED'
        }
      );
    }

    if(
      op.state==='ROLLBACK_REJECTED'
    ) {
      return move(
        'ROLLBACK_FAILED',
        {
          rollbackOutcome:
            'FAILED',

          error:
            'The replacement failed and the original mapping could not be restored.'
        }
      );
    }

    return op;
  }

  if(
    mapping&&
    op.state==='NEW_MAPPING_CREATED'
  ) {
    if(
      exactMapping(
        await gateway.listMappings(i),
        d.desired
      ).length!==1
    ) {
      return move(
        'RECONCILIATION_REQUIRED',
        {
          error:
            'NEW_MAPPING_CHANGED'
        }
      );
    }

    return move('VERIFIED');
  }

  if(
    [
      'VERIFIED',
      'ROLLBACK_VERIFIED'
    ].includes(op.state)
  ) {
    await gateway.collect();

    return move(
      op.state==='ROLLBACK_VERIFIED'
        ?'ROLLBACK_SUCCESS'
        :'SUCCESS',
      {
        finalOutcome:
          op.state==='ROLLBACK_VERIFIED'
            ?'The replacement failed. The original mapping was restored.'
            :'VERIFIED_AND_COLLECTED'
      }
    );
  }

  return op;
}

module.exports={
  step,
  terminal,
  members,
  fingerprint,
  same,
  SafetyError
};