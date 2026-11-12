const {
  pool
} = require('../../db');

const gateway =
  require('./srm-write-gateway');

const journal =
  require('../repositories/srm-write.repository');

const {
  SafetyError
} = require('./srm-write-engine');

const id = v => {
  if (
    typeof v !== 'string' ||
    !v.length ||
    v.length > 512 ||
    /[\x00-\x1f]/.test(v)
  ) throw new SafetyError(
    'INVALID_STABLE_ID'
  );

  return v;
};

const objectName = value => {
  if (
    typeof value !== 'string'
  ) throw new SafetyError(
    'NAME_LENGTH_INVALID'
  );

  const normalized =
    value.trim();

  if (
    !normalized ||
    normalized.length > 80
  ) throw new SafetyError(
    'NAME_LENGTH_INVALID'
  );

  if (
    !/^[\p{L}\p{M}\p{N} _.-]+$/u
      .test(normalized)
  ) throw new SafetyError(
    'NAME_CHARACTERS_INVALID'
  );

  return normalized;
};

const keys = (
  v,
  allowed
) => {
  if (
    !v ||
    typeof v !== 'object' ||
    Array.isArray(v) ||
    Object.keys(v).some(
      k => !allowed.includes(k)
    )
  ) throw new SafetyError(
    'UNEXPECTED_INTENT_FIELD'
  );
};

function normalize(
  kind,
  action,
  objectId,
  body
) {
  keys(
    body,
    [
      'pairId',
      'action',
      'vmId',
      'protectionGroupId',
      'name',
      'description',
      'memberIds',
      'mappingType',
      'sourceObject',
      'targetObject',
      'expected',
      'confirmed'
    ]
  );

  if (
    body.confirmed !== true
  ) throw new SafetyError(
    'CONFIRMATION_REQUIRED'
  );

  const pairId =
    Number(body.pairId);

  if (
    !Number.isSafeInteger(pairId) ||
    pairId < 1
  ) throw new SafetyError(
    'PAIR_ID_REQUIRED'
  );

  const intent = {
    kind,
    action,
    pairId,

    ...(
      objectId
        ? {
          objectId: id(objectId)
        }
        : {}
    )
  };

  if (
    ![
      'pg',
      'rp',
      'mapping'
    ].includes(kind) ||
    ![
      'create',
      'edit',
      'delete',
      'members',
      'replace'
    ].includes(action)
  ) throw new SafetyError(
    'UNSUPPORTED_INTENT'
  );

  if (kind === 'mapping') {
    if (
      ![
        'networks',
        'folders',
        'resources',
        'storage-policies'
      ].includes(body.mappingType)
    ) throw new SafetyError(
      'MAPPING_TYPE_INVALID'
    );

    intent.mappingType =
      body.mappingType;

    if (
      action !== 'delete'
    ) Object.assign(
      intent,
      {
        sourceObject:
          id(body.sourceObject),

        targetObject:
          id(body.targetObject)
      }
    );

    if (
      action !== 'create'
    ) {
      keys(
        body.expected,
        [
          'sourceObject',
          'targetObject'
        ]
      );

      intent.expected = {
        sourceObject:
          id(
            body.expected
              .sourceObject
          ),

        targetObject:
          id(
            body.expected
              .targetObject
          )
      };
    }
  } else if (
    action === 'members'
  ) {
    if (
      ![
        'add',
        'remove'
      ].includes(body.action)
    ) throw new SafetyError(
      'MEMBERSHIP_ACTION_INVALID'
    );

    if (
      body.memberIds
    ) throw new SafetyError(
      'MEMBERSHIP_REQUIRES_INTENT_NOT_LIST'
    );

    intent.memberAction =
      body.action;

    intent.memberId = id(
      kind === 'pg'
        ? body.vmId
        : body.protectionGroupId
    );
  } else if (
    [
      'create',
      'edit'
    ].includes(action)
  ) {
    const normalizedName =
      objectName(body.name);

    if (
      body.description !==
        undefined &&
      (
        typeof body.description !==
          'string' ||
        body.description.length >
          4096
      )
    ) throw new SafetyError(
      'DESCRIPTION_LENGTH_INVALID'
    );

    intent.changes = {
      name: normalizedName,

      ...(
        body.description !==
          undefined
          ? {
            description:
              body.description
          }
          : {}
      )
    };

    if (action === 'create') {
      if (
        !Array.isArray(
          body.memberIds
        ) ||
        body.memberIds.length >
          1000
      ) throw new SafetyError(
        'CREATE_MEMBER_IDS_REQUIRED'
      );

      intent.changes = {
        ...intent.changes,

        description:
          body.description ||
          '',

        members: [
          ...new Set(
            body.memberIds.map(id)
          )
        ].sort(),

        type:
          kind === 'pg'
            ? 'HBR'
            : null
      };
    } else if (
      body.memberIds
    ) throw new SafetyError(
      'EDIT_MEMBERSHIP_REQUIRES_INTENT'
    );
  }

  return intent;
}
async function submit(kind, action, objectId, body, user, requestId, key) {
  if (!['ADMIN', 'OPERATOR'].includes(user?.role) || action === 'delete' && user.role !== 'ADMIN' || kind === 'mapping' && action === 'replace' && user.role !== 'ADMIN') throw new SafetyError('FORBIDDEN');

  if (typeof key !== 'string' || key.length < 8 || key.length > 128) throw new SafetyError('IDEMPOTENCY_KEY_REQUIRED');

  const finalKey = key;

  const intent = normalize(kind, action, objectId, body),
    x = await gateway.context(intent.pairId);

  intent.scopeIdentity = x.identity;

  if (action === 'create' && kind !== 'mapping') intent.changes.source = x.p.local_vcenter_id;

  // The durable guard is scoped to the affected object. This keeps duplicate
  // writes to one VMware object serialized while allowing independent objects
  // in the same site pair to be accepted and processed concurrently.
  const resource = intent.objectId
    || (kind === 'mapping' ? `${intent.mappingType}:${intent.sourceObject || intent.expected?.sourceObject}` : intent.changes?.name)
    || finalKey;

  return journal.safe(
    await journal.reserve(
      intent,
      user,
      requestId,
      finalKey,
      `${x.scope}:${kind}:${resource}`
    )
  );
}

async function legacyPair(objectId) {
  const {
    rows
  } = await pool.run((s, p) => {
    const R = s.helpers;
    const views = {};

    return R.result((parent => {
      let rows = [R.context(parent)];

      rows = R.join(
        rows,
        "p",
        r => views["current_srm_site_pairs"] || s.read("current_srm_site_pairs"),
        r => true,
        "INNER JOIN"
      );

      rows = R.join(
        rows,
        "g",
        r => views["current_srm_protection_groups"] || s.read("current_srm_protection_groups"),
        r => R.binary(
          "AND",
          R.binary(
            "AND",
            R.binary(
              "=",
              R.ref(r, "connection_id", "g"),
              R.ref(r, "connection_id", "p")
            ),
            R.binary(
              "=",
              R.ref(r, "pairing_id", "g"),
              R.ref(r, "pairing_id", "p")
            )
          ),
          R.binary(
            "=",
            R.ref(r, "source_vcenter_id", "g"),
            R.ref(r, "local_vcenter_id", "p")
          )
        ),
        "INNER JOIN"
      );

      rows = rows.filter(r =>
        R.binary(
          "=",
          R.ref(r, "protection_group_id", "g"),
          p[0]
        )
      );

      let groups = rows.map(r => [r]);

      let result = groups.flatMap(g => {
        const r = g[0] || R.context(parent);

        return R.expand({
          "id": R.ref(r, "id", "p")
        }).map(value => ({
          value,
          r: R.projectContext(r, value),
          g
        }));
      });

      result = R.unique(
        result,
        x => x.value
      );

      return result.slice(0).map(x => x.value);
    })(null));
  }, [objectId], false);

  if (rows.length === 1) return rows[0].id;

  throw new SafetyError('PG_PAIR_AMBIGUOUS');
}

async function legacyMappingPair(mappingId) {
  if (!mappingId) return null;

  const cleanId = String(mappingId).includes(':')
    ? String(mappingId).split(':').pop()
    : String(mappingId);

  const {
    rows
  } = await pool.run((s, p) => {
    const R = s.helpers;
    const views = {};

    return R.result((parent => {
      let rows = [R.context(parent)];

      rows = R.join(
        rows,
        "p",
        r => views["current_srm_site_pairs"] || s.read("current_srm_site_pairs"),
        r => true,
        "INNER JOIN"
      );

      rows = R.join(
        rows,
        "m",
        r => views["current_srm_inventory_mappings"] || s.read("current_srm_inventory_mappings"),
        r => R.binary(
          "AND",
          R.binary(
            "=",
            R.ref(r, "connection_id", "m"),
            R.ref(r, "connection_id", "p")
          ),
          R.binary(
            "=",
            R.ref(r, "pairing_id", "m"),
            R.ref(r, "pairing_id", "p")
          )
        ),
        "INNER JOIN"
      );

      rows = rows.filter(r =>
        R.binary(
          "=",
          R.ref(r, "mapping_id", "m"),
          p[0]
        )
      );

      let groups = rows.map(r => [r]);

      let result = groups.flatMap(g => {
        const r = g[0] || R.context(parent);

        return R.expand({
          "id": R.ref(r, "id", "p")
        }).map(value => ({
          value,
          r: R.projectContext(r, value),
          g
        }));
      });

      result = R.unique(
        result,
        x => x.value
      );

      return result.slice(0).map(x => x.value);
    })(null));
  }, [cleanId], false);

  if (rows.length === 1) return rows[0].id;

  return null;
}

module.exports = {
  normalize,
  submit,
  legacyPair,
  legacyMappingPair
};
