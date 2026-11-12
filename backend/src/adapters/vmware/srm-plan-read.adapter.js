const http=require(
  '../../services/vmware-http.service'
);

const error=(
  code,
  availability='FAILED',
  taskId=null
)=>Object.assign(
  new Error(code),
  {
    code,
    availability,
    taskId
  }
);

async function get(
  client,
  session,
  path
) {
  let response;

  try {
    response=await client.get(
      path,
      {
        headers:{
          'x-dr-session':session,
          Accept:'application/json'
        }
      }
    );
  } catch(_) {
    throw error(
      'SRM_HISTORY_REQUEST_FAILED'
    );
  }

  if(
    ![200,201,202]
      .includes(response.status)
  ) {
    throw error(
      'SRM_HISTORY_HTTP_FAILED',

      response.status===404
        ?'ENDPOINT_NOT_AVAILABLE'
        :'FAILED'
    );
  }

  return response;
}

const base=baseUrl=>{
  const path=new URL(baseUrl)
    .pathname
    .replace(/\/$/,'');

  return path&&path!=='/'
    ?path
    :'/api/rest/srm/v1';
};

async function history(
  baseUrl,
  session,
  pairingId,
  planId,
  verifyTls
) {
  const client=
    await http.createClient(
      baseUrl,
      verifyTls
    );

  const prefix=base(baseUrl);

  const path=
    `${prefix}/pairings/${encodeURIComponent(pairingId)}/recovery-management/plans/${encodeURIComponent(planId)}/history-reports`;

  const response=
    await get(
      client,
      session,
      path
    );

  let task=response.data;

  if(response.status===202){
    if(
      !task||
      typeof task.id!=='string'||
      !task.id
    ) {
      throw error(
        'SRM_HISTORY_TASK_MISSING',
        'CONTRACT_ERROR'
      );
    }

    for(
      let attempt=0;
      ['QUEUED','RUNNING']
        .includes(task.status)&&
      attempt<10;
      attempt++
    ){
      await new Promise(
        resolve=>
          setTimeout(resolve,500)
      );

      task=(
        await get(
          client,
          session,
          `${prefix}/tasks/${encodeURIComponent(task.id)}`
        )
      ).data;
    }

    if(
      ['QUEUED','RUNNING']
        .includes(task.status)
    ) {
      throw error(
        'SRM_HISTORY_PENDING',
        'PENDING',
        task.id
      );
    }

    if(
      ['ERROR','CANCELLED']
        .includes(task.status)
    ) {
      throw error(
        'SRM_HISTORY_TASK_FAILED',
        'FAILED',
        task.id
      );
    }

    if(task.status!=='SUCCESS') {
      throw error(
        'SRM_HISTORY_TASK_SHAPE',
        'CONTRACT_ERROR',
        task.id
      );
    }

    const result=task.result;

    // SRM 9.0.2 returns HistoryReport[] directly in task.result.
    if(Array.isArray(result)){
      if(
        result.some(
          item=>
            !item||
            !Number.isInteger(
              item.run_key
            )
        )
      ) {
        throw error(
          'SRM_HISTORY_RESULT_SHAPE',
          'CONTRACT_ERROR',
          task.id
        );
      }

      return result;
    }

    // The documented result is HistoryReport; do not turn an unknown result into an empty list.
    if(
      result&&
      Number.isInteger(
        result.run_key
      )
    ) {
      return [result];
    }

    if(
      Array.isArray(result?.list)&&
      Number.isInteger(
        result._meta?.total
      )
    ){
      if(
        result.list.length!==
        result._meta.total
      ) {
        throw error(
          'SRM_HISTORY_TRUNCATED',
          'TRUNCATED',
          task.id
        );
      }

      return result.list;
    }

    throw error(
      'SRM_HISTORY_RESULT_SHAPE',
      'CONTRACT_ERROR',
      task.id
    );
  }

  if(
    Array.isArray(task?.list)&&
    Number.isInteger(
      task._meta?.total
    )&&
    task.list.length===
      task._meta.total
  ) {
    return task.list;
  }

  throw error(
    'SRM_HISTORY_RESPONSE_SHAPE',
    'CONTRACT_ERROR'
  );
}

async function steps(
  baseUrl,
  session,
  pairingId,
  planId,
  mode,
  verifyTls
) {
  const client=
    await http.createClient(
      baseUrl,
      verifyTls
    );

  const prefix=base(baseUrl);

  const {
    data:schema
  }=await get(
    client,
    session,
    `${prefix}/open-api.json`
  );

  if(!schema?.paths) {
    throw error(
      'SRM_OPENAPI_SHAPE',
      'CONTRACT_ERROR'
    );
  }

  if(
    !Object.keys(schema.paths)
      .some(
        p=>/recovery-steps/.test(p)
      )
  ) {
    throw error(
      'SRM_TEST_STEPS_NOT_PROVIDED',
      'NOT_PROVIDED_BY_API'
    );
  }

  // New versions need their exact method/query contract verified before being enabled.
  throw error(
    'SRM_TEST_STEPS_CONTRACT_UNVERIFIED',
    'ENDPOINT_NOT_AVAILABLE'
  );
}

module.exports={
  history,
  steps
};