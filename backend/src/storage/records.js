'use strict';

// Plain JavaScript record operations shared by the migrated application callbacks.
// No SQL parser, embedded database or database client is loaded here.
const nullish = v => v === null || v === undefined;
const json = v => typeof v === 'string' ? (() => {
  try {
    return JSON.parse(v);
  } catch {
    return v;
  }
})() : v;
const key = v => JSON.stringify(v, (_, x) => x === undefined ? null : x);
const R = {
  context: outer => ({
    $outer: outer,
    $aliases: []
  }),
  rowContext(row, alias, extras = {}) {
    return {
      $aliases: [alias, ...Object.keys(extras)],
      [alias]: row,
      ...extras
    };
  },
  projectContext(r, value) {
    return {
      ...r,
      $project: value
    };
  },
  ref(r, name, table) {
    if (!r) return null;
    if (table) {
      if (Object.hasOwn(r, table)) return r[table]?.[name] ?? null;
      return R.ref(r.$outer, name, table);
    }
    if (r.$project && Object.hasOwn(r.$project, name)) return r.$project[name];
    for (const a of r.$aliases || []) if (r[a] && Object.hasOwn(r[a], name)) return r[a][name];
    return R.ref(r.$outer, name, null);
  },
  star(r, alias) {
    return alias ? {
      ...(r?.[alias] || {})
    } : Object.assign({}, ...(r?.$aliases || []).map(a => r[a] || {}));
  },
  join(rows, alias, source, on, kind) {
    return rows.flatMap(r => {
      const matches = source(r).map(row => ({
        ...r,
        $aliases: [...(r.$aliases || []), alias],
        [alias]: row
      })).filter(on);
      return matches.length ? matches : kind === 'LEFT JOIN' ? [{
        ...r,
        $aliases: [...(r.$aliases || []), alias],
        [alias]: null
      }] : [];
    });
  },
  binary(op, a, b) {
    if (op === 'AND') return a === false || b === false ? false : nullish(a) || nullish(b) ? null : !!(a && b);
    if (op === 'OR') return a || b ? true : nullish(a) || nullish(b) ? null : false;
    if (nullish(a) || nullish(b)) return null;
    switch (op) {
      case '=':
        return typeof a === 'object' || typeof b === 'object' ? key(a) === key(b) : String(a) === String(b);
      case '!=':
      case '<>':
        return !R.binary('=', a, b);
      case '>':
        return a > b;
      case '<':
        return a < b;
      case '>=':
        return a >= b;
      case '<=':
        return a <= b;
      case '*':
        return Number(a) * Number(b);
      case '+':
        return Number(a) + Number(b);
      case '-':
        return Number(a) - Number(b);
      case '/':
        return Number(a) / Number(b);
      case '||':
        return String(a) + String(b);
      case 'IN':
        return b.some(x => R.binary('=', a, x));
      case 'NOT IN':
        return !b.some(x => R.binary('=', a, x));
      case 'LIKE':
      case 'ILIKE':
        {
          const pattern = String(b).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.');
          return new RegExp('^' + pattern + '$', op === 'ILIKE' ? 'i' : '').test(String(a));
        }
      case '->':
      case '->>':
        return R.member(a, b, op);
      default:
        throw Error('Unknown record comparison ' + op);
    }
  },
  unary(op, a) {
    switch (op) {
      case 'IS NULL':
        return nullish(a);
      case 'IS NOT NULL':
        return !nullish(a);
      case 'NOT':
        return nullish(a) ? null : !a;
      case '-':
        return -a;
      default:
        throw Error('Unknown predicate ' + op);
    }
  },
  quantified(op, a, list, type) {
    return (list || [])[type === 'all' ? 'every' : 'some'](b => R.binary(op, a, b));
  },
  member(a, b, op) {
    const v = json(a)?.[b];
    return nullish(v) ? null : op === '->>' ? typeof v === 'object' ? JSON.stringify(v) : String(v) : v;
  },
  cast(v, t) {
    if (nullish(v)) return null;
    if (t.kind === 'array' || t.arrayOf) return v;
    const n = t.name;
    if (['json', 'jsonb'].includes(n)) return json(v);
    if (['text', 'varchar', 'character varying', 'uuid'].includes(n)) return String(v);
    if (['int', 'integer', 'int4', 'bigint', 'int8', 'numeric', 'real', 'float', 'float8'].includes(n)) return Number(v);
    if (n === 'boolean') return v === true || v === 'true';
    return v;
  },
  fn(name, a) {
    switch (name) {
      case 'coalesce':
        return a.find(x => !nullish(x)) ?? null;
      case 'nullif':
        return R.binary('=', a[0], a[1]) ? null : a[0];
      case 'same_value':
        return nullish(a[0]) && nullish(a[1]) || R.binary('=', ...a) === true;
      case 'different_value':
        return !R.fn('same_value', a);
      case 'lower':
        return nullish(a[0]) ? null : String(a[0]).toLowerCase();
      case 'upper':
        return nullish(a[0]) ? null : String(a[0]).toUpperCase();
      case 'split_part':
        return nullish(a[0]) ? null : String(a[0]).split(a[1])[Number(a[2]) - 1] || '';
      case 'replace':
        return nullish(a[0]) ? null : String(a[0]).split(a[1]).join(a[2]);
      case 'jsonb_build_object':
        return Object.fromEntries(a.flatMap((x, i) => i % 2 ? [] : [[x, a[i + 1]]]));
      case 'hashtextextended':
        return a[0];
      case 'unnest':
        return {
          $expand: a[0] || []
        };
      default:
        throw Error('Unknown record operation ' + name);
    }
  },
  aggregate(name, values, distinct, delimiter) {
    if (distinct) values = R.unique(values);
    const v = values.filter(x => !nullish(x));
    switch (name) {
      case 'count':
        return v.length;
      case 'sum':
        return v.length ? v.reduce((a, b) => a + Number(b), 0) : null;
      case 'min':
        return v.length ? v.reduce((a, b) => a < b ? a : b) : null;
      case 'max':
        return v.length ? v.reduce((a, b) => a > b ? a : b) : null;
      case 'bool_and':
        return v.length ? v.every(Boolean) : null;
      case 'bool_or':
        return v.length ? v.some(Boolean) : null;
      case 'array_agg':
      case 'json_agg':
      case 'jsonb_agg':
        return values.length ? values : null;
      case 'string_agg':
        return v.length ? v.join(delimiter ?? ',') : null;
      default:
        throw Error('Unknown aggregation ' + name);
    }
  },
  groups(rows, fn) {
    if (!fn) return [rows];
    const groups = new Map();
    for (const r of rows) {
      const k = key(fn(r));
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(r);
    }
    return [...groups.values()];
  },
  unique(rows, fn = x => x) {
    const seen = new Set();
    return rows.filter(x => {
      const k = key(fn(x));
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  },
  order(parts) {
    for (const [a, b, dir, nulls] of parts) {
      if (nullish(a) && nullish(b)) continue;
      const first = nulls ? nulls === 'FIRST' : dir === 'DESC';
      if (nullish(a)) return first ? -1 : 1;
      if (nullish(b)) return first ? 1 : -1;
      if (a < b) return dir === 'DESC' ? 1 : -1;
      if (a > b) return dir === 'DESC' ? -1 : 1;
    }
    return 0;
  },
  expand(row) {
    const expanded = Object.values(row).filter(v => v && typeof v === 'object' && Object.hasOwn(v, '$expand'));
    if (!expanded.length) return [row];
    const count = Math.max(...expanded.map(v => v.$expand.length));
    return Array.from({
      length: count
    }, (_, i) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, v && Object.hasOwn(v, '$expand') ? v.$expand[i] ?? null : v])));
  },
  scalar(rows) {
    if (rows.length > 1) throw Error('Expected one record');
    return rows[0] ? Object.values(rows[0])[0] : null;
  },
  result: rows => ({
    rows,
    rowCount: rows.length
  }),
  changed: rowCount => ({
    rows: [],
    rowCount
  })
};
module.exports = R;
