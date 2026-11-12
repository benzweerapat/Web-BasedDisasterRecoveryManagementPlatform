const {
  redact
} = require(
  '../utils/redact.util'
);

function safeDiagnosticText(value) {
  if (
    value === null ||
    value === undefined ||
    value === ''
  ) {
    return '';
  }

  let text;

  if (typeof value === 'string') {
    text = value;
  } else if (
    value instanceof Error
  ) {
    text =
      value.message ||
      value.name ||
      'Error';
  } else {
    try {
      text =
        JSON.stringify(
          redact(value)
        );
    } catch {
      text = String(value);
    }
  }

  return String(text || '')
    .replace(
      /\b(password|passwd|pwd|session(?:_id)?|token)\s*[=:]\s*[^\s&;,}"']+/gi,
      '$1=[REDACTED]'
    )
    .replace(
      /\bauthorization\s*:\s*(?:basic|bearer)?\s*[^\s,;}"']+/gi,
      'authorization: [REDACTED]'
    );
}

function normalizeSrmObjectStatus(
  value
) {
  if (
    value === null ||
    value === undefined ||
    value === ''
  ) {
    return 'UNKNOWN';
  }

  const candidate =
    typeof value === 'object'
      ? (
          value.status ??
          value.state ??
          value.value
        )
      : value;

  if (
    candidate === null ||
    candidate === undefined ||
    candidate === ''
  ) {
    return 'UNKNOWN';
  }

  return String(candidate)
    .trim()
    .replace(
      /[\s-]+/g,
      '_'
    )
    .toUpperCase();
}

function parseVmwareTimestamp(
  value
) {
  if (
    value === null ||
    value === undefined ||
    value === ''
  ) {
    return null;
  }

  const numericValue =
    typeof value === 'string' &&
    /^\d+$/.test(value.trim())
      ? Number(value)
      : value;

  const parsed =
    new Date(numericValue);

  return Number.isNaN(
    parsed.getTime()
  )
    ? null
    : parsed;
}

function parseVmwareEntity(value) {
  if (typeof value !== 'string') {
    return {
      entityType: null,
      entityId: null
    };
  }

  const [
    entityType,
    entityId
  ] = value.split(':');

  return {
    entityType:
      entityType || null,

    entityId:
      entityId || null
  };
}

class SrmNormalizerService {
  normalizeSitePairs(
    connectionId,
    rawSitePairs,
    runId
  ) {
    if (!rawSitePairs) {
      return [];
    }

    return rawSitePairs.map(
      sp => {
        let localVcenterId =
          sp.local_vc_server
            ? sp.local_vc_server.id
            : null;

        let remoteVcenterId =
          sp.remote_vc_server
            ? sp.remote_vc_server.id
            : null;

        const vcenterIds = [
          localVcenterId,
          remoteVcenterId
        ]
          .filter(Boolean)
          .sort();

        let canonicalKey = null;

        let canonicalStatus =
          'INSUFFICIENT';

        if (
          vcenterIds.length === 2
        ) {
          canonicalKey =
            `srm-site-pair-v1-${vcenterIds[0]}-${vcenterIds[1]}`;

          canonicalStatus =
            'COMPLETE';
        }

        return {
          connection_id:
            connectionId,

          pairing_id:
            sp.pairing_id ||
            sp.id,

          canonical_site_pair_key:
            canonicalKey,

          canonical_key_version: 1,

          canonical_identity_status:
            canonicalStatus,

          local_site_name:
            sp.local_srm_server
              ? sp.local_srm_server.name
              : null,

          remote_site_name:
            sp.remote_srm_server
              ? sp.remote_srm_server.name
              : null,

          local_vcenter_id:
            localVcenterId,

          remote_vcenter_id:
            remoteVcenterId,

          pairing_status:
            sp.local_srm_server
              ? sp.local_srm_server
                  .server_status
              : null,

          is_present: true,
          sync_run_id: runId
        };
      }
    );
  }

  normalizeSrmServers(
    connectionId,
    pairingId,
    rawServers,
    runId
  ) {
    if (!rawServers) {
      return [];
    }

    return rawServers.map(
      s => {
        // Build an extended address object if discovered fields exist
        let addressData =
          s.address;

        if (
          s._discovered_api_host
        ) {
          addressData =
            JSON.stringify({
              original:
                s.address,

              apiEndpointHost:
                s._discovered_api_host,

              apiEndpointHostType:
                s._discovered_api_host_type,

              applianceIp:
                s._discovered_appliance_ip
            });
        }

        return {
          connection_id:
            connectionId,

          pairing_id:
            pairingId,

          srm_id:
            s.id,

          name:
            s.name,

          server_scope:
            'MANAGEMENT_SERVER',

          address:
            addressData,

          version:
            s.version,

          vcenter_external_id:
            s.vcenter_id,

          is_present: true,
          sync_run_id: runId
        };
      }
    );
  }
    normalizeProtectionGroups(
    connectionId,
    pairingId,
    rawPgs,
    runId
  ) {
    if (!rawPgs) {
      return [];
    }

    return rawPgs.map(
      pg => {
        const status =
          normalizeSrmObjectStatus(
            pg.status ??
            pg.state
          );

        const recoveryStatus =
          normalizeSrmObjectStatus(
            pg.recovery_status ??
            pg.recoveryStatus
          );

        return {
          connection_id:
            connectionId,

          pairing_id:
            pairingId,

          protection_group_id:
            pg.id,

          name:
            pg.name,

          group_type:
            pg.replication_type ??
            pg.replicationType ??
            pg.type,

          description:
            pg.description,

          raw_status:
            status,

          normalized_status:
            status,

          raw_recovery_status:
            recoveryStatus,

          normalized_recovery_status:
            recoveryStatus,

          source_site_name:
            pg.protected_site_name ??
            pg.protectedSiteName ??
            null,

          target_site_name:
            pg.recovery_site_name ??
            pg.recoverySiteName ??
            null,

          source_vcenter_id:
            pg.protected_vc_guid ??
            pg.protectedVcenterId ??
            null,

          target_vcenter_id:
            pg.recovery_vc_guid ??
            pg.recoveryVcenterId ??
            null,

          is_present: true,
          last_seen_at: new Date(),
          sync_run_id: runId
        };
      }
    );
  }

  normalizeProtectedVms(
    connectionId,
    pairingId,
    protectionGroupId,
    rawVms,
    runId
  ) {
    if (!rawVms) {
      return [];
    }

    return rawVms.map(
      vm => {
        const protectedVmId =
          vm.id ??
          vm.protected_vm_id ??
          vm.protectedVmId ??
          vm.vm_id ??
          vm.vmId;

        const sourceVmId =
          vm.moid ??
          vm.vcenter_mo_id ??
          vm.source_vm_id ??
          vm.sourceVmId ??
          vm.vm_moid ??
          vm.vmMoid;

        const protectionStatus =
          normalizeSrmObjectStatus(
            vm.protection_status_details
              ?.status ??
            vm.status ??
            vm.protection_status ??
            vm.protectionStatus ??
            vm.protection_state ??
            vm.protectionState ??
            vm.state
          );

        return {
          connection_id:
            connectionId,

          pairing_id:
            pairingId,

          protection_group_id:
            protectionGroupId,

          protected_vm_id:
            protectedVmId,

          source_vm_id:
            sourceVmId,

          vm_name:
            vm.name ??
            vm.vm_name ??
            vm.vmName,

          raw_protection_status:
            protectionStatus,

          normalized_protection_status:
            protectionStatus,

          recovery_location_status:
            normalizeSrmObjectStatus(
              vm.recovery_location_status ??
              vm.recoveryLocationStatus
            ),

          issue_count:
            vm.issue_count ??
            vm.issueCount ??
            vm.protection_error_count ??
            vm.protectionErrorCount ??
            0,

          is_present: true,
          sync_run_id: runId
        };
      }
    );
  }

  normalizeRecoveryPlans(
    connectionId,
    pairingId,
    rawPlans,
    runId
  ) {
    if (!rawPlans) {
      return [];
    }

    return rawPlans.map(
      rp => {
        const status =
          normalizeSrmObjectStatus(
            rp.status ??
            rp.state
          );

        return {
          connection_id:
            connectionId,

          pairing_id:
            pairingId,

          recovery_plan_id:
            rp.id,

          name:
            rp.name,

          description:
            rp.description,

          raw_status:
            status,

          normalized_status:
            status,

          source_site_name:
            rp.protected_site_name ??
            rp.protectedSiteName ??
            null,

          recovery_site_name:
            rp.recovery_site_name ??
            rp.recoverySiteName ??
            null,

          is_present: true,
          last_seen_at: new Date(),
          sync_run_id: runId
        };
      }
    );
  }

  normalizeRecoveryPlanGroups(
    connectionId,
    pairingId,
    recoveryPlanId,
    rawGroups,
    runId
  ) {
    if (!rawGroups) {
      return [];
    }

    return rawGroups.map(
      grp => ({
        connection_id:
          connectionId,

        pairing_id:
          pairingId,

        recovery_plan_id:
          recoveryPlanId,

        protection_group_id:
          grp.id ||
          grp.protection_group_id,

        is_present: true,
        last_seen_at: new Date(),
        sync_run_id: runId
      })
    );
  }

  normalizeRecoveryPlanVms(
    connectionId,
    pairingId,
    recoveryPlanId,
    rawVms,
    runId
  ) {
    if (!rawVms) {
      return [];
    }

    return rawVms.map(
      vm => {
        const recoveryPlanVmId =
          vm.id ??
          vm.recovery_plan_vm_id ??
          vm.recoveryPlanVmId ??
          vm.vm_id ??
          vm.vmId;

        return {
          connection_id:
            connectionId,

          pairing_id:
            pairingId,

          recovery_plan_id:
            recoveryPlanId,

          recovery_plan_vm_id:
            recoveryPlanVmId,

          protected_vm_id:
            vm.protected_vm_id ??
            vm.protectedVmId ??
            null,

          source_vm_id:
            vm.moid ??
            vm.vcenter_mo_id ??
            vm.source_vm_id ??
            vm.sourceVmId ??
            vm.vm_moid ??
            vm.vmMoid ??
            null,

          source_vcenter_external_id:
            vm.source_vcenter_external_id ??
            vm.sourceVcenterExternalId ??
            vm.source_vcenter_id ??
            vm.sourceVcenterId ??
            null,

          inventory_vm_id:
            vm.inventory_vm_id ??
            vm.inventoryVmId ??
            null,

          priority_group:
            vm.priority_group ??
            vm.priorityGroup ??
            vm.priority ??
            null,

          dependency_count:
            vm.dependency_count ??
            vm.dependencyCount ??
            0,

          recovery_settings_status:
            normalizeSrmObjectStatus(
              vm.recovery_settings_status ??
              vm.recoverySettingsStatus
            ),

          ip_customization_status:
            normalizeSrmObjectStatus(
              vm.ip_customization_status ??
              vm.ipCustomizationStatus
            ),

          mapping_status:
            normalizeSrmObjectStatus(
              vm.mapping_status ??
              vm.mappingStatus
            ),

          is_present: true,
          last_seen_at: new Date(),
          sync_run_id: runId
        };
      }
    );
  }
    normalizeRecoverySteps(
    connectionId,
    pairingId,
    recoveryPlanId,
    viewMode,
    rawSteps,
    runId
  ) {
    if (!rawSteps) {
      return [];
    }

    const rows = [];

    let generatedIndex = 0;

    const visit = (
      value,
      fallbackDepth = 0
    ) => {
      const items =
        Array.isArray(value)
          ? value
          : [value];

      items
        .filter(Boolean)
        .forEach(
          step => {
            const nested =
              step.children ??
              step.steps ??
              step.items ??
              null;

            const hasStepFields =
              step.id !== undefined ||
              step.step_id !==
                undefined ||
              step.step_number !==
                undefined ||
              step.title ||
              step.name;

            if (hasStepFields) {
              generatedIndex += 1;

              const stepNumber =
                step.step_number ??
                step.stepNumber ??
                generatedIndex;

              rows.push({
                connection_id:
                  connectionId,

                pairing_id:
                  pairingId,

                recovery_plan_id:
                  recoveryPlanId,

                view_mode:
                  String(
                    viewMode || 'test'
                  ).toLowerCase(),

                step_id:
                  String(
                    step.id ??
                    step.step_id ??
                    step.stepId ??
                    `${viewMode}-${stepNumber}`
                  ),

                step_number:
                  Number.isFinite(
                    Number(stepNumber)
                  )
                    ? Number(stepNumber)
                    : generatedIndex,

                title:
                  step.title ??
                  step.name ??
                  step.description ??
                  `Step ${stepNumber}`,

                raw_status:
                  normalizeSrmObjectStatus(
                    step.status ??
                    step.state
                  ),

                progress:
                  Number.isFinite(
                    Number(
                      step.progress
                    )
                  )
                    ? Number(
                        step.progress
                      )
                    : null,

                start_time:
                  parseVmwareTimestamp(
                    step.start_time ??
                    step.startTime ??
                    step.started_at ??
                    step.startedAt
                  ),

                finish_time:
                  parseVmwareTimestamp(
                    step.finish_time ??
                    step.finishTime ??
                    step.end_time ??
                    step.endTime ??
                    step.completed_at ??
                    step.completedAt
                  ),

                child_count:
                  Number.isFinite(
                    Number(
                      step.child_count ??
                      step.childCount
                    )
                  )
                    ? Number(
                        step.child_count ??
                        step.childCount
                      )
                    : 0,

                depth:
                  Number.isFinite(
                    Number(step.depth)
                  )
                    ? Number(step.depth)
                    : fallbackDepth,

                warnings:
                  Array.isArray(
                    step.warnings
                  )
                    ? step.warnings
                    : [],

                errors:
                  Array.isArray(
                    step.errors
                  )
                    ? step.errors
                    : [],

                referred_object:
                  step.referred_object ??
                  step.referredObject ??
                  null,

                is_present: true,
                sync_run_id: runId
              });
            }

            if (nested) {
              visit(
                nested,

                Number(
                  step.depth ??
                  fallbackDepth
                ) + 1
              );
            }
          }
        );
    };

    visit(rawSteps);

    return rows;
  }

  normalizeIssues(
    connectionId,
    pairingId,
    scope,
    objectId,
    rawIssues,
    runId
  ) {
    if (!rawIssues) {
      return [];
    }

    const crypto =
      require('crypto');

    return rawIssues.map(
      issue => {
        // Remove stack traces or secret leakage if any
        const safeMessage =
          safeDiagnosticText(
            issue.message ||
            issue.description
          );

        let fingerprint =
          issue.id;

        if (!fingerprint) {
          const hash = crypto
            .createHash('sha256')
            .update(
              `${scope}-${objectId}-${safeMessage}`
            )
            .digest('hex');

          fingerprint =
            hash.substring(0, 64);
        }

        return {
          connection_id:
            connectionId,

          pairing_id:
            pairingId,

          issue_scope:
            scope,

          source_entity_id:
            objectId,

          issue_fingerprint:
            fingerprint,

          severity:
            String(
              issue.severity ||
              issue.status ||
              'WARNING'
            ).toUpperCase(),

          issue_type:
            issue.issue_type ||
            null,

          entity_name:
            issue.entity_name ||
            null,

          safe_description:
            safeMessage,

          is_present: true,
          sync_run_id: runId
        };
      }
    );
  }

  normalizeHistory(
    connectionId,
    pairingId,
    recoveryPlanId,
    rawHistory,
    runId
  ) {
    if (!rawHistory) {
      return [];
    }

    return rawHistory.map(
      h => ({
        connection_id:
          connectionId,

        pairing_id:
          pairingId,

        recovery_plan_id:
          recoveryPlanId,

        history_id:
          h.run_key != null
            ? String(h.run_key)
            : h.id ||
              h.history_id ||
              'unknown',

        execution_id:
          h.execution_id,

        name:
          h.plan_name ||
          h.name,

        mode:
          h.operation_type ||
          h.mode,

        run_status:
          h.result_state ||
          h.status,

        start_time:
          Number.isFinite(
            h.start_time_ms
          )
            ? new Date(
                h.start_time_ms
              )
            : h.start_time,

        end_time:
          Number.isFinite(
            h.start_time_ms
          ) &&
          Number.isFinite(
            h.duration_ms
          )
            ? new Date(
                h.start_time_ms +
                h.duration_ms
              )
            : h.end_time,

        steps:
          Array.isArray(h.steps)
            ? h.steps
            : Array.isArray(
                h.recovery_steps
              )
              ? h.recovery_steps
              : Array.isArray(
                  h.test_steps
                )
                ? h.test_steps
                : [],

        is_present: true,
        sync_run_id: runId
      })
    );
  }
    normalizeMappings(
    connectionId,
    pairingId,
    srmId,
    rawMappings,
    type,
    runId
  ) {
    if (!rawMappings) {
      return [];
    }

    const parseIdentity =
      value => {
        if (
          typeof value !== 'string'
        ) {
          return null;
        }

        const parts =
          value.split(':');

        if (
          parts.length === 3 &&
          parts.every(Boolean)
        ) {
          return {
            objectType: parts[0],
            objectMoid: parts[1],
            vcenterStableId:
              parts[2]
          };
        }

        return null;
      };

    const objectId =
      value => {
        if (
          typeof value === 'string'
        ) {
          return (
            parseIdentity(value)
              ?.objectMoid ||
            value
          );
        }

        return (
          value?.id ||
          value?.moid ||
          value?.value ||
          null
        );
      };

    const objectName = (
      value,
      explicitName
    ) =>
      explicitName ||
      value?.name ||
      null;

    const scopedObjectType = {
      NETWORK: 'Network',
      TEST_NETWORK: 'Network',
      FOLDER: 'Folder',
      RESOURCE: 'ResourcePool',
      STORAGE_POLICY:
        'StoragePolicy'
    }[type] || null;

    return rawMappings.map(
      m => {
        const primary =
          m.source ||
          m.primary_object;

        const secondary =
          m.target ||
          m.secondary_object;

        const reverseRecoveryObject =
          m.reverse_recovery_object;

        return {
          connection_id:
            connectionId,

          pairing_id:
            pairingId,

          srm_id:
            srmId,

          mapping_id:
            m.id,

          mapping_type:
            type,

          source_object_id:
            objectId(primary),

          source_object_name:
            objectName(
              primary,

              m.primary_object_name ||
              m.source?.name
            ),

          source_object_type:
            m.source?.type ||
            m.primary_object_type ||
            parseIdentity(primary)
              ?.objectType ||
            scopedObjectType,

          target_object_id:
            objectId(secondary),

          target_object_name:
            objectName(
              secondary,

              m.secondary_object_name ||
              m.target?.name
            ),

          target_object_type:
            m.target?.type ||
            m.secondary_object_type ||
            parseIdentity(secondary)
              ?.objectType ||
            scopedObjectType,

          mapping_status:
            m.status ||
            'PRESENT',

          reverse_mapping_type:
            m.reverse_mapping_type ||
            null,

          reverse_recovery_object_id:
            objectId(
              reverseRecoveryObject
            ),

          reverse_recovery_object_name:
            objectName(
              reverseRecoveryObject,
              m.reverse_recovery_object_name
            ),

          test_network_mapping:
            m.test_network_mapping ??
            null,

          ip_mapping:
            m.ip_mapping ??
            null,

          is_present: true,
          last_seen_at: new Date(),
          sync_run_id: runId
        };
      }
    );
  }

  normalizePlaceholderDatastores(
    connectionId,
    pairingId,
    srmId,
    rawDatastores,
    runId
  ) {
    if (!rawDatastores) {
      return [];
    }

    return rawDatastores.map(
      ds => {
        const visibleNames =
          (
            ds.visible_to || []
          )
            .map(v => v.name)
            .filter(Boolean);

        return {
          connection_id:
            connectionId,

          pairing_id:
            pairingId,

          srm_id:
            srmId,

          placeholder_datastore_id:
            ds.id,

          inventory_datastore_id:
            ds.id ||
            ds.datastore_id,

          datastore_name:
            ds.name,

          vcenter_external_id:
            ds.vcenter_id,

          datastore_status:
            ds.status ||
            'UNKNOWN',

          host_cluster_name:
            visibleNames.join(', ') ||
            null,

          is_present: true,
          last_seen_at: new Date(),
          sync_run_id: runId
        };
      }
    );
  }

  normalizeTasks(
    connectionId,
    rawTasks,
    runId
  ) {
    if (!rawTasks) {
      return [];
    }

    return rawTasks.map(
      t => {
        const safeError =
          safeDiagnosticText(
            t.error
          );

        const safeResult =
          safeDiagnosticText(
            t.result
          );

        const entity =
          parseVmwareEntity(
            t.entity
          );

        const parsedProgress =
          t.progress === null ||
          t.progress === undefined ||
          t.progress === ''
            ? null
            : Number(t.progress);

        const progressPercent =
          parsedProgress !== null &&
          Number.isFinite(
            parsedProgress
          )
            ? Math.max(
                0,
                Math.min(
                  100,
                  Math.round(
                    parsedProgress
                  )
                )
              )
            : null;

        const status =
          normalizeSrmObjectStatus(
            t.status
          );

        return {
          connection_id:
            connectionId,

          task_id:
            t.id,

          task_type:
            t.description_id ||
            null,

          description:
            t.description ||
            t.name ||
            null,

          entity_id:
            entity.entityId,

          entity_type:
            entity.entityType,

          entity_name:
            t.entity_name ||
            null,

          raw_status:
            status,

          normalized_status:
            status,

          progress_percent:
            progressPercent,

          queued_at:
            parseVmwareTimestamp(
              t.queued_time
            ),

          started_at:
            parseVmwareTimestamp(
              t.start_time
            ),

          completed_at:
            parseVmwareTimestamp(
              t.complete_time ??
              t.end_time
            ),

          safe_error_message:
            safeError,

          safe_result_summary:
            safeResult.slice(
              0,
              2000
            ),

          result_truncated:
            safeResult.length >
            2000,

          normalization_status:
            'NORMALIZED',

          is_recent: true,
          last_seen_at: new Date(),
          sync_run_id: runId
        };
      }
    );
  }
}

module.exports =
  new SrmNormalizerService();