const {
  pool
} = require('../../db');

const connectionRepository =
  require('../repositories/connection.repository');

const {
  decryptCredential
} = require('../utils/encryption.util');

const vcenterAdapter =
  require('../adapters/vmware/vcenter.adapter');

const vcenterObjectResolution =
  require('./vcenter-object-resolution.service');

const CACHE_TTL_MS =
  5 * 60 * 1000;

function isUsableVmwareDisplayName(name) {
  if (
    typeof name !== 'string'
  ) return false;

  const normalized =
    name.trim();

  if (!normalized) return false;

  return normalized
    .toLowerCase() !==
    'not found';
}

function policyIdentity(row) {
  if (
    typeof row === 'string'
  ) return {
    id: row,
    name: null
  };

  return {
    id:
      row?.policy ||
      row?.policy_id ||
      row?.id ||
      row?.profile_id ||
      row?.profileId ||
      row?.uuid ||
      null,

    name:
      row?.name ||
      row?.display_name ||
      row?.displayName ||
      null
  };
}

class StoragePolicyResolutionService {
  constructor({
    db = pool,
    contextResolver = null,
    databaseLookup = null,
    apiLookup = null,
    now = () => Date.now()
  } = {}) {
    this.db = db;

    this.contextResolver =
      contextResolver ||
      vcenterObjectResolution
        ._findVcenterContext
        .bind(
          vcenterObjectResolution
        );

    this.databaseLookup =
      databaseLookup ||
      this._lookupPostgresql
        .bind(this);

    this.apiLookup =
      apiLookup ||
      this._lookupVcenterStoragePolicies
        .bind(this);

    this.now = now;
    this.cache = new Map();
  }

  _cacheKey(
    vcenterStableId,
    storageProfileId
  ) {
    return `${vcenterStableId}|${storageProfileId}`;
  }

  _readCache(key) {
    const entry =
      this.cache.get(key);

    if (!entry) return null;

    if (
      entry.expiresAt <=
      this.now()
    ) {
      this.cache.delete(key);
      return null;
    }

    return {
      ...entry.value
    };
  }

  _writeCache(key, value) {
    this.cache.set(
      key,
      {
        value: {
          ...value
        },

        expiresAt:
          this.now() +
          CACHE_TTL_MS
      }
    );
  }

  invalidateAll() {
    const entriesInvalidated =
      this.cache.size;

    this.cache.clear();

    return entriesInvalidated;
  }
    async _lookupPostgresql(
    context,
    storageProfileId
  ) {
    const table =
      await this.db.run(
        (s, p) => {
          const R = s.helpers;
          const views = {};

          return R.result((parent => {
            let rows = [
              R.context(parent)
            ];

            let groups =
              rows.map(r => [r]);

            let result =
              groups.flatMap(g => {
                const r =
                  g[0] ||
                  R.context(parent);

                return R.expand({
                  "table_name":
                    s.hasCollection(
                      "public.storage_policies"
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

            return result
              .slice(0)
              .map(x => x.value);
          })(null));
        },
        [],
        false
      );

    if (
      !table.rows[0]
        ?.table_name
    ) return {
      supported: false,
      found: false,
      name: null
    };

    const {
      rows
    } = await this.db.run(
      (s, p) => {
        const R = s.helpers;
        const views = {};

        return R.result((parent => {
          let rows = [
            R.context(parent)
          ];

          rows = R.join(
            rows,
            "storage_policies",
            r =>
              views[
                "storage_policies"
              ] ||
              s.read(
                "storage_policies"
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
                    "vcenter_id",
                    null
                  ),
                  p[0]
                ),
                R.binary(
                  "=",
                  R.ref(
                    r,
                    "policy_id",
                    null
                  ),
                  p[1]
                )
              ),
              R.binary(
                "=",
                R.ref(
                  r,
                  "is_present",
                  null
                ),
                true
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
                "name":
                  R.ref(
                    r,
                    "name",
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

          return result
            .slice(
              0,
              0 + Number(1)
            )
            .map(x => x.value);
        })(null));
      },
      [
        context.vcenterId,
        storageProfileId
      ],
      false
    );

    return {
      supported: true,
      found: rows.length > 0,

      name:
        rows[0]?.name ||
        null
    };
  }

  async _lookupVcenterStoragePolicies(
    context,
    storageProfileId
  ) {
    const connection =
      await connectionRepository
        .findConnectionWithCredentialById(
          context.connectionId
        );

    if (
      !connection?.encryptedPassword
    ) {
      const error =
        new Error(
          'VCENTER_CREDENTIAL_NOT_AVAILABLE'
        );

      error.code =
        'VCENTER_CREDENTIAL_NOT_AVAILABLE';

      throw error;
    }

    const password =
      decryptCredential(
        connection.encryptedPassword,
        connection.encryptionIv,
        connection.encryptionAuthTag
      );

    let automation = null;

    try {
      automation =
        await vcenterAdapter
          .loginAutomation(
            connection.baseUrl,
            connection.username,
            password,
            connection.verifyTls
          );

      const response =
        await automation
          .httpClient
          .get(
            '/api/vcenter/storage/policies',
            {
              headers: {
                'vmware-api-session-id':
                  automation.sessionId,

                Accept:
                  'application/json'
              }
            }
          );

      const policies =
        Array.isArray(response.data)
          ? response.data.map(
            policyIdentity
          )
          : [];

      const match =
        policies.find(
          policy =>
            policy.id ===
            storageProfileId
        );

      return {
        found: Boolean(
          match &&
          isUsableVmwareDisplayName(
            match.name
          )
        ),

        name:
          match?.name ||
          null,

        endpoint:
          '/api/vcenter/storage/policies'
      };
    } finally {
      if (
        automation
      ) await vcenterAdapter
        .logoutAutomation(
          automation.httpClient,
          automation.sessionId
        );
    }
  }
    _baseResult({
    vcenterStableId,
    storageProfileId,
    apiReportedName
  }, context = null) {
    return {
      policyId:
        storageProfileId ||
        null,

      apiReportedPolicyName:
        apiReportedName ??
        null,

      resolvedPolicyName:
        null,

      policyNameAvailability:
        'NOT_AVAILABLE',

      policyResolutionStatus:
        'NOT_PROVIDED_BY_API',

      policyResolutionSource:
        null,

      associatedVcenterStableId:
        vcenterStableId ||
        null,

      associatedVcenterHost:
        context?.vcenterHost ||
        null,

      associatedVcenterName:
        context?.vcenterName ||
        null,

      associatedSiteName:
        context?.siteName ||
        null
    };
  }

  async resolveStoragePolicy({
    vcenterStableId,
    storageProfileId,
    apiReportedName
  } = {}) {
    const request = {
      vcenterStableId,
      storageProfileId,
      apiReportedName
    };

    if (!storageProfileId) {
      return {
        ...this._baseResult(
          request
        ),

        policyResolutionStatus:
          'CONTRACT_ERROR'
      };
    }

    if (!vcenterStableId) {
      return {
        ...this._baseResult(
          request
        ),

        policyResolutionStatus:
          'UNMAPPED_VCENTER'
      };
    }

    const key =
      this._cacheKey(
        vcenterStableId,
        storageProfileId
      );

    const cached =
      this._readCache(key);

    if (cached) return {
      ...cached,

      apiReportedPolicyName:
        apiReportedName ??
        null
    };

    const context =
      await this.contextResolver(
        vcenterStableId
      );

    if (!context) {
      return {
        ...this._baseResult(
          request
        ),

        policyResolutionStatus:
          'UNMAPPED_VCENTER'
      };
    }

    const base =
      this._baseResult(
        request,
        context
      );

    const database =
      await this.databaseLookup(
        context,
        storageProfileId
      );

    if (
      database?.found &&
      isUsableVmwareDisplayName(
        database.name
      )
    ) {
      const resolved = {
        ...base,

        resolvedPolicyName:
          database.name.trim(),

        policyNameAvailability:
          'AVAILABLE',

        policyResolutionStatus:
          'RESOLVED',

        policyResolutionSource:
          'POSTGRESQL_VCENTER_STORAGE_POLICY_INVENTORY'
      };

      this._writeCache(
        key,
        resolved
      );

      return resolved;
    }

    try {
      const api =
        await this.apiLookup(
          context,
          storageProfileId
        );

      if (
        api?.found &&
        isUsableVmwareDisplayName(
          api.name
        )
      ) {
        const resolved = {
          ...base,

          resolvedPolicyName:
            api.name.trim(),

          policyNameAvailability:
            'AVAILABLE',

          policyResolutionStatus:
            'RESOLVED',

          policyResolutionSource:
            'VCENTER_STORAGE_POLICY_API_READ_ONLY'
        };

        this._writeCache(
          key,
          resolved
        );

        return resolved;
      }

      if (
        isUsableVmwareDisplayName(
          apiReportedName
        )
      ) {
        const resolved = {
          ...base,

          resolvedPolicyName:
            apiReportedName.trim(),

          policyNameAvailability:
            'AVAILABLE',

          policyResolutionStatus:
            'RESOLVED',

          policyResolutionSource:
            'SRM_API_PROVIDED'
        };

        this._writeCache(
          key,
          resolved
        );

        return resolved;
      }

      const unresolved = {
        ...base,

        policyResolutionStatus:
          'NOT_FOUND_IN_VCENTER',

        policyResolutionSource:
          'VCENTER_STORAGE_POLICY_API_READ_ONLY'
      };

      this._writeCache(
        key,
        unresolved
      );

      return unresolved;
    } catch (_error) {
      if (
        isUsableVmwareDisplayName(
          apiReportedName
        )
      ) {
        return {
          ...base,

          resolvedPolicyName:
            apiReportedName.trim(),

          policyNameAvailability:
            'AVAILABLE',

          policyResolutionStatus:
            'RESOLVED',

          policyResolutionSource:
            'SRM_API_PROVIDED'
        };
      }

      return {
        ...base,

        policyResolutionStatus:
          'PBM_LOOKUP_FAILED',

        policyResolutionSource:
          'VCENTER_STORAGE_POLICY_API_READ_ONLY'
      };
    }
  }
}

const service =
  new StoragePolicyResolutionService();

service.StoragePolicyResolutionService =
  StoragePolicyResolutionService;

service.isUsableVmwareDisplayName =
  isUsableVmwareDisplayName;

service.policyIdentity =
  policyIdentity;

module.exports = service;