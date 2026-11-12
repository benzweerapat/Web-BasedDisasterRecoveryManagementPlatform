const {SafetyError}=require('./srm-write-engine');

const runningStates=new Set([
  'TEST_IN_PROGRESS',
  'CLEANUP_IN_PROGRESS',
  'RECOVERY_IN_PROGRESS',
  'REPROTECT_IN_PROGRESS',
  'WAITING_FOR_USER_INPUT'
]);

const verifiedStates=action=>
  action==='test'
    ?['TEST_COMPLETE']
    :['cleanup','reprotect'].includes(action)
      ?['READY_STATE']
      :[
        'RECOVERY_COMPLETE',
        'DISASTER_RECOVERY_COMPLETE'
      ];

const terminalOperationStates=new Set([
  'SUCCESS',
  'FAILED',
  'ROLLBACK_SUCCESS',
  'ROLLBACK_FAILED',
  'RECONCILIATION_BLOCKED'
]);

const actionRunningStates=action=>
  action==='reprotect'
    ?[
      'REPROTECT_IN_PROGRESS',
      'WAITING_FOR_USER_INPUT'
    ]
    :action==='test'
      ?[
        'TEST_IN_PROGRESS',
        'WAITING_FOR_USER_INPUT'
      ]
      :action==='cleanup'
        ?[
          'CLEANUP_IN_PROGRESS',
          'WAITING_FOR_USER_INPUT'
        ]
        :[
          'RECOVERY_IN_PROGRESS',
          'WAITING_FOR_USER_INPUT'
        ];

const safeUpstreamCode=e=>
  /^SRM_HTTP_\d{3}$/.test(
    String(e?.code||'')
  )
    ?e.code
    :null;

function canCancel(op,plan,role){
  return Boolean(
    op&&
    op.intent.kind==='execution'&&
    op.state==='TASK_RUNNING'&&
    op.data.vmwareStatus==='RUNNING'&&
    !op.data.cancelState&&
    plan.is_running===true&&
    actionRunningStates(
      op.intent.action
    ).includes(plan.status)&&
    (
      ['ADMIN'].includes(role)||
      (
        role==='OPERATOR'&&
        ['test','cleanup'].includes(
          op.intent.action
        )
      )
    )
  );
}

// Conservative subset of RecoveryPlanInfo.status, verified on runtime OpenAPI.
function available(plan,role) {
  if(
    !['OPERATOR','ADMIN'].includes(role)||
    plan.is_running===true
  ) {
    return [];
  }

  if(
    [
      'RECOVERY_COMPLETE',
      'REPROTECT_INTERRUPTED',
      'REPROTECT_INCOMPLETE'
    ].includes(plan.status)
  ) {
    return role==='ADMIN'
      ?['reprotect']
      :[];
  }

  if(plan.status==='READY_STATE') {
    return role==='ADMIN'
      ?[
        'test',
        'migration',
        'recovery'
      ]
      :['test'];
  }

  if(
    [
      'TEST_COMPLETE',
      'CLEANUP_INCOMPLETE',
      'CLEANUP_INTERRUPTED'
    ].includes(plan.status)
  ) {
    return ['cleanup'];
  }

  if(
    plan.status==='TEST_INTERRUPTED'
  ) {
    return ['test'];
  }

  return [];
}

function getRecoveryPlanActions(
  plan,
  operation,
  role,
  preflight={
    ready:true,
    blockers:[]
  }
) {
  const inFlight=
    operation&&
    !terminalOperationStates.has(
      operation.state
    );

  const permitted=
    available(plan,role).filter(
      action=>
        action==='cleanup'||
        preflight.ready!==false
    );

  const actions=
    inFlight?[]:permitted;

  const reasons={};

  for(
    const action of [
      'test',
      'cleanup',
      'migration',
      'recovery',
      'reprotect'
    ]
  ) {
    if(!actions.includes(action)) {
      reasons[action]=
        !['ADMIN','OPERATOR']
          .includes(role)||
        (
          [
            'migration',
            'recovery',
            'reprotect'
          ].includes(action)&&
          role!=='ADMIN'
        )
          ?'FORBIDDEN'
          :inFlight
            ?'WRITE_CONFLICT'
            :'INVALID_STATE';
    }
  }

  const cancel=
    canCancel(
      operation,
      plan,
      role
    );

  if(!cancel) {
    reasons.cancel=
      !['ADMIN','OPERATOR']
        .includes(role)
        ?'FORBIDDEN'
        :'NO_CANCELLABLE_OWNED_OPERATION';
  }

  return {
    actions,
    canTest:
      actions.includes('test'),
    canCleanup:
      actions.includes('cleanup'),
    canMigrate:
      actions.includes('migration'),
    canRecover:
      actions.includes('recovery'),
    canReprotect:
      actions.includes('reprotect'),
    canCancel:cancel,
    reasons,
    preflight
  };
}

function spec(
  action,
  {syncData=false}={}
) {
  if(action==='test') {
    return {
      sync_data:
        syncData===true
    };
  }

  if(
    ['cleanup','reprotect']
      .includes(action)
  ) {
    return {
      forced:false
    };
  }

  if(
    [
      'migration',
      'recovery',
      'reprotect'
    ].includes(action)
  ) {
    return {
      planned_failover:
        action==='migration',

      sync_data:true,

      skip_protection_site_operations:
        false,

      ...(
        action==='migration'
          ?{
            migrate_eligible_vms:true
          }
          :{}
      )
    };
  }

  throw new SafetyError(
    'UNSUPPORTED_RECOVERY_ACTION'
  );
}

async function step(op,g,journal) {
  const move=(
    state,
    data={}
  )=>journal.transition(
    op,
    state,
    data
  );

  const i=op.intent;

  const finishPlan=(
    plan,
    data={}
  )=>{
    // A plan can finish its workflow even when an individual task failed.
    // Plan-only reconciliation must not turn a known task error into success.
    const taskError=
      op.data.vmwareStatus==='CANCELLED'
        ?'OPERATION_CANCELLED'
        :op.data.vmwareStatus==='ERROR'
          ?(
            op.data.taskFailureCode||
            'TASK_FAILED'
          )
          :null;

    if(taskError) {
      return move('FAILED',{
        ...data,
        error:taskError,
        observedPlanStatus:
          plan.status,

        reconciliationOutcome:
          'PLAN_FINISHED_WITH_TASK_ERROR',

        ...(
          op.data.vmwareStatus===
            'CANCELLED'
            ?{
              cancelState:
                'VERIFIED'
            }
            :{}
        )
      });
    }

    return move('VERIFIED',{
      ...data,
      verifiedStatus:plan.status
    });
  };

  if(op.state==='VALIDATING') {
    const plan=await g.readPlan(
      i.objectId,
      {
        allowReversed:
          i.action==='reprotect'&&
          ![
            'VALIDATING',
            'READY_EXECUTE'
          ].includes(op.state)
      }
    );

    if(
      plan.name!==i.confirmName||
      !available(
        plan,
        op.user.role
      ).includes(i.action)
    ) {
      throw new SafetyError(
        'RECOVERY_STATE_OR_CONFIRMATION_CHANGED'
      );
    }

    if(i.action!=='cleanup'){
      if(
        typeof g.preflightPlan!==
        'function'
      ) {
        throw new SafetyError(
          'RECOVERY_PREFLIGHT_UNAVAILABLE'
        );
      }

      const preflight=
        await g.preflightPlan(
          i.objectId,
          i.action
        );

      if(preflight.ready!==true) {
        throw new SafetyError(
          'RECOVERY_PREFLIGHT_FAILED'
        );
      }
    }

    return move('READY_EXECUTE',{
      planName:plan.name,
      beforeStatus:plan.status
    });
  }

  if(op.state==='READY_EXECUTE') {
    const plan=await g.readPlan(
      i.objectId,
      {
        allowReversed:
          i.action==='reprotect'&&
          ![
            'VALIDATING',
            'READY_EXECUTE'
          ].includes(op.state)
      }
    );

    if(
      plan.name!==i.confirmName||
      !available(
        plan,
        op.user.role
      ).includes(i.action)
    ) {
      return move('FAILED',{
        error:
          'RECOVERY_STATE_CHANGED'
      });
    }

    op=await move('SUBMITTING');

    try {
      const task=
        await g.executePlan(
          i.objectId,
          i.action,
          spec(i.action,{
            syncData:i.syncData
          })
        );

      return journal.transition(
        op,
        'TASK_RUNNING',
        {
          taskId:task.id,
          vmwareStatus:task.status
        }
      );
    } catch(e) {
      return journal.transition(
        op,
        e.definite
          ?'FAILED'
          :'RECONCILIATION_REQUIRED',
        {
          error:e.definite
            ?'SRM_OPERATION_REJECTED'
            :'SUBMISSION_UNCERTAIN',

          upstreamCode:
            safeUpstreamCode(e),

          reconciliationChecks:0
        }
      );
    }
  }

  // Never replay a high-impact POST after crash/uncertain response.
  if(op.state==='SUBMITTING') {
    return move(
      'RECONCILIATION_REQUIRED',
      {
        error:
          'SUBMISSION_UNCERTAIN'
      }
    );
  }

  if(
    op.state===
    'RECONCILIATION_REQUIRED'
  ){
    const plan=await g.readPlan(
      i.objectId,
      {
        allowReversed:
          i.action==='reprotect'&&
          ![
            'VALIDATING',
            'READY_EXECUTE'
          ].includes(op.state)
      }
    );

    if(plan.name!==i.confirmName) {
      return move(
        'RECONCILIATION_BLOCKED',
        {
          error:
            'RECOVERY_PLAN_IDENTITY_CHANGED'
        }
      );
    }

    if(
      verifiedStates(
        i.action
      ).includes(plan.status)&&
      plan.is_running!==true
    ) {
      return finishPlan(plan,{
        reconciliationOutcome:
          'DESIRED_STATE_CONFIRMED'
      });
    }

    if(
      plan.is_running===true&&
      actionRunningStates(
        i.action
      ).includes(plan.status)
    ) {
      return move(
        'PLAN_MONITORING',
        {
          observedPlanStatus:
            plan.status,

          reconciliationOutcome:
            'SUBMISSION_OBSERVED'
        }
      );
    }

    const checks=
      (
        op.data
          .reconciliationChecks||
        0
      )+1;

    if(
      plan.is_running!==true&&
      plan.status===
        op.data.beforeStatus&&
      checks>=3
    ) {
      return move('FAILED',{
        error:
          'SUBMISSION_NOT_OBSERVED',

        observedPlanStatus:
          plan.status,

        reconciliationOutcome:
          'NO_STATE_CHANGE_CONFIRMED'
      });
    }

    if(
      plan.is_running!==true&&
      !runningStates.has(
        plan.status
      )&&
      plan.status!==
        op.data.beforeStatus
    ) {
      return move('FAILED',{
        error:
          'PLAN_OUTCOME_NOT_VERIFIED',

        observedPlanStatus:
          plan.status
      });
    }

    return move(
      'RECONCILIATION_REQUIRED',
      {
        reconciliationChecks:
          checks,

        observedPlanStatus:
          plan.status
      }
    );
  }

  if(op.state==='PLAN_MONITORING'){
    const plan=await g.readPlan(
      i.objectId,
      {
        allowReversed:
          i.action==='reprotect'&&
          ![
            'VALIDATING',
            'READY_EXECUTE'
          ].includes(op.state)
      }
    );

    if(
      verifiedStates(
        i.action
      ).includes(plan.status)&&
      plan.is_running!==true
    ) {
      return finishPlan(plan,{
        reconciliationOutcome:
          'DESIRED_STATE_CONFIRMED'
      });
    }

    if(
      plan.is_running===true&&
      actionRunningStates(
        i.action
      ).includes(plan.status)
    ) {
      return move(
        'PLAN_MONITORING',
        {
          observedPlanStatus:
            plan.status
        }
      );
    }

    return move('FAILED',{
      error:
        'PLAN_OUTCOME_NOT_VERIFIED',

      observedPlanStatus:
        plan.status
    });
  }

  if(op.state==='TASK_RUNNING') {
    if(
      op.data.cancelState===
      'REQUESTED'
    ){
      // Re-read the original task immediately before cancellation. A stale plan can
      // still report running after that task completed; never cancel a later run.
      const original=
        await g.task(
          op.data.taskId
        );

      if(
        ![
          'QUEUED',
          'RUNNING',
          'SUCCESS',
          'ERROR',
          'CANCELLED'
        ].includes(original.status)
      ) {
        throw new SafetyError(
          'TASK_CONTRACT_ERROR'
        );
      }

      if(
        original.status!=='RUNNING'
      ) {
        return move(
          'TASK_RUNNING',
          {
            cancelState:
              'NOT_APPLICABLE',

            vmwareStatus:
              original.status
          }
        );
      }

      const plan=await g.readPlan(
        i.objectId,
        {
          allowReversed:
            i.action==='reprotect'&&
            ![
              'VALIDATING',
              'READY_EXECUTE'
            ].includes(op.state)
        }
      );

      // The task becomes RUNNING before the plan always reports its active
      // phase. Preserve the request and retry after the next live read.
      if(
        plan.is_running!==true||
        !runningStates.has(plan.status)
      ) {
        return move(
          'TASK_RUNNING',
          {
            cancelState:'REQUESTED',

            cancelPolls:
              (
                op.data.cancelPolls||
                0
              )+1,

            observedPlanStatus:
              plan.status
          }
        );
      }

      op=await move(
        'TASK_RUNNING',
        {
          cancelState:
            'SUBMITTING'
        }
      );

      try {
        await g.cancelPlan(
          i.objectId
        );

        return journal.transition(
          op,
          'TASK_RUNNING',
          {
            cancelState:'ACCEPTED',
            cancelPolls:0
          }
        );
      } catch(e) {
        const attempts=
          (
            op.data.cancelAttempts||
            0
          )+1;

        const cancelError=
          safeUpstreamCode(e)||
          e.code||
          'CANCEL_SUBMISSION_UNCERTAIN';

        // SRM can reject cancellation while moving between execution phases.
        // Retry boundedly only while the original task remains RUNNING.
        if(
          e.definite&&
          [
            'SRM_HTTP_400',
            'SRM_HTTP_409',
            'SRM_HTTP_412'
          ].includes(e.code)&&
          attempts<10
        ){
          return journal.transition(
            op,
            'TASK_RUNNING',
            {
              cancelState:
                'REQUESTED',

              cancelAttempts:
                attempts,

              cancelPolls:
                (
                  op.data.cancelPolls||
                  0
                )+1,

              cancelError
            }
          );
        }

        return journal.transition(
          op,
          'TASK_RUNNING',
          {
            cancelState:e.definite
              ?'REJECTED'
              :'UNKNOWN',

            cancelAttempts:
              attempts,

            cancelPolls:0,
            cancelError
          }
        );
      }
    }

    if(
      op.data.cancelState===
      'SUBMITTING'
    ) {
      return move(
        'TASK_RUNNING',
        {
          cancelState:'UNKNOWN',
          cancelPolls:0
        }
      );
    }

    let t;

    try {
      t=await g.task(
        op.data.taskId
      );
    } catch(e) {
      const plan=await g.readPlan(
        i.objectId,
        {
          allowReversed:
            i.action==='reprotect'&&
            ![
              'VALIDATING',
              'READY_EXECUTE'
            ].includes(op.state)
        }
      );

      if(
        verifiedStates(
          i.action
        ).includes(plan.status)&&
        plan.is_running!==true
      ) {
        return finishPlan(plan,{
          reconciliationOutcome:
            'PLAN_FALLBACK_CONFIRMED',

          taskReadError:
            safeUpstreamCode(e)||
            'TASK_READ_UNAVAILABLE'
        });
      }

      if(
        plan.is_running===true&&
        actionRunningStates(
          i.action
        ).includes(plan.status)
      ) {
        return move(
          'TASK_RUNNING',
          {
            taskReadError:
              safeUpstreamCode(e)||
              'TASK_READ_UNAVAILABLE',

            observedPlanStatus:
              plan.status,

            taskReadFailures:
              (
                op.data
                  .taskReadFailures||
                0
              )+1
          }
        );
      }

      return move('FAILED',{
        error:
          'PLAN_OUTCOME_NOT_VERIFIED',

        observedPlanStatus:
          plan.status,

        taskReadError:
          safeUpstreamCode(e)||
          'TASK_READ_UNAVAILABLE'
      });
    }

    if(
      ![
        'QUEUED',
        'RUNNING',
        'SUCCESS',
        'ERROR',
        'CANCELLED'
      ].includes(t.status)
    ) {
      throw new SafetyError(
        'TASK_CONTRACT_ERROR'
      );
    }

    if(
      ['ERROR','CANCELLED']
        .includes(t.status)
    ){
      const taskFailureCode=
        t.status==='CANCELLED'
          ?'OPERATION_CANCELLED'
          :t.failureCode||
            'TASK_FAILED';

      // Keep the terminal task result even if the following plan read fails.
      if(
        op.data.vmwareStatus!==
          t.status||
        op.data.taskFailureCode!==
          taskFailureCode
      ) {
        op=await move(
          'TASK_RUNNING',
          {
            vmwareStatus:t.status,
            taskFailureCode
          }
        );
      }

      const plan=await g.readPlan(
        i.objectId,
        {
          allowReversed:
            i.action==='reprotect'&&
            ![
              'VALIDATING',
              'READY_EXECUTE'
            ].includes(op.state)
        }
      );

      if(plan.is_running===true){
        if(
          (
            op.data.cancelPolls||
            0
          )>=120
        ) {
          return move(
            'RECONCILIATION_REQUIRED',
            {
              error:
                'CANCEL_RECONCILIATION_TIMEOUT',

              vmwareStatus:
                t.status
            }
          );
        }

        return move(
          'TASK_RUNNING',
          {
            vmwareStatus:t.status,

            cancelPolls:
              (
                op.data.cancelPolls||
                0
              )+1
          }
        );
      }

      if(
        verifiedStates(
          i.action
        ).includes(plan.status)
      ) {
        return finishPlan(plan);
      }

      return move('FAILED',{
        vmwareStatus:t.status,

        cancelState:
          t.status==='CANCELLED'
            ?'VERIFIED'
            :op.data.cancelState,

        error:
          t.status==='CANCELLED'
            ?'OPERATION_CANCELLED'
            :t.failureCode||
              'TASK_FAILED'
      });
    }

    if(t.status==='SUCCESS') {
      return move('VERIFYING',{
        vmwareStatus:t.status
      });
    }

    const nextCancelPolls=
      (
        op.data.cancelPolls||
        0
      )+1;

    // A lost/timeout response does not prove that SRM rejected cancellation.
    // Re-read the same original task for several cycles, then retry boundedly
    // while that exact task is still RUNNING.
    if(
      op.data.cancelState===
        'UNKNOWN'&&
      nextCancelPolls>=3&&
      (
        op.data.cancelAttempts||
        0
      )<3
    ){
      return move(
        'TASK_RUNNING',
        {
          vmwareStatus:t.status,
          cancelState:'REQUESTED',
          cancelPolls:0
        }
      );
    }

    if(
      [
        'ACCEPTED',
        'UNKNOWN'
      ].includes(
        op.data.cancelState
      )&&
      nextCancelPolls>=120
    ) {
      return move(
        'RECONCILIATION_REQUIRED',
        {
          error:
            'CANCEL_RECONCILIATION_TIMEOUT',

          vmwareStatus:t.status
        }
      );
    }

    return move(
      'TASK_RUNNING',
      {
        vmwareStatus:t.status,
        cancelPolls:
          nextCancelPolls
      }
    );
  }

  if(op.state==='VERIFYING') {
    const plan=await g.readPlan(
      i.objectId,
      {
        allowReversed:
          i.action==='reprotect'&&
          ![
            'VALIDATING',
            'READY_EXECUTE'
          ].includes(op.state)
      }
    );

    const states=
      verifiedStates(i.action);

    if(plan.is_running===true) {
      return op;
    }

    if(!states.includes(plan.status)) {
      return move(
        'RECONCILIATION_REQUIRED',
        {
          error:
            'PLAN_OUTCOME_NOT_VERIFIED'
        }
      );
    }

    return finishPlan(plan);
  }

  if(op.state==='VERIFIED'){
    try {
      const collected=
        await g.collect();

      return move('SUCCESS',{
        refreshStatus:
          collected?.degraded
            ?'DEGRADED'
            :'SYNCED',

        ...(
          collected?.degraded
            ?{
              finalOutcome:
                'VERIFIED_ON_VMWARE_COLLECTION_DEGRADED'
            }
            :{}
        )
      });
    } catch(e) {
      const attempts=
        (
          op.data.collectionAttempts||
          0
        )+1;

      if(attempts<3) {
        return move(
          'VERIFIED',
          {
            collectionAttempts:
              attempts,

            refreshStatus:
              'RETRYING'
          }
        );
      }

      return move('SUCCESS',{
        collectionAttempts:
          attempts,

        refreshStatus:
          'DEGRADED',

        finalOutcome:
          'VERIFIED_ON_VMWARE_COLLECTION_DEGRADED',

        collectionError:
          safeUpstreamCode(e)||
          'SRM_COLLECTION_NOT_SUCCESSFUL'
      });
    }
  }

  return op;
}

module.exports={
  available,
  spec,
  step,
  canCancel,
  runningStates,
  getRecoveryPlanActions,
  terminalOperationStates
};