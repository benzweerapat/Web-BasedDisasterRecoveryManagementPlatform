const {
  ManagementError,
  fail
} = require(
  '../adapters/vmware/vr-management.adapter'
);

const invalid = code => {
  throw new ManagementError(
    'VALIDATION_ERROR',
    code,
    400
  );
};

// VR 9.x retention limit: Broadcom KB 393015. Schema fields verified on 9.0.2.
function settingsContract(
  schema,
  capability = {}
) {
  const create =
    schema?.components?.schemas
      ?.ConfigureReplicationSpec
      ?.properties || {};

  const edit =
    schema?.components?.schemas
      ?.ReconfigureReplicationSpec
      ?.properties || {};

  const has = field =>
    create[field]?.type === edit[field]?.type &&
    Boolean(create[field]);

  return {
    mpitSupported:
      capability.mpit_supported === true &&
      [
        'mpit_enabled',
        'mpit_instances',
        'mpit_days'
      ].every(has),

    mpitMaxTotal: 24,

    dataSetsExposed:
      has('vm_data_sets_replication_enabled'),

    encryptionRequired:
      capability.vm_encrypted === true,

    dataSetsCapability:
      'NOT_PROVIDED_BY_VM_CAPABILITY'
  };
}

function mapSettings(
  input,
  config,
  spec
) {
  const contract = settingsContract(
    config.schema,
    config.capability
  );

  if (typeof input.mpit !== 'boolean') {
    invalid('INVALID_MPIT');
  }

  if (
    contract.encryptionRequired &&
    input.encryption !== true
  ) {
    invalid('ENCRYPTION_REQUIRED');
  }

  spec.mpit_enabled = input.mpit;

  if (input.mpit) {
    if (!contract.mpitSupported) {
      invalid('MPIT_UNSUPPORTED');
    }

    if (
      !Number.isInteger(input.mpitInstances) ||
      !Number.isInteger(input.mpitDays) ||
      input.mpitInstances < 1 ||
      input.mpitDays < 1 ||
      input.mpitInstances * input.mpitDays >
        contract.mpitMaxTotal
    ) {
      invalid('INVALID_MPIT_RETENTION');
    }

    spec.mpit_instances =
      input.mpitInstances;

    spec.mpit_days =
      input.mpitDays;
  }

  if (input.dataSets !== undefined) {
    if (!contract.dataSetsExposed) {
      throw fail('DATASETS_NOT_EXPOSED');
    }

    if (typeof input.dataSets !== 'boolean') {
      invalid('INVALID_DATASETS');
    }

    // This is a real exposed configure field. VMware retains final capability validation.
    spec.vm_data_sets_replication_enabled =
      input.dataSets;
  }

  return spec;
}

module.exports = {
  settingsContract,
  mapSettings
};