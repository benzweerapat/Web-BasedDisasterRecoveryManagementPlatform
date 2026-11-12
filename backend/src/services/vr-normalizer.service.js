const crypto = require('crypto');

class VRNormalizerService {
  normalizeInteger(
    value,
    objectKeys = []
  ) {
    let candidate = value;

    if (
      candidate &&
      typeof candidate === 'object' &&
      !Array.isArray(candidate)
    ) {
      candidate = objectKeys
        .map(key => candidate[key])
        .find(
          item =>
            item !== undefined &&
            item !== null
        );
    }

    if (
      candidate === '' ||
      candidate === null ||
      candidate === undefined ||
      typeof candidate === 'boolean'
    ) {
      return null;
    }

    const numeric = Number(candidate);

    return Number.isFinite(numeric)
      ? Math.trunc(numeric)
      : null;
  }

  normalizeRpoMinutes(value) {
    return this.normalizeInteger(
      value,
      [
        'minutes',
        'rpo',
        'value'
      ]
    );
  }

  normalizeRpoViolation(value) {
    if (typeof value === 'boolean') {
      return value ? 1 : 0;
    }

    if (
      typeof value === 'string' &&
      ['true', 'false'].includes(
        value.toLowerCase()
      )
    ) {
      return value.toLowerCase() ===
        'true'
        ? 1
        : 0;
    }

    return this.normalizeInteger(
      value,
      [
        'count',
        'violations',
        'value'
      ]
    );
  }

  normalizeSyncProgress(value) {
    const progress =
      this.normalizeInteger(
        value,
        [
          'progress',
          'percent',
          'percentage',
          'value'
        ]
      );

    return progress !== null &&
      progress >= 0 &&
      progress <= 100
      ? progress
      : null;
  }

  normalizeBoolean(value) {
    if (typeof value === 'boolean') {
      return value;
    }

    if (
      typeof value === 'string' &&
      ['true', 'false'].includes(
        value.toLowerCase()
      )
    ) {
      return value.toLowerCase() ===
        'true';
    }

    return null;
  }

  summarizeReplicationDisks(disks) {
    const rows =
      Array.isArray(disks)
        ? disks
        : [];

    const virtualDisks = rows.filter(
      row =>
        row?.vm_disk?.is_vm_home !==
        true
    );

    const uniqueStrings = values => [
      ...new Set(
        values
          .filter(
            value =>
              typeof value ===
                'string' &&
              value.trim()
          )
          .map(
            value => value.trim()
          )
      )
    ];

    const sumNonNegative = values =>
      values.reduce(
        (sum, value) => {
          const numeric =
            Number(value);

          return Number.isFinite(
            numeric
          ) &&
            numeric >= 0
            ? sum + numeric
            : sum;
        },
        0
      );

    return {
      apiEntryCount: rows.length,

      disks: rows.map(row => ({
        deviceKey:
          row?.vm_disk?.device_key ??
          null,

        isVmHome:
          row?.vm_disk?.is_vm_home ===
          true,

        label:
          row?.vm_disk?.label || null,

        datastoreName:
          row?.destination_path
            ?.datastore_name ||
          null,

        storagePolicyName:
          row?.destination_storage_policy_name ||
          null,

        replicated:
          row?.replicated ?? null
      })),

      configuredDiskCount:
        virtualDisks.length,

      replicatedDiskCount:
        virtualDisks.filter(
          row =>
            row?.replicated === true
        ).length,

      vmHomeReplicated:
        rows.some(
          row =>
            row?.vm_disk
              ?.is_vm_home === true &&
            row?.replicated === true
        ),

      sourceDatastores:
        uniqueStrings(
          rows.map(
            row =>
              row?.vm_disk
                ?.source_path
                ?.datastore_name
          )
        ),

      destinationDatastores:
        uniqueStrings(
          rows.map(
            row =>
              row?.destination_path
                ?.datastore_name
          )
        ),

      sourceStoragePolicies:
        uniqueStrings(
          rows.map(
            row =>
              row?.vm_disk
                ?.source_storage_policy_name
          )
        ),

      destinationStoragePolicies:
        uniqueStrings(
          rows.map(
            row =>
              row?.destination_storage_policy_name
          )
        ),

      replicaDiskUsageBytes:
        sumNonNegative(
          rows.map(
            row =>
              row?.replica_disk_usage
          )
        ),

      configuredDiskCapacityBytes:
        sumNonNegative(
          virtualDisks.map(
            row =>
              row?.vm_disk?.capacity
          )
        )
    };
  }

  computeCanonicalKey(
    pairingId,
    sourceVcId,
    targetVcId,
    vmId,
    replicationId
  ) {
    if (
      !sourceVcId ||
      !targetVcId ||
      !vmId
    ) {
      return {
        key: null,
        status: 'INSUFFICIENT',
        version: 2
      };
    }

    const raw = JSON.stringify([
      "v2",
      sourceVcId,
      targetVcId,
      vmId
    ]);

    const hash = crypto
      .createHash('sha256')
      .update(raw)
      .digest('hex');

    return {
      key: hash,
      status: 'COMPLETE',
      version: 2
    };
  }

  normalizeDirection(
    replication,
    localVcenterId
  ) {
    if (!replication) {
      return 'UNKNOWN';
    }

    // In a replication object, source_vc_id or target_vc_id are usually given
    const {
      source_vc_id,
      target_vc_id
    } = replication;

    if (!localVcenterId) {
      return 'UNKNOWN';
    }

    if (
      source_vc_id ===
        localVcenterId &&
      target_vc_id !==
        localVcenterId
    ) {
      return 'OUTGOING';
    }

    if (
      target_vc_id ===
        localVcenterId &&
      source_vc_id !==
        localVcenterId
    ) {
      return 'INCOMING';
    }

    if (
      source_vc_id ===
        localVcenterId &&
      target_vc_id ===
        localVcenterId
    ) {
      // Loopback replication? Usually classified as OUTGOING or INCOMING depending on context,
      // but if we can't distinguish, default to UNKNOWN or handle specifically.
      // Often in VR, a loopback is marked as OUTGOING from source perspective.
      // For now, if both match, it's ambiguous without more context, but let's fall back to UNKNOWN or we could use 'LOCAL'.
      // The prompt says INCOMING, OUTGOING, UNKNOWN.
      return 'UNKNOWN';
    }

    return 'UNKNOWN';
  }

  normalizeStatus(rawStatus) {
    // "OK", "RECOVERED", "ERROR", "NOT_ACTIVE" etc.
    if (!rawStatus) {
      return 'UNKNOWN';
    }

    const s =
      rawStatus.toUpperCase();

    if (s === 'OK') {
      return 'OK';
    }

    if (s === 'RECOVERED') {
      return 'RECOVERED';
    }

    if (
      s.includes('ERROR') ||
      s.includes('VIOLATION')
    ) {
      return 'ERROR';
    }

    if (s.includes('SYNC')) {
      return 'SYNCING';
    }

    return s;
  }
}

module.exports =
  new VRNormalizerService();