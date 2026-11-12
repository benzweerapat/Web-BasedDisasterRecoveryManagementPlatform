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

const allowedKeys = new Set([
  'pairId',
  'vmId',
  'replicationId',
  'rpo',
  'disks',
  'networkCompression',
  'quiesce',
  'mpit',
  'mpitInstances',
  'mpitDays',
  'dataSets',
  'autoReplicateNewDisks',
  'encryption',
  'confirmed',
  'stopMode',
  'retainReplicaDisks'
]);

function validateInput(input) {
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input)
  ) {
    invalid('INVALID_CONFIGURATION');
  }

  if (
    Object.keys(input).some(
      key => !allowedKeys.has(key)
    )
  ) {
    invalid('UNSUPPORTED_CONFIGURATION_FIELD');
  }

  if (input.confirmed !== true) {
    invalid('CONFIRMATION_REQUIRED');
  }
}

function validateRemoveOptions(input) {
  // Removal choices must be explicit; omitted/malformed retention must never imply disk deletion.
  if (
    !input ||
    typeof input !== 'object' ||
    typeof input.retainReplicaDisks !==
      'boolean'
  ) {
    invalid('INVALID_REMOVE_OPTIONS');
  }

  const {
    stopMode,
    retainReplicaDisks
  } = input;

  if (
    !['graceful', 'force']
      .includes(stopMode)
  ) {
    invalid('INVALID_STOP_MODE');
  }

  return {
    stopMode,
    retainReplicaDisks
  };
}

function buildConfigureReplicationSpec(
  input,
  config,
  reconfigure = false
) {
  validateInput(input);

  if (input.vmId !== config.vmId) {
    invalid('INVALID_VM_ID');
  }

  if (
    !Number.isInteger(input.rpo) ||
    input.rpo < config.rpo.min ||
    input.rpo > config.rpo.max
  ) {
    invalid('INVALID_RPO');
  }

  const capability = config.capability;

  if (
    !(
      reconfigure
        ? ['OK', 'ALREADY_CONFIGURED']
        : ['OK']
    ).includes(
      capability.vm_validation_status
    )
  ) {
    invalid('VM_NOT_SUITABLE');
  }

  const bool = (
    key,
    capabilityKey
  ) => {
    if (typeof input[key] !== 'boolean') {
      invalid('INVALID_REPLICATION_OPTION');
    }

    if (
      input[key] &&
      capability[capabilityKey] !== true
    ) {
      invalid(
        'UNSUPPORTED_REPLICATION_OPTION'
      );
    }

    return input[key];
  };

  if (
    !Array.isArray(input.disks) ||
    input.disks.length !== config.disks.length
  ) {
    invalid('INVALID_DISK_SELECTION');
  }

  const seen = new Set();

  const disks = input.disks.map(
    selection => {
      if (
        !selection ||
        Object.keys(selection).some(
          k =>
            ![
              'deviceKey',
              'isVmHome',
              'enabled',
              'datastoreId',
              'storagePolicyId'
            ].includes(k)
        )
      ) {
        invalid('INVALID_DISK_SELECTION');
      }

      const key =
        `${selection.deviceKey}:${selection.isVmHome}`;

      if (
        seen.has(key) ||
        !Number.isInteger(
          selection.deviceKey
        ) ||
        typeof selection.isVmHome !==
          'boolean'
      ) {
        invalid('INVALID_DISK_ID');
      }

      seen.add(key);

      const disk = config.disks.find(
        d =>
          d.vm_id === input.vmId &&
          d.device_key ===
            selection.deviceKey &&
          d.is_vm_home ===
            selection.isVmHome
      );

      if (
        !disk ||
        typeof selection.enabled !==
          'boolean'
      ) {
        invalid('INVALID_DISK_ID');
      }

      // VM-home entry is required by the API even though it is not a replicatable data disk.
      if (
        selection.enabled &&
        !disk.is_vm_home &&
        disk.supported_for_replication !==
          true
      ) {
        invalid('DISK_NOT_SUPPORTED');
      }

      const datastore =
        config.datastores.find(
          d =>
            d.id ===
            selection.datastoreId
        );

      if (
        !datastore ||
        datastore.accessible !== true ||
        datastore.maintenance_mode !==
          'normal'
      ) {
        invalid(
          'INVALID_TARGET_DATASTORE'
        );
      }

      if (
        selection.storagePolicyId !== null &&
        !config.policies.some(
          p =>
            p.storage_policy_id ===
            selection.storagePolicyId
        )
      ) {
        invalid(
          'INVALID_STORAGE_POLICY'
        );
      }

      return {
        vm_disk: disk,
        enabled_for_replication:
          selection.enabled,
        use_seeds: false,
        destination_datastore_id:
          datastore.id,
        destination_storage_policy_id:
          selection.storagePolicyId,
        destination_path: null,
        destination_disk_format:
          'SAME_AS_SOURCE'
      };
    }
  );

  if (
    !disks.some(
      d =>
        !d.vm_disk.is_vm_home &&
        d.enabled_for_replication
    )
  ) {
    invalid('NO_DATA_DISKS_SELECTED');
  }

  if (
    !disks.some(
      d =>
        d.vm_disk.is_vm_home &&
        d.enabled_for_replication
    )
  ) {
    invalid('VM_HOME_REQUIRED');
  }

  const spec = {
    rpo: input.rpo,
    disks,
    mpit_enabled: false,

    network_compression_enabled:
      bool(
        'networkCompression',
        'network_compression_supported'
      ),

    quiesce_enabled:
      bool(
        'quiesce',
        'quiescing_supported'
      ),

    auto_replicate_new_disks:
      bool(
        'autoReplicateNewDisks',
        'auto_replicate_new_disks_supported'
      ),

    lwd_encryption_enabled:
      bool(
        'encryption',
        'lwd_encryption_supported'
      )
  };

  if (!reconfigure) {
    Object.assign(spec, {
      vm_id: input.vmId,
      target_vc_id:
        config.targetVcenterId
    });
  }

  require('./vr-settings.service')
    .mapSettings(
      input,
      config,
      spec
    );

  const schema =
    config.schema.components.schemas[
      reconfigure
        ? 'ReconfigureReplicationSpec'
        : 'ConfigureReplicationSpec'
    ];

  if (
    !schema ||
    schema.required?.some(
      k => !(k in spec)
    ) ||
    Object.keys(spec).some(
      k => !schema.properties[k]
    )
  ) {
    throw fail(
      'VR_SPEC_VERSION_NOT_SUPPORTED'
    );
  }

  const formatEnum =
    config.schema.components.schemas
      .ConfigureReplicationVmDisk
      .properties
      .destination_disk_format
      .enum;

  if (
    !formatEnum.includes('SAME_AS_SOURCE')
  ) {
    throw fail(
      'VR_DISK_FORMAT_CONTRACT'
    );
  }

  return spec;
}

module.exports = {
  buildConfigureReplicationSpec,
  validateInput,
  validateRemoveOptions
};