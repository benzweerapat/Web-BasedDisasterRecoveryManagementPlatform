const {
  pool
} = require('../../db');

const connections =
  require('../repositories/connection.repository');

const vr =
  require('../adapters/vmware/vr.adapter');

const adapter =
  require('../adapters/vmware/vr-management.adapter');

const {
  decryptCredential
} = require('../utils/encryption.util');

const {
  ManagementError,
  segment,
  fail
} = adapter;

const credential = c =>
  decryptCredential(
    c.encryptedPassword,
    c.encryptionIv,
    c.encryptionAuthTag
  );

async function withPair(
  pairId,
  callback
) {
  if (
    !Number.isSafeInteger(
      Number(pairId)
    ) ||
    Number(pairId) < 1
  ) {
    throw new ManagementError(
      'VALIDATION_ERROR',
      'INVALID_PAIR_ID',
      400
    );
  }

  const {
    rows
  } = await pool.run(
    (s, p) => {
      const R = s.helpers;
      const views = {};

      return R.result(
        (parent => {
          let rows = [
            R.context(parent)
          ];

          rows = R.join(
            rows,
            "current_vr_pairings",

            r =>
              views["current_vr_pairings"] ||
              s.read(
                "current_vr_pairings"
              ),

            r => true,
            "INNER JOIN"
          );

          rows = rows.filter(
            r =>
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
            groups.flatMap(
              g => {
                const r =
                  g[0] ||
                  R.context(parent);

                return R.expand({
                  ...R.star(r, null)
                }).map(
                  value => ({
                    value,

                    r:
                      R.projectContext(
                        r,
                        value
                      ),

                    g
                  })
                );
              }
            );

          return result
            .slice(0)
            .map(x => x.value);
        })(null)
      );
    },

    [pairId],
    false
  );

  const stored = rows[0];

  if (!stored) {
    throw new ManagementError(
      'VALIDATION_ERROR',
      'PAIR_NOT_CURRENT',
      404
    );
  }

  const c =
    await connections
      .findConnectionWithCredentialById(
        stored.connection_id
      );

  if (
    !c?.isActive ||
    c.systemType !== 'VR'
  ) {
    throw fail(
      'VR_CONNECTION_NOT_CURRENT'
    );
  }

  let session;

  try {
    session =
      await vr.loginLocal(
        c.baseUrl,
        c.username,
        credential(c),
        c.verifyTls
      );

    if (!session) {
      throw new ManagementError(
        'AUTH_ERROR',
        'VR_SESSION_UNAVAILABLE'
      );
    }

    const source =
      stored.local_vcenter_external_id;

    const target =
      stored.remote_vcenter_external_id;

    if (!source || !target) {
      throw fail(
        'VR_PAIR_IDENTITY_MISSING'
      );
    }

    if (source === target) {
      throw fail(
        'VR_SELF_PAIRING_NOT_SUPPORTED'
      );
    }

    let remoteConnectionId = c.id;

    if (source !== target) {
      const remote =
        await pool.run(
          (s, p) => {
            const R = s.helpers;
            const views = {};

            return R.result(
              (parent => {
                let rows = [
                  R.context(parent)
                ];

                rows = R.join(
                  rows,
                  "current_vr_pairings",

                  r =>
                    views["current_vr_pairings"] ||
                    s.read(
                      "current_vr_pairings"
                    ),

                  r => true,
                  "INNER JOIN"
                );

                rows = rows.filter(
                  r =>
                    R.binary(
                      "AND",

                      R.binary(
                        "AND",

                        R.binary(
                          "=",

                          R.ref(
                            r,
                            "local_vcenter_external_id",
                            null
                          ),

                          p[0]
                        ),

                        R.binary(
                          "=",

                          R.ref(
                            r,
                            "remote_vcenter_external_id",
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
                  groups.flatMap(
                    g => {
                      const r =
                        g[0] ||
                        R.context(
                          parent
                        );

                      return R.expand({
                        "connection_id":
                          R.ref(
                            r,
                            "connection_id",
                            null
                          )
                      }).map(
                        value => ({
                          value,

                          r:
                            R.projectContext(
                              r,
                              value
                            ),

                          g
                        })
                      );
                    }
                  );

                result =
                  R.unique(
                    result,
                    x => x.value
                  );

                return result
                  .slice(0)
                  .map(x => x.value);
              })(null)
            );
          },

          [
            target,
            source,
            c.id
          ],

          false
        );

      if (
        remote.rows.length !== 1
      ) {
        throw fail(
          'VR_REMOTE_CONNECTION_AMBIGUOUS'
        );
      }

      remoteConnectionId =
        remote.rows[0].connection_id;

      const r =
        await connections
          .findConnectionWithCredentialById(
            remoteConnectionId
          );

      if (
        !r?.isActive ||
        r.systemType !== 'VR'
      ) {
        throw fail(
          'VR_REMOTE_CONNECTION_UNAVAILABLE'
        );
      }

      await vr.createRemoteSession(
        c.baseUrl,
        session,
        stored.pairing_id,
        r.username,
        credential(r),
        c.verifyTls
      );
    }

    const {
      data: pair
    } = await adapter.request(
      c,
      session,
      'GET',
      `/pairings/${segment(
        stored.pairing_id
      )}`
    );

    if (
      pair.local_vc_server?.id !==
        source ||
      pair.remote_vc_server?.id !==
        target
    ) {
      throw fail(
        'VR_PAIR_IDENTITY_CHANGED'
      );
    }

    const root =
      `/pairings/${segment(
        stored.pairing_id
      )}`;

    return await callback({
      c,
      session,
      stored,
      source,
      target,
      root,
      remoteConnectionId,

      sourceName:
        pair.local_vc_server.name,

      targetName:
        pair.remote_vc_server.name
    });
  } finally {
    if (session) {
      await vr.logoutLocal(
        c.baseUrl,
        session,
        c.verifyTls
      ).catch(() => {});
    }
  }
}
async function getPairs() {
  const {
    rows
  } = await pool.run(
    (s, p) => {
      const R = s.helpers;
      const views = {};

      return R.result(
        (parent => {
          let rows = [
            R.context(parent)
          ];

          rows = R.join(
            rows,
            "p",

            r =>
              views["current_vr_pairings"] ||
              s.read(
                "current_vr_pairings"
              ),

            r => true,
            "INNER JOIN"
          );

          rows = R.join(
            rows,
            "c",

            r =>
              views["current_connections"] ||
              s.read(
                "current_connections"
              ),

            r =>
              R.binary(
                "=",

                R.ref(
                  r,
                  "id",
                  "c"
                ),

                R.ref(
                  r,
                  "connection_id",
                  "p"
                )
              ),

            "INNER JOIN"
          );

          rows = R.join(
            rows,
            "vc",

            r =>
              views["current_connections"] ||
              s.read(
                "current_connections"
              ),

            r =>
              R.binary(
                "=",

                R.ref(
                  r,
                  "id",
                  "vc"
                ),

                R.ref(
                  r,
                  "associated_vcenter_connection_id",
                  "c"
                )
              ),

            "LEFT JOIN"
          );

          rows = R.join(
            rows,
            "rpair",

            r =>
              views["vr_pairings"] ||
              s.read(
                "vr_pairings"
              ),

            r =>
              R.binary(
                "AND",

                R.binary(
                  "=",

                  R.ref(
                    r,
                    "pairing_id",
                    "rpair"
                  ),

                  R.ref(
                    r,
                    "pairing_id",
                    "p"
                  )
                ),

                R.binary(
                  "!=",

                  R.ref(
                    r,
                    "connection_id",
                    "rpair"
                  ),

                  R.ref(
                    r,
                    "connection_id",
                    "p"
                  )
                )
              ),

            "LEFT JOIN"
          );

          rows = R.join(
            rows,
            "rc",

            r =>
              views["current_connections"] ||
              s.read(
                "current_connections"
              ),

            r =>
              R.binary(
                "=",

                R.ref(
                  r,
                  "id",
                  "rc"
                ),

                R.ref(
                  r,
                  "connection_id",
                  "rpair"
                )
              ),

            "LEFT JOIN"
          );

          rows = R.join(
            rows,
            "rvc",

            r =>
              views["current_connections"] ||
              s.read(
                "current_connections"
              ),

            r =>
              R.binary(
                "=",

                R.ref(
                  r,
                  "id",
                  "rvc"
                ),

                R.ref(
                  r,
                  "associated_vcenter_connection_id",
                  "rc"
                )
              ),

            "LEFT JOIN"
          );

          rows = rows.filter(
            r =>
              R.binary(
                "AND",

                R.binary(
                  "AND",

                  R.unary(
                    "IS NOT NULL",

                    R.ref(
                      r,
                      "local_vcenter_external_id",
                      "p"
                    )
                  ),

                  R.unary(
                    "IS NOT NULL",

                    R.ref(
                      r,
                      "remote_vcenter_external_id",
                      "p"
                    )
                  )
                ),

                R.binary(
                  "!=",

                  R.ref(
                    r,
                    "local_vcenter_external_id",
                    "p"
                  ),

                  R.ref(
                    r,
                    "remote_vcenter_external_id",
                    "p"
                  )
                )
              )
          );

          let groups =
            rows.map(r => [r]);

          let result =
            groups.flatMap(
              g => {
                const r =
                  g[0] ||
                  R.context(parent);

                return R.expand({
                  "id":
                    R.ref(
                      r,
                      "id",
                      "p"
                    ),

                  "connectionId":
                    R.ref(
                      r,
                      "connection_id",
                      "p"
                    ),

                  "pairingId":
                    R.ref(
                      r,
                      "pairing_id",
                      "p"
                    ),

                  "sourceVcenterId":
                    R.ref(
                      r,
                      "local_vcenter_external_id",
                      "p"
                    ),

                  "targetVcenterId":
                    R.ref(
                      r,
                      "remote_vcenter_external_id",
                      "p"
                    ),

                  "sourceName":
                    R.fn(
                      "coalesce",
                      [
                        R.ref(
                          r,
                          "site",
                          "vc"
                        ),

                        R.ref(
                          r,
                          "connection_name",
                          "vc"
                        ),

                        R.ref(
                          r,
                          "local_site_name",
                          "p"
                        )
                      ]
                    ),

                  "targetName":
                    R.fn(
                      "coalesce",
                      [
                        R.ref(
                          r,
                          "site",
                          "rvc"
                        ),

                        R.ref(
                          r,
                          "connection_name",
                          "rvc"
                        ),

                        R.ref(
                          r,
                          "remote_site_name",
                          "p"
                        )
                      ]
                    ),

                  "sourceHost":
                    R.ref(
                      r,
                      "local_site_name",
                      "p"
                    ),

                  "targetHost":
                    R.ref(
                      r,
                      "remote_site_name",
                      "p"
                    )
                }).map(
                  value => ({
                    value,

                    r:
                      R.projectContext(
                        r,
                        value
                      ),

                    g
                  })
                );
              }
            );

          result.sort(
            (a, b) =>
              R.order([
                [
                  R.ref(
                    a.r,
                    "connection_id",
                    "p"
                  ),

                  R.ref(
                    b.r,
                    "connection_id",
                    "p"
                  ),

                  "ASC",
                  null
                ],

                [
                  R.ref(
                    a.r,
                    "id",
                    "p"
                  ),

                  R.ref(
                    b.r,
                    "id",
                    "p"
                  ),

                  "ASC",
                  null
                ]
              ])
          );

          return result
            .slice(0)
            .map(x => x.value);
        })(null)
      );
    },

    [],
    false
  );

  return rows;
}

async function getSuitableVms(pairId) {
  return withPair(
    pairId,
    async x => {
      const list =
        await adapter.list(
          x.c,
          x.session,

          `${x.root}/vcenters/${segment(
            x.source
          )}/vms`,

          {
            suitable_for_replication:
              true
          }
        );

      return list.map(
        vm => ({
          vmId: vm.id,
          vmName: vm.name,
          powerState:
            vm.power_state,

          sourceVcenterId:
            x.source,

          sourceSite:
            x.sourceName,

          suitableForReplication:
            true
        })
      );
    }
  );
}
async function configuration(
  x,
  vmId
) {
  if (
    typeof vmId !== 'string' ||
    !vmId.startsWith(
      'VirtualMachine:'
    ) ||
    !vmId.endsWith(
      `:${x.source}`
    )
  ) {
    throw new ManagementError(
      'VALIDATION_ERROR',
      'INVALID_VM_ID',
      400
    );
  }

  const path =
    `${x.root}/vcenters/${segment(
      x.source
    )}/vms/${segment(vmId)}`;

  const {
    data: capability
  } = await adapter.request(
    x.c,
    x.session,
    'GET',
    `${path}/capability`
  );

  const disks =
    await adapter.list(
      x.c,
      x.session,
      `${path}/disks`
    );

  const datastores =
    await adapter.list(
      x.c,
      x.session,

      `${x.root}/vcenters/${segment(
        x.target
      )}/datastores`
    );

  const policies =
    await adapter.list(
      x.c,
      x.session,

      `${x.root}/vcenters/${segment(
        x.target
      )}/storage-policies`
    );

  const schema =
    await adapter.contract(
      x.c,
      x.session
    );

  if (
    capability.vm_id !== vmId ||
    !Number.isInteger(
      capability.min_rpo_mins
    )
  ) {
    throw fail(
      'VR_CAPABILITY_SHAPE'
    );
  }

  const rpo =
    schema.components.schemas
      .ConfigureReplicationSpec
      .properties.rpo;

  if (
    !Number.isInteger(
      rpo.minimum
    ) ||
    !Number.isInteger(
      rpo.maximum
    )
  ) {
    throw fail(
      'VR_RPO_CONTRACT'
    );
  }

  return {
    vmId,

    sourceVcenterId:
      x.source,

    targetVcenterId:
      x.target,

    sourceName:
      x.sourceName,

    targetName:
      x.targetName,

    capability,
    disks,
    datastores,
    policies,

    rpo: {
      min: Math.max(
        rpo.minimum,
        capability.min_rpo_mins
      ),

      max: rpo.maximum
    },

    schema
  };
}

async function getConfiguration(
  pairId,
  vmId
) {
  return withPair(
    pairId,
    async x => {
      const data =
        await configuration(
          x,
          vmId
        );

      // Explicit projection: session, credentials and upstream schema examples never leave the service.
      return publicConfiguration(
        data
      );
    }
  );
}

const pick = (
  obj,
  keys
) => Object.fromEntries(
  keys
    .filter(
      k =>
        obj?.[k] !== undefined
    )
    .map(
      k => [
        k,
        obj[k]
      ]
    )
);

function publicConfiguration(data) {
  return {
    ...pick(
      data,
      [
        'vmId',
        'sourceVcenterId',
        'targetVcenterId',
        'sourceName',
        'targetName',
        'rpo'
      ]
    ),

    settings:
      require(
        './vr-settings.service'
      ).settingsContract(
        data.schema,
        data.capability
      ),

    capability:
      pick(
        data.capability,
        [
          'vm_id',
          'vm_validation_status',
          'quiescing_supported',
          'network_compression_supported',
          'mpit_supported',
          'lwd_encryption_supported',
          'vm_encrypted',
          'auto_replicate_new_disks_supported',
          'min_rpo_mins',
          'reconfigure_vm_disks_supported'
        ]
      ),

    disks:
      data.disks.map(
        d =>
          pick(
            d,
            [
              'vm_id',
              'device_key',
              'is_vm_home',
              'capacity',
              'label',
              'supported_for_replication'
            ]
          )
      ),

    datastores:
      data.datastores.map(
        d =>
          pick(
            d,
            [
              'id',
              'name',
              'capacity',
              'free_space',
              'accessible',
              'maintenance_mode',
              'overall_status'
            ]
          )
      ),

    policies:
      data.policies.map(
        p =>
          pick(
            p,
            [
              'storage_policy_id',
              'storage_policy_name'
            ]
          )
      )
  };
}

async function getCurrentConfiguration(
  pairId,
  replicationId
) {
  return withPair(
    pairId,
    async x => {
      const {
        data: r
      } = await adapter.request(
        x.c,
        x.session,
        'GET',

        `${x.root}/replications/${segment(
          replicationId
        )}`,

        undefined,

        {
          extended_info: true
        }
      );

      if (
        r.source_vc_id !==
          x.source ||
        r.target_vc_id !==
          x.target
      ) {
        throw fail(
          'VR_REPLICATION_IDENTITY'
        );
      }

      const config =
        await configuration(
          x,
          r.vm_id
        );

      const disks =
        await adapter.list(
          x.c,
          x.session,

          `${x.root}/replications/${segment(
            replicationId
          )}/disks`
        );

      return {
        ...publicConfiguration(
          config
        ),

        current: {
          replicationId: r.id,
          vmId: r.vm_id,
          rpo: r.rpo,

          networkCompression:
            r.network_compression_enabled,

          quiesce:
            r.quiescing_enabled,

          mpit:
            r.mpit_enabled,

          mpitInstances:
            r.mpit_instances,

          mpitDays:
            r.mpit_days,

          dataSets:
            r.vm_data_sets_replication_enabled,

          autoReplicateNewDisks:
            r.auto_replicate_new_disks_enabled,

          encryption:
            r.encryption_enabled,

          disks:
            disks.map(
              d => ({
                deviceKey:
                  d.vm_disk
                    ?.device_key,

                isVmHome:
                  d.vm_disk
                    ?.is_vm_home,

                enabled:
                  d.replicated,

                datastoreId:
                  d.destination_path
                    ?.datastore_id,

                storagePolicyId:
                  d.destination_storage_policy_id ??
                  null
              })
            )
        }
      };
    }
  );
}
function availableActions(
  rep,
  source,
  schema
) {
  if (
    rep.source_vc_id !== source
  ) {
    return [];
  }

  if (
    rep.configuration_state !==
    'OK'
  ) {
    return [
      'unconfigure'
    ].filter(
      a =>
        schema.paths[
          `/pairings/{pairing_id}/replications/{replication_id}/actions/${a}`
        ]?.post ||

        schema.paths[
          '/pairings/{pairing_id}/replications/{replication_id}'
        ]?.delete
    );
  }

  // Semantics aligned with VMware SRM / vSphere Replication:
  // - NOT_ACTIVE (powered off): supports pause, sync, reconfigure, unconfigure (Offline sync).
  // - PAUSED: supports resume, reconfigure, unconfigure. No pause or sync.
  // - OK / RPO_VIOLATION: supports pause, sync, reconfigure, unconfigure.
  const status =
    rep.status?.status;

  let actions = [];

  if (status === 'PAUSED') {
    actions = [
      'resume',
      'reconfigure',
      'unconfigure'
    ];
  } else if (
    status === 'NOT_ACTIVE' ||
    status ===
      'NOT_ACTIVE_RPO_VIOLATION'
  ) {
    actions = [
      'pause',
      'sync',
      'reconfigure',
      'unconfigure'
    ];
  } else if (
    status === 'OK' ||
    status === 'RPO_VIOLATION'
  ) {
    actions = [
      'pause',
      'sync',
      'reconfigure',
      'unconfigure'
    ];
  } else {
    actions = [
      'unconfigure'
    ];
  }

  return actions.filter(
    a =>
      schema.paths[
        `/pairings/{pairing_id}/replications/{replication_id}/actions/${a}`
      ]?.post ||

      (
        a === 'unconfigure' &&

        schema.paths[
          '/pairings/{pairing_id}/replications/{replication_id}'
        ]?.delete
      )
  );
}

async function getManageableReplications(
  pairId
) {
  return withPair(
    pairId,
    async x => {
      const [
        items,
        schema
      ] = await Promise.all([
        adapter.list(
          x.c,
          x.session,
          `${x.root}/replications`,
          {
            extended_info: true
          }
        ),

        adapter.contract(
          x.c,
          x.session
        )
      ]);

      return items
        .filter(
          r =>
            r.source_vc_id ===
            x.source
        )
        .map(
          r => ({
            replicationId: r.id,
            vmId: r.vm_id,
            vmName: r.name,

            sourceVcenterId:
              r.source_vc_id,

            targetVcenterId:
              r.target_vc_id,

            rpo: r.rpo,

            status:
              r.status?.status,

            actions:
              availableActions(
                r,
                x.source,
                schema
              )
          })
        );
    }
  );
}
async function submit(
  pairId,
  operation,
  input,
  user,
  requestId
) {
  const {
    validateInput,
    validateRemoveOptions,
    buildConfigureReplicationSpec
  } = require(
    './vr-replication-spec.service'
  );

  const tasks =
    require(
      '../repositories/vr-management.repository'
    );

  validateInput(input);

  if (
    ![
      'ADMIN',
      'OPERATOR'
    ].includes(user?.role) ||

    (
      operation ===
        'unconfigure' &&
      user.role !== 'ADMIN'
    )
  ) {
    throw new ManagementError(
      'FORBIDDEN_ERROR',
      'FORBIDDEN',
      403
    );
  }

  if (
    operation === 'unconfigure'
  ) {
    validateRemoveOptions(input);
  }

  return (
    module.exports.withPair ||
    withPair
  )(
    pairId,
    async x => {
      let spec;
      let schema;

      if (
        operation === 'configure'
      ) {
        const suitable =
          await adapter.list(
            x.c,
            x.session,

            `${x.root}/vcenters/${segment(
              x.source
            )}/vms`,

            {
              suitable_for_replication:
                true
            }
          );

        if (
          !suitable.some(
            v =>
              v.id === input.vmId
          )
        ) {
          throw new ManagementError(
            'VALIDATION_ERROR',
            'VM_NOT_SUITABLE',
            400
          );
        }

        const config =
          await configuration(
            x,
            input.vmId
          );

        schema = config.schema;

        spec =
          buildConfigureReplicationSpec(
            input,
            config
          );
      } else {
        schema =
          await adapter.contract(
            x.c,
            x.session
          );

        const {
          data: rep
        } = await adapter.request(
          x.c,
          x.session,
          'GET',

          `${x.root}/replications/${segment(
            input.replicationId
          )}`,

          undefined,

          {
            extended_info: true
          }
        );

        const forceRemove =
          operation ===
            'unconfigure' &&
          input.stopMode === 'force';

        const allowed =
          forceRemove
            ? Boolean(
                schema.paths[
                  '/pairings/{pairing_id}/replications/{replication_id}'
                ]?.delete
              )
            : availableActions(
                rep,
                x.source,
                schema
              ).includes(operation);

        if (
          rep.id !==
            input.replicationId ||

          rep.vm_id !==
            input.vmId ||

          rep.source_vc_id !==
            x.source ||

          rep.target_vc_id !==
            x.target ||

          !allowed
        ) {
          throw new ManagementError(
            'VALIDATION_ERROR',
            'VR_ACTION_UNAVAILABLE',
            409
          );
        }

        if (
          operation ===
          'reconfigure'
        ) {
          const config =
            await configuration(
              x,
              input.vmId
            );

          if (
            config.capability
              .reconfigure_vm_disks_supported !==
            true
          ) {
            throw new ManagementError(
              'VALIDATION_ERROR',
              'RECONFIGURE_NOT_SUPPORTED',
              400
            );
          }

          spec =
            buildConfigureReplicationSpec(
              input,
              config,
              true
            );
        }
      }

      if (
        operation === 'configure' &&
        !schema.paths[
          '/pairings/{pairing_id}/replications'
        ]?.post
      ) {
        throw fail(
          'CONFIGURE_NOT_SUPPORTED'
        );
      }

      const id =
        await tasks.reserve(
          x,
          operation,
          input,
          user,
          requestId
        );

      console.log(
        `[VR Operation Submit] ${operation.toUpperCase()} initiated:`,
        {
          action: operation,

          replicationId:
            input.replicationId ||
            null,

          pairingId:
            x.stored.pairing_id,

          sourceSite:
            x.sourceName,

          targetSite:
            x.targetName,

          vmId:
            input.vmId,

          user:
            user?.username
        }
      );

      let task;

      try {
        task =
          await adapter.operate(
            x.c,
            x.session,
            x.stored.pairing_id,
            operation,
            input.replicationId,
            spec,
            {
              stopMode:
                input.stopMode,

              retainReplicaDisks:
                input.retainReplicaDisks
            }
          );

        console.log(
          `[VR Operation Task] ${operation.toUpperCase()} task received:`,
          {
            action: operation,

            replicationId:
              input.replicationId ||
              null,

            pairingId:
              x.stored.pairing_id,

            sourceSite:
              x.sourceName,

            targetSite:
              x.targetName,

            taskId:
              task.taskId,

            status:
              task.status
          }
        );
      } catch (error) {
        console.error(
          `[VR Operation Error] ${operation.toUpperCase()} failed:`,
          {
            action: operation,

            replicationId:
              input.replicationId ||
              null,

            pairingId:
              x.stored.pairing_id,

            sourceSite:
              x.sourceName,

            targetSite:
              x.targetName,

            errorCode:
              error.code,

            httpStatus:
              error.httpStatus ||
              500
          }
        );

        // Transport or parser failure after submission has an unknown outcome: never automatically resubmit.
        const definite = [
          'VR_HTTP_400',
          'VR_HTTP_401',
          'VR_HTTP_403',
          'VR_HTTP_404'
        ].includes(error.code);

        await tasks.update(
          id,
          {},
          definite
            ? 'FAILED'
            : 'UNKNOWN'
        );

        error.operationId = id;

        throw error;
      }

      const result =
        await tasks.update(
          id,
          task,

          task.status === 'SUCCESS'
            ? 'REFRESH_PENDING'
            : task.status,

          task.status === 'SUCCESS'
            ? 'PENDING'
            : 'NOT_STARTED'
        );

      return result;
    }
  );
}

module.exports = {
  withPair,
  getPairs,
  getSuitableVms,
  configuration,
  getConfiguration,
  getCurrentConfiguration,
  availableActions,
  getManageableReplications,
  submit
};