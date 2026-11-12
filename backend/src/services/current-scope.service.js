// Only flags change; history, issue descriptions and observation timestamps remain intact.
// Read views already exclude orphans even before reconciliation runs.
const children = {
  VR: [
    'vr_replications',
    'vr_pairing_issues',
    'vr_replication_issues',
    'vr_management_servers',
    'vr_replication_servers'
  ],

  SRM: [
    'srm_protection_groups',
    'srm_recovery_plans',
    'srm_protected_vms',
    'srm_recovery_plan_groups',
    'srm_recovery_plan_vms',
    'srm_inventory_mappings',
    'srm_placeholder_datastores',
    'srm_issues',
    'srm_servers',
    'srm_tasks'
  ]
};

async function reconcileCurrentChildren(
  client,
  systemType,
  connectionId
) {
  if (!children[systemType]) {
    throw new Error('Unsupported current scope');
  }

  const counts = {};

  for (const table of children[systemType]) {
    const flag = table.endsWith('_tasks')
      ? 'is_recent'
      : 'is_present';

    const result = await client.run(
      s => {
        const ids = new Set(
          s.read('current_' + table)
            .map(r => r.id)
        );

        return s.helpers.changed(
          s.update(
            table,

            r =>
              r.connection_id ===
                Number(connectionId) &&
              r[flag] === true &&
              !ids.has(r.id),

            () => ({
              [flag]: false
            })
          ).length
        );
      },
      [],
      true
    );

    counts[table] = result.rowCount;
  }

  return counts;
}

module.exports = {
  reconcileCurrentChildren
};