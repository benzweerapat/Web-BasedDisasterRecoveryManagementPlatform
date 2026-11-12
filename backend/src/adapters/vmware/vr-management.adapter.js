const vr = require('./vr.adapter');

class ManagementError extends Error {
  constructor(type, code, httpStatus = 502) {
    super(code);

    this.type = type;
    this.code = code;
    this.httpStatus = httpStatus;

    this.safeMessage = ({
      VR_OPERATION_IN_PROGRESS:
        'Another operation for this replication is still in progress. Its status is being refreshed; wait for it to finish before trying again.',

      VR_TIMEOUT:
        'vSphere Replication did not respond in time. The request status is being checked; do not submit it again yet.'
    })[code] ||
      'The replication request could not be completed. Refresh the configuration and try again.';
  }
}

const fail = code =>
  new ManagementError(
    'CONTRACT_ERROR',
    code
  );

const segment = value => {
  if (
    typeof value !== 'string' ||
    !value.length ||
    value.length > 512 ||
    /[\x00-\x1f]/.test(value)
  ) {
    throw new ManagementError(
      'VALIDATION_ERROR',
      'INVALID_IDENTIFIER',
      400
    );
  }

  return encodeURIComponent(value);
};

function basePath(connection) {
  const path = new URL(connection.baseUrl)
    .pathname
    .replace(/\/$/, '');

  return path && path !== '/'
    ? path
    : '/api/rest/vr/v1';
}

// Deliberately separate transport failures from successful-response parser failures.
async function request(
  connection,
  session,
  method,
  path,
  data,
  params
) {
  let response;

  try {
    const client = await vr.createClient(
      connection.baseUrl,
      connection.verifyTls
    );

    response = await client.request({
      method,
      url: `${basePath(connection)}${path}`,
      data,
      params,

      headers: {
        'x-dr-session': session,
        Accept: 'application/json'
      }
    });
  } catch (error) {
    if (error.response?.status) {
      const status = error.response.status;

      throw new ManagementError(
        status === 401
          ? 'AUTH_ERROR'
          : status === 403
            ? 'FORBIDDEN_ERROR'
            : 'VMWARE_OPERATION_FAILED',

        `VR_HTTP_${status}`,

        status === 403
          ? 403
          : 502
      );
    }

    const timeout = [
      'ECONNABORTED',
      'ETIMEDOUT'
    ].includes(error.code);

    throw new ManagementError(
      timeout
        ? 'TIMEOUT_ERROR'
        : 'NETWORK_ERROR',

      timeout
        ? 'VR_TIMEOUT'
        : 'VR_REQUEST_FAILED'
    );
  }

  if (![200, 201, 202].includes(response.status)) {
    const type =
      response.status === 401
        ? 'AUTH_ERROR'
        : response.status === 403
          ? 'FORBIDDEN_ERROR'
          : 'VMWARE_OPERATION_FAILED';

    throw new ManagementError(
      type,
      `VR_HTTP_${response.status}`,
      response.status === 403
        ? 403
        : 502
    );
  }

  if (
    !response.data ||
    typeof response.data !== 'object' ||
    Array.isArray(response.data)
  ) {
    throw fail('VR_RESPONSE_SHAPE');
  }

  if (response.data._meta?.errors?.length) {
    throw fail('VR_PARTIAL_RESPONSE');
  }

  return response;
}

async function list(
  connection,
  session,
  path,
  params = {}
) {
  const rows = [];
  const seen = new Set();

  for (
    let offset = 0, pages = 0;
    pages < 50;
    pages++
  ) {
    const { data } = await request(
      connection,
      session,
      'GET',
      path,
      undefined,
      {
        ...params,
        limit: 100,
        offset
      }
    );

    if (!Array.isArray(data.list)) {
      throw fail('VR_LIST_SHAPE');
    }

    const meta = data._meta;

    if (
      !meta ||
      !Number.isInteger(meta.total) ||
      meta.total < 0
    ) {
      throw fail('VR_PAGINATION_SHAPE');
    }

    if (seen.has(offset)) {
      throw fail('VR_PAGINATION_LOOP');
    }

    seen.add(offset);
    rows.push(...data.list);

    if (rows.length >= meta.total) {
      return rows;
    }

    if (!data.list.length) {
      throw fail('VR_PAGINATION_INCOMPLETE');
    }

    offset += data.list.length;
  }

  // Never hand partial lookup results to a configuration validator.
  throw new ManagementError(
    'CONTRACT_ERROR',
    'VR_COLLECTION_TRUNCATED'
  );
}

function parseTask(
  data,
  isConfigure = false
) {
  const task = isConfigure
    ? (
        Array.isArray(data.list) &&
        data.list.length === 1
          ? data.list[0]
          : null
      )
    : data;

  if (
    !task ||
    typeof task.id !== 'string' ||
    !task.id ||
    ![
      'QUEUED',
      'RUNNING',
      'SUCCESS',
      'ERROR',
      'CANCELLED'
    ].includes(task.status)
  ) {
    throw fail('VR_TASK_SHAPE');
  }

  return {
    taskId: task.id,

    status: ({
      QUEUED: 'SUBMITTED',
      RUNNING: 'RUNNING',
      SUCCESS: 'SUCCESS',
      ERROR: 'FAILED',
      CANCELLED: 'FAILED'
    })[task.status],

    progress: Number.isFinite(task.progress)
      ? task.progress
      : null
  };
}

async function contract(
  connection,
  session
) {
  const { data } = await request(
    connection,
    session,
    'GET',
    '/open-api.json'
  );

  if (
    !data.paths ||
    !data.components?.schemas
      ?.ConfigureReplicationSpec
  ) {
    throw fail('VR_OPENAPI_UNAVAILABLE');
  }

  return data;
}

async function operate(
  connection,
  session,
  pairingId,
  operation,
  replicationId,
  spec,
  options = {}
) {
  if (
    ![
      'configure',
      'reconfigure',
      'pause',
      'resume',
      'sync',
      'unconfigure'
    ].includes(operation)
  ) {
    throw fail('VR_OPERATION_NOT_ALLOWED');
  }

  const root =
    `/pairings/${segment(pairingId)}/replications`;

  let method = 'POST';

  let path =
    operation === 'configure'
      ? root
      : `${root}/${segment(replicationId)}/actions/${operation}`;

  let body =
    operation === 'configure'
      ? [spec]
      : spec;

  let params = undefined;

  if (operation === 'unconfigure') {
    require('../../services/vr-replication-spec.service')
      .validateRemoveOptions(options);

    params = {
      retain_replica_disks:
        options.retainReplicaDisks
    };

    if (options.stopMode === 'force') {
      method = 'DELETE';

      path =
        `${root}/${segment(replicationId)}`;

      body = undefined;
    } else {
      method = 'POST';

      path =
        `${root}/${segment(replicationId)}/actions/unconfigure`;

      body = spec || undefined;
    }
  }

  const response = await request(
    connection,
    session,
    method,
    path,
    body,
    params
  );

  return parseTask(
    response.data,
    operation === 'configure'
  );
}

module.exports = {
  ManagementError,
  fail,
  segment,
  basePath,
  request,
  list,
  parseTask,
  contract,
  operate
};