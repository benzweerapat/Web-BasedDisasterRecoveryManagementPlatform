const {
  pool
} = require('../../db');

class SrmRepository {
  async getSyncState(
    connectionId,
    client = pool
  ) {
    return await client.run(
      s =>
        s.read('srm_sync_state')
          .find(
            r =>
              r.connection_id ===
              Number(connectionId)
          ) ||
        null
    );
  }

  async upsertSyncState(
    connectionId,
    state,
    client = pool
  ) {
    if (!Object.keys(state).length) {
      return;
    }

    return client.run(
      s =>
        s.insert(
          'srm_sync_state',
          [{
            connection_id:
              Number(connectionId),
            ...state
          }],
          {
            key:
              r => r.connection_id,

            change:
              (_, row) => ({
                ...row,
                updated_at: s.now()
              })
          }
        ),
      [],
      true
    );
  }

  async upsertScope(
    tableName,
    uniqueCols,
    rows,
    client = pool
  ) {
    if (!rows?.length) {
      return;
    }

    return client.run(
      s =>
        s.insert(
          tableName,

          rows.map(
            row => ({
              ...row,
              last_seen_at: s.now()
            })
          ),

          {
            key:
              r =>
                uniqueCols.map(
                  k => r[k] ?? null
                ),

            change:
              (_, r) => ({
                ...r,
                updated_at: s.now()
              })
          }
        ),
      [],
      true
    );
  }

  async upsertExpressionScope(
    tableName,
    _legacyKey,
    rows,
    client = pool
  ) {
    const keys = {
      srm_inventory_mappings: [
        'connection_id',
        'pairing_id',
        'srm_id',
        'mapping_id'
      ],

      srm_placeholder_datastores: [
        'connection_id',
        'pairing_id',
        'srm_id',
        'placeholder_datastore_id'
      ],

      srm_issues: [
        'connection_id',
        'pairing_id',
        'issue_fingerprint'
      ]
    }[tableName];

    if (!keys) {
      throw Error(
        'Unknown SRM scope'
      );
    }

    if (!rows?.length) {
      return;
    }

    return client.run(
      s =>
        s.insert(
          tableName,

          rows.map(
            row => ({
              ...row,
              last_seen_at: s.now()
            })
          ),

          {
            key:
              r =>
                keys.map(
                  k => r[k] ?? ''
                ),

            change:
              (_, r) => ({
                ...r,
                is_present: true,
                updated_at: s.now()
              })
          }
        ),
      [],
      true
    );
  }

  async markMissingNotPresent(
    tableName,
    connectionId,
    runId,
    client = pool
  ) {
    return client.run(
      s =>
        s.update(
          tableName,

          r =>
            r.connection_id ===
              Number(connectionId) &&
            r.sync_run_id !== runId &&
            r.is_present === true,

          () => ({
            is_present: false,
            updated_at: s.now()
          })
        ),
      [],
      true
    );
  }

  async markMissingPlanChildren(
    tableName,
    connectionId,
    runId,
    scopes,
    client = pool
  ) {
    if (
      ![
        'srm_recovery_plan_groups',
        'srm_recovery_plan_vms'
      ].includes(tableName)
    ) {
      throw Error(
        'Unknown plan child scope'
      );
    }

    if (!scopes?.length) {
      return;
    }

    const fetched = new Set(
      scopes.map(
        row =>
          JSON.stringify([
            row.pairingId,
            row.planId
          ])
      )
    );

    return client.run(
      s =>
        s.update(
          tableName,

          row =>
            row.connection_id ===
              Number(connectionId) &&
            row.sync_run_id !== runId &&
            row.is_present === true &&
            fetched.has(
              JSON.stringify([
                row.pairing_id,
                row.recovery_plan_id
              ])
            ),

          () => ({
            is_present: false,
            updated_at: s.now()
          })
        ),
      [],
      true
    );
  }

  async markMissingMappingsNotPresent(
    connectionId,
    runId,
    types,
    client = pool
  ) {
    if (!types?.length) {
      return;
    }

    return client.run(
      s =>
        s.update(
          'srm_inventory_mappings',

          r =>
            r.connection_id ===
              Number(connectionId) &&
            r.sync_run_id !== runId &&
            r.is_present === true &&
            types.includes(
              r.mapping_type
            ),

          () => ({
            is_present: false,
            updated_at: s.now()
          })
        ),
      [],
      true
    );
  }
}

module.exports =
  new SrmRepository();