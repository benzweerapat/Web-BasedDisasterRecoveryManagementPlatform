const {
  pool
} = require('../../db');

const connections =
  require('../repositories/connection.repository');

const srm =
  require('../adapters/vmware/srm.adapter');

const {
  srmTaskResult
} = require('./srm-task-result');

const {
  decryptCredential
} = require('../utils/encryption.util');

const {
  SafetyError,
  same,
  fingerprint
} = require('./srm-write-engine');

const {
  executeWithSrmSessionRetry,
  createSrmSessionContext
} = require('./srm-session.service');

const {
  classifyOperationError
} = require('../utils/operation-error.util');

const enc = encodeURIComponent;

const sorted = xs =>
  [...new Set(xs)].sort();

const password = c =>
  decryptCredential(
    c.encryptedPassword,
    c.encryptionIv,
    c.encryptionAuthTag
  );

const collectionScopeFor = intent =>
  intent.kind === 'mapping'
    ? 'mapping_sync_status'
    : intent.kind === 'pg'
      ? 'protection_group_sync_status'
      : 'recovery_plan_sync_status';

const collectionVerified = (
  intent,
  result
) =>
  [
    'SYNCED',
    'SYNCED_WITH_UNSUPPORTED_SCOPE'
  ].includes(
    result?.scopeStatus?.[
      collectionScopeFor(intent)
    ]
  ) &&
  result?.persistence?.committed === true &&
  (
    intent.kind !== 'mapping' ||
    result?.canonicalization?.status ===
      'SUCCESS'
  );

function expectedReprotectNotice(issue) {
  return String(
    issue.status ||
    issue.severity ||
    ''
  ).toUpperCase() === 'WARNING'
    &&
    String(
      issue.description ||
      issue.message ||
      ''
    ).trim() ===
      'Your workloads are not protected. Run reprotect.';
}

async function context(pairId) {
  const p = (await pool.run((s, p) => {
    const R = s.helpers;
    const views = {};

    return R.result((parent => {
      let rows = [
        R.context(parent)
      ];

      rows = R.join(
        rows,
        "current_srm_site_pairs",
        r =>
          views[
            "current_srm_site_pairs"
          ] ||
          s.read(
            "current_srm_site_pairs"
          ),
        r => true,
        "INNER JOIN"
      );

      rows = rows.filter(r =>
        R.binary(
          "=",
          R.ref(
            r,
            "id",
            null
          ),
          p[0]
        )
      );

      let groups =
        rows.map(r => [r]);

      let result =
        groups.flatMap(g => {
          const r =
            g[0] ||
            R.context(parent);

          return R.expand({
            ...R.star(r, null)
          }).map(value => ({
            value,
            r: R.projectContext(
              r,
              value
            ),
            g
          }));
        });

      return result
        .slice(0)
        .map(x => x.value);
    })(null));
  }, [
    pairId
  ], false)).rows[0];

  if (
    !p ||
    !p.local_vcenter_id ||
    !p.remote_vcenter_id ||
    p.local_vcenter_id ===
      p.remote_vcenter_id
  ) throw new SafetyError(
    'PAIR_NOT_CURRENT'
  );

  const remote = (await pool.run(
    (s, p) => {
      const R = s.helpers;
      const views = {};

      return R.result((parent => {
        let rows = [
          R.context(parent)
        ];

        rows = R.join(
          rows,
          "current_srm_site_pairs",
          r =>
            views[
              "current_srm_site_pairs"
            ] ||
            s.read(
              "current_srm_site_pairs"
            ),
          r => true,
          "INNER JOIN"
        );

        rows = rows.filter(r =>
          R.binary(
            "AND",
            R.binary(
              "AND",
              R.binary(
                "=",
                R.ref(
                  r,
                  "local_vcenter_id",
                  null
                ),
                p[0]
              ),
              R.binary(
                "=",
                R.ref(
                  r,
                  "remote_vcenter_id",
                  null
                ),
                p[1]
              )
            ),
            R.binary(
              "!=",
              R.ref(
                r,
                "connection_id",
                null
              ),
              p[2]
            )
          )
        );

        let groups =
          rows.map(r => [r]);

        let result =
          groups.flatMap(g => {
            const r =
              g[0] ||
              R.context(parent);

            return R.expand({
              "connection_id":
                R.ref(
                  r,
                  "connection_id",
                  null
                )
            }).map(value => ({
              value,
              r: R.projectContext(
                r,
                value
              ),
              g
            }));
          });

        result = R.unique(
          result,
          x => x.value
        );

        return result
          .slice(0)
          .map(x => x.value);
      })(null));
    },
    [
      p.remote_vcenter_id,
      p.local_vcenter_id,
      p.connection_id
    ],
    false
  )).rows;

  if (
    remote.length !== 1
  ) throw new SafetyError(
    'REMOTE_PAIR_AMBIGUOUS'
  );

  const c =
      await connections
        .findConnectionWithCredentialById(
          p.connection_id
        ),
    r =
      await connections
        .findConnectionWithCredentialById(
          remote[0].connection_id
        );

  if (
    !c?.isActive ||
    !r?.isActive ||
    c.systemType !== 'SRM' ||
    r.systemType !== 'SRM'
  ) throw new SafetyError(
    'SRM_CONNECTION_UNAVAILABLE'
  );

  const scope = sorted([
    p.local_vcenter_id,
    p.remote_vcenter_id
  ]).join(':');

  return {
    p,
    c,
    r,
    scope,

    identity: fingerprint([
      p.pairing_id,
      p.local_vcenter_id,
      p.remote_vcenter_id,
      c.id,
      c.baseUrl,
      r.id,
      r.baseUrl
    ])
  };
}
async function withGateway(intent, fn) {
  const x = await context(intent.pairId),
    {
      p,
      c,
      r
    } = x;

  if (intent.scopeIdentity !== x.identity) throw new SafetyError('PAIR_SCOPE_CHANGED');

  let session;

  try {
    session = await srm.loginLocal(
      c.baseUrl,
      c.username,
      password(c),
      c.verifyTls
    );

    await srm.createRemoteSession(
      c.baseUrl,
      session,
      p.pairing_id,
      r.username,
      password(r),
      c.verifyTls
    );

    const client = await srm.createClient(
        c.baseUrl,
        c.verifyTls
      ),
      base = '/api/rest/srm/v1',
      root = `/pairings/${enc(p.pairing_id)}`;

    async function request(method, path, body, params) {
      let response;

      try {
        response = await executeWithSrmSessionRetry({
          context: createSrmSessionContext({
            connectionId: c.id,
            site: c.site,
            sitePairId: p.pairing_id,
            localSrmHost: c.baseUrl,
            remoteSrmHost: r.baseUrl
          }),

          endpointPath: base + path,
          operationName: method,
          requestId: intent.requestId,

          operation: async () => {
            const result = await client.request({
              method,
              url: base + path,
              data: body,
              params,

              headers: {
                'x-dr-session': session,
                Accept: 'application/json',

                ...(
                  [
                    'POST',
                    'PUT',
                    'PATCH'
                  ].includes(method)
                    ? {
                      'Content-Type':
                        'application/json'
                    }
                    : {}
                )
              },

              timeout: 30000
            });

            if (result.status === 401) throw Object.assign(
              new Error(
                'SRM_SESSION_REJECTED'
              ),
              {
                httpStatus: 401
              }
            );

            return result;
          },

          reauthenticate: async () => {
            // Same connection and same pair; only an explicit 401 permits one retry.
            await srm.logoutLocal(
              c.baseUrl,
              session,
              c.verifyTls
            );

            session = await srm.loginLocal(
              c.baseUrl,
              c.username,
              password(c),
              c.verifyTls
            );

            await srm.createRemoteSession(
              c.baseUrl,
              session,
              p.pairing_id,
              r.username,
              password(r),
              c.verifyTls
            );
          },

          onDiagnostic: diagnostic =>
            console.warn(
              '[SRM session refresh]',
              JSON.stringify(diagnostic)
            )
        });
      } catch (e) {
        const status =
          e.response?.status ||
          e.httpStatus;

        const classified =
          classifyOperationError(
            e,
            {
              upstream: true
            }
          );

        const error =
          new SafetyError(
            status
              ? `SRM_HTTP_${status}`
              : classified.code
          );

        error.httpStatus = status;

        error.definite = [
          400,
          401,
          403,
          404,
          405,
          409,
          412,
          422
        ].includes(status);

        throw error;
      }

      if (
        ![
          200,
          201,
          202,
          204
        ].includes(response.status)
      ) {
        const error =
          new SafetyError(
            `SRM_HTTP_${response.status}`
          );

        error.definite = [
          400,
          401,
          403,
          404,
          405,
          409,
          412,
          422
        ].includes(response.status);

        throw error;
      }

      if (
        response.status !== 204 &&
        (
          !response.data ||
          typeof response.data !==
            'object' ||
          response.data._meta
            ?.errors?.length
        )
      ) throw new SafetyError(
        'SRM_CONTRACT_OR_PARTIAL_RESPONSE'
      );

      return response;
    }

    async function list(path, query = {}) {
      const result = [];

      for (
        let offset = 0, page = 0;
        page < 50;
        page++
      ) {
        const {
          data
        } = await request(
          'GET',
          path,
          undefined,
          {
            ...query,
            offset,
            limit: 100
          }
        );

        if (
          !Array.isArray(data.list) ||
          !Number.isInteger(
            data._meta?.total
          )
        ) throw new SafetyError(
          'SRM_PAGINATION_CONTRACT'
        );

        result.push(...data.list);

        if (
          result.length >=
          data._meta.total
        ) return result;

        if (!data.list.length) break;

        offset += data.list.length;
      }

      throw new SafetyError(
        'SRM_COLLECTION_TRUNCATED'
      );
    }

    const pair = (
      await request(
        'GET',
        root
      )
    ).data;

    if (
      pair.local_vc_server?.id !==
        p.local_vcenter_id ||
      pair.remote_vc_server?.id !==
        p.remote_vcenter_id ||
      !pair.local_srm_server?.id
    ) throw new SafetyError(
      'PAIR_IDENTITY_CHANGED'
    );

    const objectRoot = i =>
      root +
      (
        i.kind === 'pg'
          ? '/protection-management/groups'
          : '/recovery-management/plans'
      );

    const mappingRoot = i =>
      `${root}/srms/${
        enc(pair.local_srm_server.id)
      }/inventory-mappings/${
        i.mappingType
      }`;
          const gateway = {
      async readPlan(
        id,
        {
          allowReversed = false
        } = {}
      ) {
        const plan = (
          await request(
            'GET',
            `${root}/recovery-management/plans/${enc(id)}`
          )
        ).data;

        if (
          plan.id !== id
        ) throw new SafetyError(
          'PLAN_NOT_FOUND'
        );

        const reversed =
          allowReversed &&
          plan.protected_vc_guid ===
            p.remote_vcenter_id &&
          plan.recovery_vc_guid ===
            p.local_vcenter_id;

        if (
          !reversed &&
          plan.protected_vc_guid &&
          plan.protected_vc_guid !==
            p.local_vcenter_id
        ) throw new SafetyError(
          'PLAN_DIRECTION_MISMATCH'
        );

        if (
          !reversed &&
          plan.recovery_vc_guid &&
          plan.recovery_vc_guid !==
            p.remote_vcenter_id
        ) throw new SafetyError(
          'PLAN_DIRECTION_MISMATCH'
        );

        return plan;
      },

      async preflightPlan(id, action) {
        const plan =
          await gateway.readPlan(id);

        const refs = await list(
          `${root}/recovery-management/plans/${enc(id)}/protection-groups`
        );

        const blockers = [];

        if (!refs.length) blockers.push({
          code:
            'RECOVERY_PLAN_HAS_NO_PROTECTION_GROUPS'
        });

        for (const ref of refs) {
          if (
            typeof ref.id !==
            'string'
          ) throw new SafetyError(
            'MEMBER_IDENTITY_CONTRACT'
          );

          const group = (
            await request(
              'GET',
              `${root}/protection-management/groups/${enc(ref.id)}`
            )
          ).data;

          const groupName =
            group.name ||
            ref.name ||
            ref.id;

          const groupStatus =
            String(
              group.status ||
              group.state ||
              ''
            ).toUpperCase();

          const vms = await list(
            `${root}/protection-management/groups/${enc(ref.id)}/vms`
          );

          const issues = await list(
            `${root}/protection-management/groups/${enc(ref.id)}/issues`
          );

          if (
            !(
              action === 'reprotect'
                ? [
                  'OK',
                  'RECOVERED'
                ]
                : [
                  'OK'
                ]
            ).includes(groupStatus)
          ) blockers.push({
            code:
              'PROTECTION_GROUP_NOT_READY',
            groupName,
            status:
              groupStatus ||
              'UNKNOWN'
          });

          if (!vms.length) blockers.push({
            code:
              'PROTECTION_GROUP_HAS_NO_VMS',
            groupName
          });

          for (const vm of vms) {
            const vmStatus =
              String(
                vm.protection_status_details
                  ?.status ??
                vm.status ??
                vm.protection_status ??
                vm.protectionStatus ??
                'UNKNOWN'
              ).toUpperCase();

            if (
              !(
                action === 'reprotect'
                  ? [
                    'OK',
                    'PROTECTED',
                    'RECOVERED'
                  ]
                  : [
                    'OK',
                    'PROTECTED'
                  ]
              ).includes(vmStatus)
            ) blockers.push({
              code:
                'VM_NOT_PROTECTED',
              groupName,

              vmName:
                vm.name ||
                vm.vm_name ||
                vm.id,

              status: vmStatus
            });
          }

          if (
            issues.length
          ) blockers.push({
            code:
              'PROTECTION_GROUP_HAS_ISSUES',
            groupName,
            count: issues.length
          });
        }

        const planIssues = await list(
          `${root}/recovery-management/plans/${enc(id)}/issues`
        );

        const blockingPlanIssues =
          action === 'reprotect'
            ? planIssues.filter(
              issue =>
                !expectedReprotectNotice(
                  issue
                )
            )
            : planIssues;

        if (
          blockingPlanIssues.length
        ) blockers.push({
          code:
            'RECOVERY_PLAN_HAS_ISSUES',
          count:
            blockingPlanIssues.length
        });

        return {
          ready:
            blockers.length === 0,
          blockers,

          checkedAt:
            new Date().toISOString(),

          planStatus: plan.status
        };
      },

      async executePlan(
        id,
        action,
        body
      ) {
        const endpoint =
          action === 'migration'
            ? 'recovery'
            : action;

        if (
          ![
            'test',
            'cleanup',
            'recovery',
            'reprotect'
          ].includes(endpoint)
        ) throw new SafetyError(
          'UNSUPPORTED_RECOVERY_ACTION'
        );

        const response =
          await request(
            'POST',
            `${root}/recovery-management/plans/${enc(id)}/actions/${endpoint}`,
            body
          );

        if (
          response.status !== 202 ||
          typeof response.data.id !==
            'string' ||
          ![
            'QUEUED',
            'RUNNING',
            'SUCCESS',
            'ERROR',
            'CANCELLED'
          ].includes(
            response.data.status
          )
        ) throw new SafetyError(
          'RECOVERY_TASK_CONTRACT'
        );

        return srmTaskResult(
          response.data
        );
      },

      async cancelPlan(id) {
        const response =
          await request(
            'POST',
            `${root}/recovery-management/plans/${enc(id)}/actions/cancel`
          );

        if (
          response.status !== 204
        ) throw new SafetyError(
          'CANCEL_RESPONSE_CONTRACT'
        );
      },
            async readObject(i) {
        let raw;

        try {
          raw = (
            await request(
              'GET',
              `${objectRoot(i)}/${enc(i.objectId)}`
            )
          ).data;
        } catch (e) {
          if (
            e.code ===
            'SRM_HTTP_404'
          ) return null;

          throw e;
        }

        if (
          typeof raw.id !==
          'string'
        ) throw new SafetyError(
          'OBJECT_NOT_FOUND'
        );

        if (
          raw.protected_vc_guid
            ? raw.protected_vc_guid !==
              p.local_vcenter_id
            : (
              i.kind === 'pg'
            )
        ) throw new SafetyError(
          'OBJECT_DIRECTION_MISMATCH'
        );

        const items = await list(
          `${objectRoot(i)}/${enc(raw.id)}/${
            i.kind === 'pg'
              ? 'vms'
              : 'protection-groups'
          }`
        );

        const memberIds =
          items.map(v => v.id);

        if (
          memberIds.some(
            id =>
              typeof id !==
                'string' ||
              i.kind === 'pg' &&
              !id.startsWith(
                'VirtualMachine:'
              )
          )
        ) throw new SafetyError(
          'MEMBER_IDENTITY_CONTRACT'
        );

        return {
          id: raw.id,
          name: raw.name,

          description:
            raw.description ||
            '',

          source:
            raw.protected_vc_guid ||
            p.local_vcenter_id,

          type:
            raw.replication_type ||
            null,

          members:
            sorted(memberIds)
        };
      },

      async listObjects(i) {
        const all =
            await list(
              objectRoot(i)
            ),
          out = [];

        for (
          const row of all.filter(
            o =>
              !o.protected_vc_guid ||
              o.protected_vc_guid ===
                p.local_vcenter_id
          )
        ) out.push(
          await gateway.readObject({
            ...i,
            objectId: row.id
          })
        );

        return out.sort(
          (a, b) =>
            a.id.localeCompare(b.id)
        );
      },

      matches(actual, desired) {
        return Boolean(actual) &&
          Object.entries(
            desired
          ).every(
            ([k, v]) =>
              k === 'id' ||
              same(actual[k], v)
          );
      },

      async validate(i) {
        if (i.kind === 'mapping') {
          if (
            i.action !== 'delete'
          ) await gateway
            .validateMappingSpec(
              i,
              i
            );

          return;
        }

        if (i.action === 'create') {
          if (
            i.kind === 'pg' &&
            i.changes.type !== 'HBR'
          ) throw new SafetyError(
            'ONLY_VERIFIED_HBR_CREATION'
          );

          for (
            const id of
            i.changes.members
          ) await gateway
            .validateMember(
              {
                ...i,
                memberId: id,
                memberAction: 'add'
              },
              {
                id: null,
                members: [],
                type: i.changes.type,
                source: i.changes.source
              }
            );
        }
      },

      async validateMember(
        i,
        before
      ) {
        if (
          i.kind === 'pg' &&
          before.type !== 'HBR'
        ) throw new SafetyError(
          'PG_NOT_HBR'
        );

        if (
          i.memberAction ===
          'remove'
        ) return;

        if (i.kind === 'pg') {
          if (
            before.members
              ?.includes(i.memberId)
          ) return;

          const eligible =
            await list(
              `${root}/vcenters/${enc(p.local_vcenter_id)}/replicated-vms`
            );

          const match =
            eligible.find(
              v =>
                v.id === i.memberId &&
                v.template !== true
            );

          if (!match) throw new SafetyError(
            'VM_NOT_REPLICATED_AT_SOURCE'
          );

          i.memberId = match.id;

          const groups =
            await gateway.listObjects({
              kind: 'pg'
            });

          if (
            groups.some(
              g =>
                g.id !== before.id &&
                g.members.includes(
                  i.memberId
                )
            )
          ) throw new SafetyError(
            'VM_ALREADY_IN_OTHER_PG'
          );
        } else {
          const group =
            await gateway.readObject({
              kind: 'pg',
              objectId: i.memberId
            });

          if (
            !group ||
            group.source !==
              before.source
          ) throw new SafetyError(
            'PG_DIRECTION_MISMATCH'
          );

          if (
            !Array.isArray(
              group.members
            ) ||
            group.members.length === 0
          ) throw new SafetyError(
            'PROTECTION_GROUP_HAS_NO_VMS'
          );
        }
      },

      async validateDelete() {
        // SRM is authoritative for delete semantics, including protection groups
        // that are still referenced by recovery plans.
      },
            async writeObject(
        i,
        desired
      ) {
        let body,
          path = objectRoot(i),
          method = 'POST';

        if (i.action === 'delete') {
          method = 'DELETE';

          path +=
            `/${enc(i.objectId)}`;
        } else if (
          i.kind === 'pg' &&
          i.action === 'members' &&
          i.memberAction === 'remove'
        ) {
          // SRM exposes a dedicated operation for removing a VM from an HBR
          // group. This changes group membership only; it is intentionally not
          // the separate remove-protection operation.
          path +=
            `/${enc(i.objectId)}/vms/${enc(i.memberId)}/actions/remove-from-group`;
        } else {
          body = {
            name: desired.name,

            description:
              desired.description
          };

          if (
            i.action === 'create'
          ) Object.assign(
            body,
            {
              protected_vc_guid:
                p.local_vcenter_id,

              ...(
                i.kind === 'pg'
                  ? {
                    replication_type:
                      'HBR'
                  }
                  : {}
              )
            }
          );
          else path +=
            `/${enc(i.objectId)}/actions/reconfigure`;

          // Include the current HBR VM list when reconfiguring metadata.
          // The engine carries all verified members and checks for concurrent changes.
          if (
            i.action === 'edit' &&
            i.kind === 'pg' &&
            desired.type === 'HBR'
          ) {
            if (
              !Array.isArray(
                desired.members
              )
            ) throw new SafetyError(
              'MEMBER_IDENTITY_CONTRACT'
            );

            body.hbr_spec = {
              vms: [
                ...desired.members
              ]
            };
          }

          // Other metadata edits omit membership; membership intents carry the latest union.
          if (
            i.action !== 'edit'
          ) Object.assign(
            body,
            i.kind === 'pg'
              ? {
                hbr_spec: {
                  vms:
                    desired.members
                }
              }
              : {
                protection_groups:
                  desired.members
              }
          );

          // A recovery plan with no protection groups has no authoritative
          // direction in SRM.  When the first group is added, send the
          // protected vCenter explicitly so SRM can establish the direction
          // before validating the group reference.  Omitting this field makes
          // otherwise valid add-member requests fail with SRM_HTTP_400.
          if (
            i.kind === 'rp' &&
            i.action === 'members' &&
            desired.members.length > 0
          ) {
            if (
              typeof desired.source !== 'string' ||
              !desired.source
            ) throw new SafetyError(
              'OBJECT_DIRECTION_MISMATCH'
            );

            body.protected_vc_guid =
              desired.source;
          }
        }

        const response =
          await request(
            method,
            path,
            body
          );

        if (
          response.status !== 202
        ) throw new SafetyError(
          'SRM_TASK_RESPONSE_EXPECTED'
        );

        const t = response.data;

        if (
          typeof t.id !==
            'string' ||
          ![
            'QUEUED',
            'RUNNING',
            'SUCCESS',
            'ERROR',
            'CANCELLED'
          ].includes(t.status)
        ) throw new SafetyError(
          'SRM_TASK_CONTRACT'
        );

        return srmTaskResult(t);
      },

      async task(id) {
        const t = (
          await request(
            'GET',
            `/tasks/${enc(id)}`
          )
        ).data;

        return srmTaskResult(t);
      },
            async listMappings(i) {
        return (
          await list(
            mappingRoot(i)
          )
        ).map(m => {
          if (
            !m.id ||
            typeof m.primary_object !==
              'string' ||
            typeof m.secondary_object !==
              'string'
          ) throw new SafetyError(
            'MAPPING_IDENTITY_CONTRACT'
          );

          // Complex network policy needs a separate compensation specification; fail closed on replace/delete.
          return {
            id: m.id,

            sourceObject:
              m.primary_object,

            targetObject:
              m.secondary_object,

            complex: Boolean(
              m.ip_mapping ||
              m.test_network_mapping
            )
          };
        }).sort(
          (a, b) =>
            a.id.localeCompare(b.id)
        );
      },

      async resolveInventoryUrn(
        mappingType,
        vcId,
        idOrUrn
      ) {
        if (
          !idOrUrn ||
          (
            typeof idOrUrn ===
              'string' &&
            idOrUrn.split(':')
              .length === 3
          )
        ) {
          return idOrUrn;
        }

        try {
          const site =
            vcId ===
              p.local_vcenter_id
              ? 'source'
              : 'target';

          const items =
            await gateway.listInventory(
              mappingType,
              site
            );

          const moid =
            typeof idOrUrn ===
              'string' &&
            idOrUrn.includes(':')
              ? idOrUrn
                .split(':')[1]
              : idOrUrn;

          const match =
            items.find(item => {
              const itemId =
                item.id ||
                item.storage_policy_id ||
                '';

                            return itemId === idOrUrn ||
                (
                  itemId.split(':')
                    .length === 3 &&
                  itemId.split(':')[1] ===
                    moid
                ) ||
                item.name === idOrUrn;
            });
          return match?.id ||
            match?.storage_policy_id ||
            idOrUrn;
        } catch {
          return idOrUrn;
        }
      },

      async validateMappingSpec(
        i,
        spec
      ) {
        const resource = {
          networks: 'network',
          folders: 'vm-folder',
          resources: 'compute'
        }[i.mappingType];

        if (
          spec.sourceObject
        ) spec.sourceObject =
          await gateway.resolveInventoryUrn(
            i.mappingType,
            p.local_vcenter_id,
            spec.sourceObject
          );

        if (
          spec.targetObject
        ) spec.targetObject =
          await gateway.resolveInventoryUrn(
            i.mappingType,
            p.remote_vcenter_id,
            spec.targetObject
          );

        for (
          const [vc, id] of [
            [
              p.local_vcenter_id,
              spec.sourceObject
            ],
            [
              p.remote_vcenter_id,
              spec.targetObject
            ]
          ]
        ) {
          const path =
            `${root}/vcenters/${enc(vc)}/${
              resource
                ? `inventory/${resource}`
                : 'storage-policies'
            }/${enc(id)}`;

          const value = (
            await request(
              'GET',
              path
            )
          ).data;

          if (
            value.id !== id &&
            value.storage_policy_id !== id
          ) throw new SafetyError(
            'MAPPING_INVENTORY_IDENTITY'
          );
        }
      },

      async deleteMapping(i, id) {
        const current = (
          await gateway
            .listMappings(i)
        ).find(
          m => m.id === id
        );

        if (
          current?.complex
        ) throw new SafetyError(
          'MAPPING_HAS_DEPENDENT_CONFIGURATION'
        );

        const r =
          await request(
            'DELETE',
            `${mappingRoot(i)}/${enc(id)}`
          );

        if (
          r.status !== 204
        ) throw new SafetyError(
          'MAPPING_DELETE_CONTRACT'
        );
      },

      async createMapping(i, spec) {
        const r =
          await request(
            'POST',
            mappingRoot(i),
            {
              mapping_source_object:
                spec.sourceObject,

              mapping_target_object:
                spec.targetObject
            }
          );

        if (
          r.status !== 204
        ) throw new SafetyError(
          'MAPPING_CREATE_CONTRACT'
        );
      },
            async listReplicatedVms() {
        return await list(`${root}/vcenters/${enc(p.local_vcenter_id)}/replicated-vms`);
      },

      async configureAllVms(groupId) {
        const r = await request(
          'POST',
          `${objectRoot({ kind: 'pg' })}/${enc(groupId)}/actions/configure-all-vms`,
          {}
        );

        return r.data;
      },

      async options() {
        const [
          vms,
          groups,
          plans
        ] = await Promise.all([
          gateway.listReplicatedVms(),
          list(`${root}/protection-management/groups`),
          list(`${root}/recovery-management/plans`)
        ]);

        const protectedIds = new Set();

        for (
          const group of groups.filter(
            g =>
              g.protected_vc_guid ===
              p.local_vcenter_id
          )
        ) {
          const detail =
            await gateway.readObject({
              kind: 'pg',
              objectId: group.id
            });

          detail.members.forEach(
            id => protectedIds.add(id)
          );
        }

        return {
          pairId: p.id,

          sourceVcenterId:
            p.local_vcenter_id,

          targetVcenterId:
            p.remote_vcenter_id,

          vms: vms.filter(
            v =>
              v.template !== true &&
              !protectedIds.has(v.id)
          ),

          groups: groups.filter(
            g =>
              g.protected_vc_guid ===
                p.local_vcenter_id &&
              g.replication_type ===
                'HBR' &&
              [
                'OK',
                'NOT_CONFIGURED'
              ].includes(g.status)
          ),

          plans: plans.filter(
            plan =>
              !plan.protected_vc_guid ||
              plan.protected_vc_guid ===
                p.local_vcenter_id
          )
        };
      },

      async listInventory(
        resourceType,
        site = 'source'
      ) {
        const vcId =
          site === 'source'
            ? p.local_vcenter_id
            : p.remote_vcenter_id;

        const resource = {
          networks:
            'inventory/network',

          folders:
            'inventory/vm-folder',

          resources:
            'inventory/compute',

          datastores:
            'inventory/datastores',

          'storage-policies':
            'storage-policies'
        }[resourceType];

        if (!resource) throw new SafetyError(
          'MAPPING_TYPE_INVALID'
        );

        const endpoint =
          `${root}/vcenters/${enc(vcId)}/${resource}`;

        if (
          resourceType ===
          'storage-policies'
        ) return list(endpoint);

        const queue = [''],
          visited = new Set(),
          objects = new Map();

        while (queue.length) {
          const path = queue.shift();

          if (
            visited.has(path)
          ) continue;

          if (
            visited.size >= 500
          ) throw new SafetyError(
            'SRM_INVENTORY_TRUNCATED'
          );

          visited.add(path);

          for (
            const item of
            await list(
              endpoint,
              path
                ? {
                  path
                }
                : {}
            )
          ) {
            if (
              typeof item.id !==
              'string'
            ) throw new SafetyError(
              'INVENTORY_IDENTITY_CONTRACT'
            );

            const type =
              item.id.split(':')[0];

            const container =
              [
                'Folder',
                'Datacenter'
              ].includes(type);

            if (
              container &&
              item.path &&
              !visited.has(item.path)
            ) queue.push(item.path);

            const selectable =
              resourceType ===
                'networks'
                ? [
                  'Network',
                  'DistributedVirtualPortgroup',
                  'OpaqueNetwork'
                ].includes(type)
                : resourceType ===
                    'folders'
                  ? type === 'Folder'
                  : resourceType ===
                      'datastores'
                    ? type ===
                      'Datastore'
                    : [
                      'HostSystem',
                      'ComputeResource',
                      'ClusterComputeResource',
                      'ResourcePool'
                    ].includes(type);

            if (
              selectable
            ) objects.set(
              item.id,
              item
            );
          }
        }

        return [
          ...objects.values()
        ].sort(
          (a, b) =>
            String(
              a.path ||
              a.name
            ).localeCompare(
              String(
                b.path ||
                b.name
              )
            )
        );
      },
            async createPlaceholderDatastore(datastoreId) {
        // Placeholder datastores are configured on the vCenter owned by the
        // local SRM server represented by this directional pair. Supplying an
        // object from the remote vCenter is a valid inventory id, but SRM
        // rejects it with HTTP 400 because it is outside this mapping scope.
        const inventory =
          await gateway.listInventory(
            'datastores',
            'source'
          );

        const selected =
          inventory.find(
            item =>
              item.id === datastoreId ||
              item.name === datastoreId
          );

        if (
          !selected?.id
        ) throw new SafetyError(
          'MAPPING_INVENTORY_IDENTITY'
        );

        const response =
          await request(
            'POST',
            mappingRoot({
              mappingType:
                'placeholder-datastores'
            }),
            {
              datastores: [
                selected.id
              ]
            }
          );

        if (
          response.status === 204
        ) return {
          id: null,
          status: 'SUCCESS'
        };

        if (
          response.status !== 202 ||
          typeof response.data.id !==
            'string'
        ) throw new SafetyError(
          'SRM_TASK_CONTRACT'
        );

        return srmTaskResult(
          response.data
        );
      },

      async deletePlaceholderDatastore(datastoreId) {
        const current = await list(
          mappingRoot({
            mappingType:
              'placeholder-datastores'
          })
        );

        const selected =
          current.find(
            item =>
              item.id === datastoreId
          );

        if (!selected) throw new SafetyError(
          'OBJECT_NOT_FOUND'
        );

        const response =
          await request(
            'DELETE',
            `${mappingRoot({
              mappingType:
                'placeholder-datastores'
            })}/${enc(selected.id)}`
          );

        if (
          response.status === 204
        ) return {
          id: null,
          status: 'SUCCESS'
        };

        if (
          response.status !== 202 ||
          typeof response.data.id !==
            'string'
        ) throw new SafetyError(
          'SRM_TASK_CONTRACT'
        );

        return srmTaskResult(
          response.data
        );
      },

      async collect() {
        // Collection creates its own sessions; release the write session first.
        if (session) {
          await srm.logoutLocal(
            c.baseUrl,
            session,
            c.verifyTls
          );

          session = null;
        }

        const sync =
          require('./srm-sync.service');

        const primary =
          await sync.syncSrm(
            c.id,
            'srm-reconciliation',
            require('crypto')
              .randomUUID(),
            {}
          );

        if (
          !collectionVerified(
            intent,
            primary
          )
        ) throw new SafetyError(
          'SRM_COLLECTION_NOT_SUCCESSFUL'
        );

        let degraded = false;

        try {
          const mirror =
            await sync.syncSrm(
              r.id,
              'srm-reconciliation',
              require('crypto')
                .randomUUID(),
              {}
            );

          degraded =
            !collectionVerified(
              intent,
              mirror
            );
        } catch {
          degraded = true;
        }

        return {
          degraded
        };
      }
    };

    return await fn(gateway);
  } finally {
    if (session) await srm
      .logoutLocal(
        c.baseUrl,
        session,
        c.verifyTls
      )
      .catch(() => {});
  }
}

module.exports = {
  context,
  withGateway,
  collectionVerified,
  expectedReprotectNotice
};
