const {
  pool
} = require('../../db');

const connectionRepository =
  require('../repositories/connection.repository');

const credentialCrypto =
  require('../utils/encryption.util');

const vcenterAdapter =
  require('../adapters/vmware/vcenter.adapter');

const {
  parseUrlHost
} = require('./appliance-discovery.service');

const OBJECT_TYPES = Object.freeze({
  NETWORK: {
    table: 'networks',
    idColumn: 'network_id',
    apiTypes: [
      'Network',
      'DistributedVirtualPortgroup',
      'OpaqueNetwork'
    ]
  },

  FOLDER: {
    apiTypes: [
      'Folder'
    ]
  },

  RESOURCE: {
    apiTypes: [
      'ResourcePool'
    ]
  },

  DATASTORE: {
    table: 'datastores',
    idColumn: 'datastore_id',
    apiTypes: [
      'Datastore'
    ]
  }
});

const CACHE_TTL_MS =
  5 * 60 * 1000;

function normalizeObjectType(value) {
  const type =
    String(value || '')
      .trim()
      .toUpperCase();

  if (
    [
      'NETWORK',
      'DISTRIBUTEDVIRTUALPORTGROUP',
      'OPAQUENETWORK'
    ].includes(type)
  ) return 'NETWORK';

  if (
    [
      'FOLDER',
      'VMFOLDER'
    ].includes(type)
  ) return 'FOLDER';

  if (
    [
      'RESOURCE',
      'RESOURCEPOOL',
      'RESOURCE_POOL'
    ].includes(type)
  ) return 'RESOURCE';

  if (
    [
      'DATASTORE'
    ].includes(type)
  ) return 'DATASTORE';

  return null;
}

function parseVmwareObjectIdentity(value) {
  if (
    typeof value !== 'string'
  ) return null;

  const parts =
    value.split(':');

  if (
    parts.length !== 3 ||
    !parts.every(Boolean)
  ) return null;

  return {
    objectType:
      normalizeObjectType(
        parts[0]
      ) ||
      String(parts[0])
        .toUpperCase(),

    objectMoid: parts[1],

    vcenterStableId:
      parts[2]
  };
}

function cacheKey(
  vcenterStableId,
  objectType,
  objectMoid
) {
  return `${vcenterStableId}|${objectType}|${objectMoid}`;
}

class VcenterObjectResolutionService {
  constructor({
    db = pool,
    apiLookup = null,
    resourceHierarchyDatabaseLookup = null,
    resourceHierarchyApiLookup = null,
    now = () => Date.now()
  } = {}) {
    this.db = db;

    this.apiLookup =
      apiLookup ||
      this._lookupVcenterApi
        .bind(this);

    this.resourceHierarchyDatabaseLookup =
      resourceHierarchyDatabaseLookup ||
      this._lookupResourceHierarchyPostgresql
        .bind(this);

    this.resourceHierarchyApiLookup =
      resourceHierarchyApiLookup ||
      this._lookupResourceHierarchyApi
        .bind(this);

    this.now = now;
    this.cache = new Map();
  }

  _baseResult(
    request,
    context = null
  ) {
    const objectType =
      normalizeObjectType(
        request.objectType
      );

    return {
      objectMoid:
        request.objectMoid ||
        null,

      objectType,

      objectName: null,

      objectNameAvailability:
        'NOT_COLLECTED',

      objectMetadata: null,

      vcenterStableId:
        request.vcenterStableId ||
        null,

      vcenterName:
        context?.vcenterName ||
        null,

      vcenterHost:
        context?.vcenterHost ||
        null,

      siteName:
        context?.siteName ||
        null,

      resolutionStatus:
        'NOT_COLLECTED',

      resolutionSource: null
    };
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
    async _findVcenterContext(vcenterStableId) {
    if (!vcenterStableId) return null;

    const {
      rows
    } = await this.db.run((s, p) => {
      const R = s.helpers;
      const views = {};

      return R.result((views => {
        views["identities"] = [
          ...(parent => {
            let rows = [R.context(parent)];

            rows = R.join(
              rows,
              "vc",
              r => views["connections"] || s.read("connections"),
              r => true,
              "INNER JOIN"
            );

            rows = rows.filter(r =>
              R.binary(
                "AND",
                R.binary(
                  "=",
                  R.ref(r, "system_type", "vc"),
                  "VCENTER"
                ),
                R.binary(
                  "=",
                  R.ref(r, "is_active", "vc"),
                  true
                )
              )
            );

            let groups = rows.map(r => [r]);

            let result = groups.flatMap(g => {
              const r = g[0] || R.context(parent);

              return R.expand({
                "vcenter_connection_id": R.ref(r, "id", "vc"),
                "vcenter_name": R.ref(r, "connection_name", "vc"),
                "vcenter_id": R.ref(r, "base_url", "vc"),
                "site_name": R.ref(r, "site", "vc"),
                "stable_id": R.ref(r, "base_url", "vc"),
                "identity_priority": 10
              }).map(value => ({
                value,
                r: R.projectContext(r, value),
                g
              }));
            });

            return result.slice(0).map(x => x.value);
          })(null),

          ...[
            ...(parent => {
              let rows = [R.context(parent)];

              rows = R.join(
                rows,
                "p",
                r => views["vr_pairings"] || s.read("vr_pairings"),
                r => true,
                "INNER JOIN"
              );

              rows = R.join(
                rows,
                "vr",
                r => views["connections"] || s.read("connections"),
                r => R.binary(
                  "AND",
                  R.binary(
                    "=",
                    R.ref(r, "id", "vr"),
                    R.ref(r, "connection_id", "p")
                  ),
                  R.binary(
                    "=",
                    R.ref(r, "system_type", "vr"),
                    "VR"
                  )
                ),
                "INNER JOIN"
              );

              rows = R.join(
                rows,
                "vc",
                r => views["connections"] || s.read("connections"),
                r => R.binary(
                  "=",
                  R.ref(r, "id", "vc"),
                  R.fn(
                    "coalesce",
                    [
                      R.ref(r, "associated_vcenter_connection_id", "vr"),

                      R.scalar((parent => {
                        let rows = [R.context(parent)];

                        rows = R.join(
                          rows,
                          "connections",
                          r => views["connections"] || s.read("connections"),
                          r => true,
                          "INNER JOIN"
                        );

                        rows = rows.filter(r =>
                          R.binary(
                            "AND",
                            R.binary(
                              "=",
                              R.ref(r, "system_type", null),
                              "VCENTER"
                            ),
                            R.binary(
                              "OR",
                              R.binary(
                                "=",
                                R.ref(r, "site", null),
                                R.ref(r, "site", "vr")
                              ),
                              R.binary(
                                "LIKE",
                                R.ref(r, "base_url", null),
                                R.binary(
                                  "||",
                                  R.binary(
                                    "||",
                                    "%",
                                    R.ref(r, "local_site_name", "p")
                                  ),
                                  "%"
                                )
                              )
                            )
                          )
                        );

                        let groups = rows.map(r => [r]);

                        let result = groups.flatMap(g => {
                          const r = g[0] || R.context(parent);

                          return R.expand({
                            "id": R.ref(r, "id", null)
                          }).map(value => ({
                            value,
                            r: R.projectContext(r, value),
                            g
                          }));
                        });

                        return result
                          .slice(0, 0 + Number(1))
                          .map(x => x.value);
                      })(r))
                    ]
                  )
                ),
                "INNER JOIN"
              );

              rows = rows.filter(r =>
                R.binary(
                  "AND",
                  R.binary(
                    "=",
                    R.ref(r, "is_present", "p"),
                    true
                  ),
                  R.unary(
                    "IS NOT NULL",
                    R.ref(r, "local_vcenter_external_id", "p")
                  )
                )
              );

              let groups = rows.map(r => [r]);

              let result = groups.flatMap(g => {
                const r = g[0] || R.context(parent);

                return R.expand({
                  "vcenter_connection_id": R.ref(r, "id", "vc"),
                  "vcenter_name": R.ref(r, "connection_name", "vc"),
                  "vcenter_id": R.ref(r, "base_url", "vc"),
                  "site_name": R.ref(r, "site", "vc"),
                  "stable_id": R.ref(r, "local_vcenter_external_id", "p"),
                  "identity_priority": 100
                }).map(value => ({
                  value,
                  r: R.projectContext(r, value),
                  g
                }));
              });

              return result.slice(0).map(x => x.value);
            })(null),

            ...[
              ...(parent => {
                let rows = [R.context(parent)];

                rows = R.join(
                  rows,
                  "p",
                  r => views["vr_pairings"] || s.read("vr_pairings"),
                  r => true,
                  "INNER JOIN"
                );

                rows = R.join(
                  rows,
                  "vr",
                  r => views["connections"] || s.read("connections"),
                  r => R.binary(
                    "AND",
                    R.binary(
                      "=",
                      R.ref(r, "id", "vr"),
                      R.ref(r, "connection_id", "p")
                    ),
                    R.binary(
                      "=",
                      R.ref(r, "system_type", "vr"),
                      "VR"
                    )
                  ),
                  "INNER JOIN"
                );

                rows = R.join(
                  rows,
                  "vc",
                  r => views["connections"] || s.read("connections"),
                  r => R.binary(
                    "=",
                    R.ref(r, "id", "vc"),
                    R.fn(
                      "coalesce",
                      [
                        R.scalar((parent => {
                          let rows = [R.context(parent)];

                          rows = R.join(
                            rows,
                            "connections",
                            r => views["connections"] || s.read("connections"),
                            r => true,
                            "INNER JOIN"
                          );

                          rows = rows.filter(r =>
                            R.binary(
                              "AND",
                              R.binary(
                                "=",
                                R.ref(r, "system_type", null),
                                "VCENTER"
                              ),
                              R.binary(
                                "OR",
                                R.binary(
                                  "!=",
                                  R.ref(r, "site", null),
                                  R.ref(r, "site", "vr")
                                ),
                                R.binary(
                                  "LIKE",
                                  R.ref(r, "base_url", null),
                                  R.binary(
                                    "||",
                                    R.binary(
                                      "||",
                                      "%",
                                      R.ref(r, "remote_site_name", "p")
                                    ),
                                    "%"
                                  )
                                )
                              )
                            )
                          );

                          let groups = rows.map(r => [r]);

                          let result = groups.flatMap(g => {
                            const r = g[0] || R.context(parent);

                            return R.expand({
                              "id": R.ref(r, "id", null)
                            }).map(value => ({
                              value,
                              r: R.projectContext(r, value),
                              g
                            }));
                          });

                          return result
                            .slice(0, 0 + Number(1))
                            .map(x => x.value);
                        })(r)),

                        R.ref(r, "associated_vcenter_connection_id", "vr")
                      ]
                    )
                  ),
                  "INNER JOIN"
                );

                rows = rows.filter(r =>
                  R.binary(
                    "AND",
                    R.binary(
                      "=",
                      R.ref(r, "is_present", "p"),
                      true
                    ),
                    R.unary(
                      "IS NOT NULL",
                      R.ref(r, "remote_vcenter_external_id", "p")
                    )
                  )
                );

                let groups = rows.map(r => [r]);

                let result = groups.flatMap(g => {
                  const r = g[0] || R.context(parent);

                  return R.expand({
                    "vcenter_connection_id": R.ref(r, "id", "vc"),
                    "vcenter_name": R.ref(r, "connection_name", "vc"),
                    "vcenter_id": R.ref(r, "base_url", "vc"),
                    "site_name": R.ref(r, "site", "vc"),
                    "stable_id": R.ref(r, "remote_vcenter_external_id", "p"),
                    "identity_priority": 50
                  }).map(value => ({
                    value,
                    r: R.projectContext(r, value),
                    g
                  }));
                });

                return result.slice(0).map(x => x.value);
              })(null),

              ...[
                ...(parent => {
                  let rows = [R.context(parent)];

                  rows = R.join(
                    rows,
                    "sp",
                    r => views["srm_site_pairs"] || s.read("srm_site_pairs"),
                    r => true,
                    "INNER JOIN"
                  );

                  rows = R.join(
                    rows,
                    "srm",
                    r => views["connections"] || s.read("connections"),
                    r => R.binary(
                      "AND",
                      R.binary(
                        "=",
                        R.ref(r, "id", "srm"),
                        R.ref(r, "connection_id", "sp")
                      ),
                      R.binary(
                        "=",
                        R.ref(r, "system_type", "srm"),
                        "SRM"
                      )
                    ),
                    "INNER JOIN"
                  );

                  rows = R.join(
                    rows,
                    "vc",
                    r => views["connections"] || s.read("connections"),
                    r => R.binary(
                      "=",
                      R.ref(r, "id", "vc"),
                      R.fn(
                        "coalesce",
                        [
                          R.ref(r, "associated_vcenter_connection_id", "srm"),

                          R.scalar((parent => {
                            let rows = [R.context(parent)];

                            rows = R.join(
                              rows,
                              "connections",
                              r => views["connections"] || s.read("connections"),
                              r => true,
                              "INNER JOIN"
                            );

                            rows = rows.filter(r =>
                              R.binary(
                                "AND",
                                R.binary(
                                  "=",
                                  R.ref(r, "system_type", null),
                                  "VCENTER"
                                ),
                                R.binary(
                                  "OR",
                                  R.binary(
                                    "=",
                                    R.ref(r, "site", null),
                                    R.ref(r, "site", "srm")
                                  ),
                                  R.binary(
                                    "LIKE",
                                    R.ref(r, "base_url", null),
                                    R.binary(
                                      "||",
                                      R.binary(
                                        "||",
                                        "%",
                                        R.ref(r, "local_site_name", "sp")
                                      ),
                                      "%"
                                    )
                                  )
                                )
                              )
                            );

                            let groups = rows.map(r => [r]);

                            let result = groups.flatMap(g => {
                              const r = g[0] || R.context(parent);

                              return R.expand({
                                "id": R.ref(r, "id", null)
                              }).map(value => ({
                                value,
                                r: R.projectContext(r, value),
                                g
                              }));
                            });

                            return result
                              .slice(0, 0 + Number(1))
                              .map(x => x.value);
                          })(r))
                        ]
                      )
                    ),
                    "INNER JOIN"
                  );

                  rows = rows.filter(r =>
                    R.binary(
                      "AND",
                      R.binary(
                        "=",
                        R.ref(r, "is_present", "sp"),
                        true
                      ),
                      R.unary(
                        "IS NOT NULL",
                        R.ref(r, "local_vcenter_id", "sp")
                      )
                    )
                  );

                  let groups = rows.map(r => [r]);

                  let result = groups.flatMap(g => {
                    const r = g[0] || R.context(parent);

                    return R.expand({
                      "vcenter_connection_id": R.ref(r, "id", "vc"),
                      "vcenter_name": R.ref(r, "connection_name", "vc"),
                      "vcenter_id": R.ref(r, "base_url", "vc"),
                      "site_name": R.ref(r, "site", "vc"),
                      "stable_id": R.ref(r, "local_vcenter_id", "sp"),
                      "identity_priority": 100
                    }).map(value => ({
                      value,
                      r: R.projectContext(r, value),
                      g
                    }));
                  });

                  return result.slice(0).map(x => x.value);
                })(null),

                ...(parent => {
                  let rows = [R.context(parent)];

                  rows = R.join(
                    rows,
                    "sp",
                    r => views["srm_site_pairs"] || s.read("srm_site_pairs"),
                    r => true,
                    "INNER JOIN"
                  );

                  rows = R.join(
                    rows,
                    "srm",
                    r => views["connections"] || s.read("connections"),
                    r => R.binary(
                      "AND",
                      R.binary(
                        "=",
                        R.ref(r, "id", "srm"),
                        R.ref(r, "connection_id", "sp")
                      ),
                      R.binary(
                        "=",
                        R.ref(r, "system_type", "srm"),
                        "SRM"
                      )
                    ),
                    "INNER JOIN"
                  );

                  rows = R.join(
                    rows,
                    "vc",
                    r => views["connections"] || s.read("connections"),
                    r => R.binary(
                      "=",
                      R.ref(r, "id", "vc"),
                      R.fn(
                        "coalesce",
                        [
                          R.scalar((parent => {
                            let rows = [R.context(parent)];

                            rows = R.join(
                              rows,
                              "connections",
                              r => views["connections"] || s.read("connections"),
                              r => true,
                              "INNER JOIN"
                            );

                            rows = rows.filter(r =>
                              R.binary(
                                "AND",
                                R.binary(
                                  "=",
                                  R.ref(r, "system_type", null),
                                  "VCENTER"
                                ),
                                R.binary(
                                  "OR",
                                  R.binary(
                                    "!=",
                                    R.ref(r, "site", null),
                                    R.ref(r, "site", "srm")
                                  ),
                                  R.binary(
                                    "LIKE",
                                    R.ref(r, "base_url", null),
                                    R.binary(
                                      "||",
                                      R.binary(
                                        "||",
                                        "%",
                                        R.ref(r, "remote_site_name", "sp")
                                      ),
                                      "%"
                                    )
                                  )
                                )
                              )
                            );

                            let groups = rows.map(r => [r]);

                            let result = groups.flatMap(g => {
                              const r = g[0] || R.context(parent);

                              return R.expand({
                                "id": R.ref(r, "id", null)
                              }).map(value => ({
                                value,
                                r: R.projectContext(r, value),
                                g
                              }));
                            });

                            return result
                              .slice(0, 0 + Number(1))
                              .map(x => x.value);
                          })(r)),

                          R.ref(r, "associated_vcenter_connection_id", "srm")
                        ]
                      )
                    ),
                    "INNER JOIN"
                  );

                  rows = rows.filter(r =>
                    R.binary(
                      "AND",
                      R.binary(
                        "=",
                        R.ref(r, "is_present", "sp"),
                        true
                      ),
                      R.unary(
                        "IS NOT NULL",
                        R.ref(r, "remote_vcenter_id", "sp")
                      )
                    )
                  );

                  let groups = rows.map(r => [r]);

                  let result = groups.flatMap(g => {
                    const r = g[0] || R.context(parent);

                    return R.expand({
                      "vcenter_connection_id": R.ref(r, "id", "vc"),
                      "vcenter_name": R.ref(r, "connection_name", "vc"),
                      "vcenter_id": R.ref(r, "base_url", "vc"),
                      "site_name": R.ref(r, "site", "vc"),
                      "stable_id": R.ref(r, "remote_vcenter_id", "sp"),
                      "identity_priority": 50
                    }).map(value => ({
                      value,
                      r: R.projectContext(r, value),
                      g
                    }));
                  });

                  return result.slice(0).map(x => x.value);
                })(null)
              ]
            ]
          ]
        ];

        return (parent => {
          let rows = [R.context(parent)];

          rows = R.join(
            rows,
            "identities",
            r => views["identities"] || s.read("identities"),
            r => true,
            "INNER JOIN"
          );

          rows = rows.filter(r =>
            R.binary(
              "OR",
              R.binary(
                "OR",
                R.binary(
                  "=",
                  R.ref(r, "stable_id", null),
                  p[0]
                ),
                R.binary(
                  "=",
                  R.ref(r, "vcenter_id", null),
                  p[0]
                )
              ),
              R.binary(
                "LIKE",
                R.ref(r, "vcenter_id", null),
                R.binary(
                  "||",
                  R.binary(
                    "||",
                    "%",
                    p[0]
                  ),
                  "%"
                )
              )
            )
          );

          let groups = rows.map(r => [r]);

          let result = groups.flatMap(g => {
            const r = g[0] || R.context(parent);

            return R.expand({
              "vcenter_connection_id": R.ref(r, "vcenter_connection_id", null),
              "vcenter_name": R.ref(r, "vcenter_name", null),
              "vcenter_id": R.ref(r, "vcenter_id", null),
              "site_name": R.ref(r, "site_name", null),
              "stable_id": R.ref(r, "stable_id", null)
            }).map(value => ({
              value,
              r: R.projectContext(r, value),
              g
            }));
          });

          result.sort((a, b) =>
            R.order([
              [
                R.ref(a.r, "identity_priority", null),
                R.ref(b.r, "identity_priority", null),
                "DESC",
                null
              ],
              [
                R.ref(a.r, "vcenter_connection_id", null),
                R.ref(b.r, "vcenter_connection_id", null),
                "ASC",
                null
              ]
            ])
          );

          return result
            .slice(0, 0 + Number(1))
            .map(x => x.value);
        })(null);
      })({
        ...views
      }));
    }, [vcenterStableId], false);

    const row = rows[0];

    if (!row) return null;

    return {
      connectionId:
        row.vcenter_connection_id,

      vcenterId:
        row.vcenter_id,

      vcenterStableId,

      vcenterName:
        row.vcenter_name,

      vcenterHost:
        parseUrlHost(
          row.vcenter_id
        ).host,

      siteName:
        row.site_name
    };
  }
    async _lookupPostgresql(context, objectType, objectMoid) {
    const definition = OBJECT_TYPES[objectType];

    if (!definition?.table) return {
      supported: false,
      found: false,
      name: null
    };

    const query = objectType === 'DATASTORE' ? `SELECT d.*,
           (SELECT c.name
              FROM hosts h
              JOIN clusters c
                ON c.vcenter_id = h.vcenter_id
               AND c.cluster_id = h.cluster_moid
               AND c.is_present = true
             WHERE h.vcenter_id = d.vcenter_id
               AND h.is_present = true
               AND EXISTS (
                 SELECT 1
                   FROM jsonb_array_elements(COALESCE(h.lun_list, '[]'::jsonb)) lun
                  WHERE COALESCE(lun->'datastores', '[]'::jsonb) ? d.name
               )
             LIMIT 1) AS cluster_name
         FROM datastores d
        WHERE d.vcenter_id = $1 AND d.datastore_id = $2 AND d.is_present = true
        LIMIT 1` : `SELECT * FROM ${definition.table} WHERE vcenter_id = $1 AND ${definition.idColumn} = $2 AND is_present = true LIMIT 1`;

    const {
      rows
    } = await this.db.run(s => {
      const rows = s.read(definition.table)
        .filter(r =>
          r.vcenter_id === context.vcenterId &&
          r[definition.idColumn] === objectMoid &&
          r.is_present === true
        )
        .slice(0, 1)
        .map(r => ({
          ...r
        }));

      if (objectType === 'DATASTORE' && rows[0]) {
        const mapping = s.read('host_datastore_mappings').find(
          m =>
            m.vcenter_id === context.vcenterId &&
            m.datastore_moid === rows[0].datastore_id &&
            m.is_present
        );

        const h = mapping
          ? s.read('hosts').find(
            h =>
              h.vcenter_id === context.vcenterId &&
              h.host_id === mapping.host_moid &&
              h.is_present
          )
          : s.read('hosts').find(
            h =>
              h.vcenter_id === context.vcenterId &&
              h.is_present &&
              (h.lun_list || []).some(
                l =>
                  (l.datastores || [])
                    .includes(rows[0].name)
              )
          );

        const cluster = h
          ? s.read('clusters').find(
            c =>
              c.vcenter_id === h.vcenter_id &&
              c.cluster_id === h.cluster_moid &&
              c.is_present
          )
          : null;

        rows[0].cluster_name =
          cluster?.name ||
          h?.name ||
          null;
      }

      return {
        rows
      };
    }, [], false);

    const row = rows[0];

    return {
      supported: true,
      found: rows.length > 0,
      name: row?.name || null,

      metadata: row ? {
        inventoryObjectType:
          row.type || null,

        capacityBytes:
          row.capacity == null
            ? null
            : Number(row.capacity),

        freeSpaceBytes:
          row.free_space == null
            ? null
            : Number(row.free_space),

        clusterName:
          row.cluster_name || null,

        lastCollectedAt:
          row.last_updated || null
      } : null
    };
  }

  async _lookupVcenterApi(context, requests) {
    const connection =
      await connectionRepository
        .findConnectionWithCredentialById(
          context.connectionId
        );

    if (!connection?.encryptedPassword) {
      const error =
        new Error(
          'VCENTER_CREDENTIAL_NOT_AVAILABLE'
        );

      error.code =
        'VCENTER_CREDENTIAL_NOT_AVAILABLE';

      throw error;
    }

    const password =
      credentialCrypto.decryptCredential(
        connection.encryptedPassword,
        connection.encryptionIv,
        connection.encryptionAuthTag
      );

    let automation = null;
    let vi = null;

    const found = new Map();

    try {
      automation =
        await vcenterAdapter
          .loginAutomation(
            connection.baseUrl,
            connection.username,
            password,
            connection.verifyTls
          );

      vi =
        await vcenterAdapter
          .loginViJson(
            automation.httpClient,
            connection.baseUrl,
            connection.username,
            password
          );

      const requestedTypes = [
        ...new Set(
          requests.map(
            item => item.objectType
          )
        )
      ];

      for (
        const objectType of
        requestedTypes
      ) {
        const definition =
          OBJECT_TYPES[objectType];

        for (
          const apiType of
          definition?.apiTypes || []
        ) {
          const objects =
            await vcenterAdapter
              .fetchDetailedProperties(
                automation.httpClient,
                vi.viSessionId,
                vi.apiVersion,
                apiType,
                ['name'],
                vi.moids
              );

          for (
            const object of objects
          ) {
            const moid =
              object?.obj?.value;

            if (!moid) continue;

            found.set(
              `${objectType}|${moid}`,
              {
                name:
                  vcenterAdapter
                    .getProp(
                      object,
                      'name'
                    ) ||
                  null,

                apiObjectType:
                  apiType
              }
            );
          }
        }
      }

      return found;
    } finally {
      if (vi && automation) {
        await vcenterAdapter
          .logoutViJson(
            automation.httpClient,
            connection.baseUrl,
            vi.apiVersion,
            vi.viSessionId
          );
      }

      if (automation) await vcenterAdapter
        .logoutAutomation(
          automation.httpClient,
          automation.sessionId
        );
    }
  }
    async _lookupResourceHierarchyPostgresql(
    _context,
    _resourceMoid
  ) {
    // The current inventory schema has no authoritative ResourcePool hierarchy
    // table. Keep this hook explicit so a future synced table can be preferred
    // without changing the resolver contract.
    return {
      supported: false,
      found: false,
      hierarchy: null
    };
  }

  async _lookupResourceHierarchyApi(
    context,
    resourceMoid
  ) {
    const connection =
      await connectionRepository
        .findConnectionWithCredentialById(
          context.connectionId
        );

    if (!connection?.encryptedPassword) {
      const error =
        new Error(
          'VCENTER_CREDENTIAL_NOT_AVAILABLE'
        );

      error.code =
        'VCENTER_CREDENTIAL_NOT_AVAILABLE';

      throw error;
    }

    const password =
      credentialCrypto.decryptCredential(
        connection.encryptedPassword,
        connection.encryptionIv,
        connection.encryptionAuthTag
      );

    let automation = null;
    let vi = null;

    try {
      automation =
        await vcenterAdapter
          .loginAutomation(
            connection.baseUrl,
            connection.username,
            password,
            connection.verifyTls
          );

      vi =
        await vcenterAdapter
          .loginViJson(
            automation.httpClient,
            connection.baseUrl,
            connection.username,
            password
          );

      const resourcePools =
        await vcenterAdapter
          .fetchDetailedProperties(
            automation.httpClient,
            vi.viSessionId,
            vi.apiVersion,
            'ResourcePool',
            [
              'name',
              'parent',
              'owner'
            ],
            vi.moids
          );

      const computeContainers = [];

      for (
        const apiType of [
          'ClusterComputeResource',
          'ComputeResource'
        ]
      ) {
        try {
          const objects =
            await vcenterAdapter
              .fetchDetailedProperties(
                automation.httpClient,
                vi.viSessionId,
                vi.apiVersion,
                apiType,
                [
                  'name',
                  'parent',
                  'resourcePool'
                ],
                vi.moids
              );

          computeContainers.push(
            ...objects.map(object => ({
              object,
              apiType
            }))
          );
        } catch (_err) {
          // If a specific compute container type fails or has no objects, continue with other types
        }
      }

      const ref = value => {
        if (!value) return null;

        if (
          typeof value === 'string'
        ) return {
          moid: value,
          type: null
        };

        return {
          moid:
            value.value ||
            value._value ||
            null,

          type:
            value.type ||
            value._typeName ||
            null
        };
      };

      const resource =
        resourcePools.find(
          object =>
            object?.obj?.value ===
            resourceMoid
        );

      if (!resource) return null;

      const parentRef = ref(
        vcenterAdapter.getProp(
          resource,
          'parent'
        )
      );

      const ownerRef = ref(
        vcenterAdapter.getProp(
          resource,
          'owner'
        )
      );

      const parentPool =
        parentRef?.moid
          ? resourcePools.find(
            object =>
              object?.obj?.value ===
              parentRef.moid
          )
          : null;

      const compute =
        computeContainers.find(({
          object
        }) =>
          object?.obj?.value ===
          ownerRef?.moid
        ) ||
        computeContainers.find(({
          object
        }) =>
          ref(
            vcenterAdapter.getProp(
              object,
              'resourcePool'
            )
          )?.moid ===
          resourceMoid
        );

      const computeResourcePoolRef =
        compute
          ? ref(
            vcenterAdapter.getProp(
              compute.object,
              'resourcePool'
            )
          )
          : null;

      return {
        resourcePool: {
          moid:
            resource.obj.value,

          type:
            resource.obj.type ||
            'ResourcePool',

          name:
            vcenterAdapter.getProp(
              resource,
              'name'
            ) ||
            null
        },

        parent:
          parentPool
            ? {
              moid:
                parentPool.obj.value,

              type:
                parentPool.obj.type ||
                'ResourcePool',

              name:
                vcenterAdapter.getProp(
                  parentPool,
                  'name'
                ) ||
                null
            }
            : parentRef
              ? {
                ...parentRef,

                name:
                  compute?.object?.obj
                    ?.value ===
                    parentRef.moid
                    ? vcenterAdapter
                      .getProp(
                        compute.object,
                        'name'
                      ) ||
                      null
                    : null
              }
              : null,

        computeContainer:
          compute
            ? {
              moid:
                compute.object.obj
                  .value,

              type:
                compute.apiType,

              name:
                vcenterAdapter.getProp(
                  compute.object,
                  'name'
                ) ||
                null,

              rootResourcePoolMoid:
                computeResourcePoolRef
                  ?.moid ||
                null
            }
            : null
      };
    } finally {
      if (vi && automation) {
        await vcenterAdapter
          .logoutViJson(
            automation.httpClient,
            connection.baseUrl,
            vi.apiVersion,
            vi.viSessionId
          );
      }

      if (automation) await vcenterAdapter
        .logoutAutomation(
          automation.httpClient,
          automation.sessionId
        );
    }
  }
    async resolveResourceHierarchy({
    vcenterStableId,
    resourceMoid
  } = {}) {
    const base = {
      resourcePool: resourceMoid ? {
        moid: resourceMoid,
        type: 'ResourcePool',
        name: null
      } : null,

      parent: null,
      computeContainer: null,
      displayCandidates: [],

      vcenterStableId:
        vcenterStableId || null,

      vcenterHost: null,
      siteName: null,

      resolutionStatus:
        'NOT_COLLECTED',

      resolutionSource: null
    };

    if (!vcenterStableId) return {
      ...base,
      resolutionStatus:
        'UNMAPPED_VCENTER'
    };

    if (!resourceMoid) return {
      ...base,
      resolutionStatus:
        'CONTRACT_ERROR'
    };

    const key = cacheKey(
      vcenterStableId,
      'RESOURCE_HIERARCHY',
      resourceMoid
    );

    const cached =
      this._readCache(key);

    if (cached) return cached;

    const context =
      await this._findVcenterContext(
        vcenterStableId
      );

    if (!context) return {
      ...base,
      resolutionStatus:
        'UNMAPPED_VCENTER'
    };

    const contextual = {
      ...base,

      vcenterHost:
        context.vcenterHost,

      siteName:
        context.siteName
    };

    try {
      const database =
        await this
          .resourceHierarchyDatabaseLookup(
            context,
            resourceMoid
          );

      let hierarchy =
        database?.found
          ? database.hierarchy
          : null;

      let resolutionSource =
        hierarchy
          ? 'POSTGRESQL_VCENTER_INVENTORY'
          : null;

      if (!hierarchy) {
        hierarchy =
          await this
            .resourceHierarchyApiLookup(
              context,
              resourceMoid
            );

        resolutionSource =
          hierarchy
            ? 'VCENTER_API_READ_ONLY'
            : 'VCENTER_API_READ_ONLY';
      }

      const resolved =
        hierarchy
          ? {
            ...contextual,
            ...hierarchy,

            displayCandidates: [
              hierarchy.computeContainer,
              hierarchy.parent,
              hierarchy.resourcePool
            ].filter(
              candidate =>
                candidate?.name
            ),

            resolutionStatus:
              'RESOLVED',

            resolutionSource
          }
          : {
            ...contextual,

            resolutionStatus:
              'NOT_FOUND',

            resolutionSource
          };

      this._writeCache(
        key,
        resolved
      );

      return resolved;
    } catch (_error) {
      return {
        ...contextual,

        resolutionStatus:
          'NOT_COLLECTED',

        resolutionSource:
          'VCENTER_API_READ_ONLY'
      };
    }
  }
    async resolveVcenterObjects(
    requests = []
  ) {
    const results =
      new Array(requests.length);

    const pendingByContext =
      new Map();

    for (
      let index = 0;
      index < requests.length;
      index += 1
    ) {
      const request =
        requests[index] ||
        {};

      const objectType =
        normalizeObjectType(
          request.objectType
        );

      if (
        !request.vcenterStableId
      ) {
        results[index] = {
          ...this._baseResult(
            request
          ),

          objectType,

          objectNameAvailability:
            'UNMAPPED_VCENTER',

          resolutionStatus:
            'UNMAPPED_VCENTER'
        };

        continue;
      }

      if (
        !request.objectMoid ||
        !objectType ||
        !OBJECT_TYPES[objectType]
      ) {
        results[index] = {
          ...this._baseResult(
            request
          ),

          objectType,

          objectNameAvailability:
            'CONTRACT_ERROR',

          resolutionStatus:
            'CONTRACT_ERROR'
        };

        continue;
      }

      const key = cacheKey(
        request.vcenterStableId,
        objectType,
        request.objectMoid
      );

      const cached =
        this._readCache(key);

      if (cached) {
        results[index] = cached;
        continue;
      }

      const context =
        await this._findVcenterContext(
          request.vcenterStableId
        );

      if (!context) {
        results[index] = {
          ...this._baseResult(
            request
          ),

          objectType,

          objectNameAvailability:
            'UNMAPPED_VCENTER',

          resolutionStatus:
            'UNMAPPED_VCENTER'
        };

        continue;
      }

      const databaseMatch =
        await this._lookupPostgresql(
          context,
          objectType,
          request.objectMoid
        );

      if (
        databaseMatch.found &&
        databaseMatch.name
      ) {
        const resolved = {
          ...this._baseResult(
            {
              ...request,
              objectType
            },
            context
          ),

          objectName:
            databaseMatch.name,

          objectNameAvailability:
            'AVAILABLE',

          objectMetadata:
            databaseMatch.metadata,

          resolutionStatus:
            'RESOLVED',

          resolutionSource:
            'POSTGRESQL_VCENTER_INVENTORY'
        };

        this._writeCache(
          key,
          resolved
        );

        results[index] = resolved;

        continue;
      }

      if (
        databaseMatch.found &&
        !databaseMatch.name
      ) {
        results[index] = {
          ...this._baseResult(
            {
              ...request,
              objectType
            },
            context
          ),

          objectNameAvailability:
            'CONTRACT_ERROR',

          resolutionStatus:
            'CONTRACT_ERROR',

          resolutionSource:
            'POSTGRESQL_VCENTER_INVENTORY'
        };

        continue;
      }

      const groupKey =
        context.connectionId;

      if (
        !pendingByContext.has(
          groupKey
        )
      ) pendingByContext.set(
        groupKey,
        {
          context,
          entries: []
        }
      );

      pendingByContext
        .get(groupKey)
        .entries
        .push({
          index,

          request: {
            ...request,
            objectType
          },

          context,
          key
        });
    }

    for (
      const {
        context,
        entries
      } of pendingByContext.values()
    ) {
      try {
        const apiMatches =
          await this.apiLookup(
            context,

            entries.map(
              entry =>
                entry.request
            )
          );

        for (
          const entry of entries
        ) {
          const match =
            apiMatches.get(
              `${entry.request.objectType}|${entry.request.objectMoid}`
            );

          const resolved =
            match?.name
              ? {
                ...this._baseResult(
                  entry.request,
                  context
                ),

                objectName:
                  match.name,

                objectNameAvailability:
                  'AVAILABLE',

                resolutionStatus:
                  'RESOLVED',

                resolutionSource:
                  'VCENTER_API_READ_ONLY'
              }
              : {
                ...this._baseResult(
                  entry.request,
                  context
                ),

                objectNameAvailability:
                  'NOT_FOUND',

                resolutionStatus:
                  'NOT_FOUND',

                resolutionSource:
                  'VCENTER_API_READ_ONLY'
              };

          this._writeCache(
            entry.key,
            resolved
          );

          results[entry.index] =
            resolved;
        }
      } catch (_error) {
        for (
          const entry of entries
        ) {
          results[entry.index] = {
            ...this._baseResult(
              entry.request,
              context
            ),

            objectNameAvailability:
              'NOT_COLLECTED',

            resolutionStatus:
              'NOT_COLLECTED',

            resolutionSource:
              'VCENTER_API_READ_ONLY'
          };
        }
      }
    }

    return results;
  }
    async resolveVcenterObject(
    request
  ) {
    return (
      await this
        .resolveVcenterObjects([
          request
        ])
    )[0];
  }
}

const service =
  new VcenterObjectResolutionService();

service.VcenterObjectResolutionService =
  VcenterObjectResolutionService;

service.normalizeObjectType =
  normalizeObjectType;

service.parseVmwareObjectIdentity =
  parseVmwareObjectIdentity;

service.selectSrmResourceDisplay =
  hierarchy => {
    if (
      hierarchy
        ?.computeContainer
        ?.name &&
      hierarchy
        .computeContainer
        .rootResourcePoolMoid ===
        hierarchy
          ?.resourcePool
          ?.moid
    ) {
      return {
        name:
          hierarchy
            .computeContainer
            .name,

        type:
          hierarchy
            .computeContainer
            .type,

        resolutionSource:
          'VCENTER_PARENT_COMPUTE_CONTAINER'
      };
    }

    if (
      hierarchy
        ?.resourcePool
        ?.name
    ) {
      return {
        name:
          hierarchy
            .resourcePool
            .name,

        type:
          hierarchy
            .resourcePool
            .type ||
          'ResourcePool',

        resolutionSource:
          hierarchy
            .resolutionSource ||
          'VCENTER_RESOURCE_POOL'
      };
    }

    return {
      name: null,
      type: null,

      resolutionSource:
        hierarchy
          ?.resolutionSource ||
        null
    };
  };

module.exports = service;
