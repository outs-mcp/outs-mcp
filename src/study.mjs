// get_study: the published OUTS study (the site's /research/*.json files), cut into parts an AI can read in one go.
// Ranges are written as { est, lo, hi }: the estimate and its 95% range. AUC 0.5 is a coin flip.

export const STUDY_FILES = {
  current: '/research/explore.json', // the latest pre-registered round
  v1: '/research/explore-v1.json', // round 1: $1M runners
  alpha: '/research/alpha-study.json', // alpha wallets
  exits: '/research/exits.json', // exit rules and costs (published when that study is done)
};
export const STUDY_PARTS = ['summary', 'rounds', 'exits', 'limits'];
/** The files each part reads (missing files are skipped). */
export const FILES_FOR = {
  summary: ['current', 'v1'],
  rounds: ['current', 'v1', 'alpha', 'exits'],
  exits: ['exits'],
  limits: ['current', 'v1', 'exits'],
};

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const strings = (v, max = 20) => (Array.isArray(v) ? v.filter((s) => typeof s === 'string').slice(0, max) : undefined);
/** [estimate, low, high] → { est, lo, hi }; anything else stays out. */
const range = (v) => (Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === 'number') ? { est: v[0], lo: v[1], hi: v[2] } : undefined);
const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null));

/** Held-out AUC ranges per model: { name, label, auc1: { est, lo, hi }, ... }. */
function models(doc) {
  if (!Array.isArray(doc?.models)) return undefined;
  return doc.models.slice(0, 8).map((m) => {
    const out = { name: m?.name, label: m?.label };
    for (const [k, v] of Object.entries(m?.test ?? {})) if (/^auc\w*$/.test(k) && range(v)) out[k] = range(v);
    return clean(out);
  });
}

function verdict(doc) {
  const r = doc?.shipRule;
  if (!isObj(r)) return undefined;
  return clean({
    model: r.primary,
    ship: typeof r.ship === 'boolean' ? r.ship : undefined,
    aucHeldOut: range(r.auc5 ?? r.auc1 ?? r.auc),
    liftTop10: range(r.lift5Top10 ?? r.lift1Top10 ?? r.liftTop10),
    needAucLow: r.needAucLo,
    needLiftLow: r.needLift10Lo,
  });
}

function dataOf(d) {
  if (!isObj(d)) return undefined;
  return clean({
    launches: d.launches,
    graduates: d.graduates,
    coins: d.population,
    days: d.days,
    from: d.from,
    to: d.to,
    heldOut: clean({ from: d.testFrom, to: d.testTo, coins: d.nTest }),
  });
}

/** A document of unknown shape (a new study), kept small: scalars, string lists and small objects, lists ≤ 50. */
export function brief(doc, budget = 20_000) {
  if (!isObj(doc)) return undefined;
  const out = {};
  for (const [k, v] of Object.entries(doc)) {
    if (v === null || typeof v !== 'object') out[k] = v;
    else if (Array.isArray(v)) out[k] = v.slice(0, 50);
    else out[k] = v;
  }
  const omitted = [];
  const size = () => JSON.stringify(out).length;
  while (size() > budget) {
    const big = Object.entries(out)
      .filter(([, v]) => v && typeof v === 'object')
      .map(([k, v]) => [k, JSON.stringify(v).length])
      .sort((a, b) => b[1] - a[1])[0];
    if (!big) break;
    delete out[big[0]];
    omitted.push(big[0]);
  }
  if (omitted.length) out.omitted = omitted;
  return out;
}

/**
 * One part of the study from the fetched files.
 * docs: { current, v1, alpha, exits } (null when a file is not published); src: name → public URL; rules: GET /api/v1/rules or null.
 */
export function studyPart(part, docs, { src = {}, rules = null } = {}) {
  const { current, v1, alpha, exits } = docs;
  if (part === 'summary') {
    if (!current) return { part, published: false, note: `The study is not published at ${src.current ?? 'this OUTS site'} yet.` };
    return clean({
      part,
      asOf: current.asOf,
      question: current.method?.target,
      data: dataOf(current.data),
      verdict: verdict(current),
      models: models(current),
      findings: strings(current.findings),
      before: current.v1?.summary ?? (v1 ? strings(v1.findings, 1)?.[0] : undefined),
      source: src.current,
      sources: clean({ round1: v1 ? src.v1 : undefined }),
    });
  }
  if (part === 'rounds') {
    const rounds = [];
    if (v1) rounds.push(clean({ round: 'round 1', version: v1.version, question: v1.method?.labels, asOf: v1.asOf, models: models(v1), summary: current?.v1?.summary ?? strings(v1.findings, 1)?.[0], source: src.v1 }));
    if (current) rounds.push(clean({ round: 'latest', version: current.version, question: current.method?.target, asOf: current.asOf, verdict: verdict(current), models: models(current), summary: strings(current.findings, 3), source: src.current }));
    if (alpha) {
      rounds.push(
        clean({
          round: 'alpha wallets',
          version: alpha.version,
          status: alpha.status,
          heldOut: isObj(alpha.heldout) ? clean({ coins: alpha.heldout.coins, auc: alpha.heldout.auc, aucRange: alpha.heldout.auc_ci95, verdict: alpha.heldout.verdict }) : undefined,
          allDays: isObj(alpha.allDaysLODO) ? clean({ coins: alpha.allDaysLODO.coins, auc: alpha.allDaysLODO.auc, aucRange: alpha.allDaysLODO.auc_ci95, verdict: alpha.allDaysLODO.verdict }) : undefined,
          source: src.alpha,
        }),
      );
    }
    if (exits) rounds.push(clean({ round: 'exits', version: exits.version, asOf: exits.asOf, question: exits.question ?? exits.method?.question, verdict: exits.verdict ?? exits.status, summary: strings(exits.findings, 3), source: src.exits }));
    return { part, rounds };
  }
  if (part === 'exits') {
    const inForce = isObj(rules) ? clean({ costs: rules.costs, exits: rules.exits }) : undefined;
    if (!exits) {
      return clean({
        part,
        published: false,
        note: 'The exits study (exit rules and costs) is not published yet. inForce shows the costs and the house exit that grade every paper trade now.',
        inForce,
      });
    }
    const { part: _p, published: _u, inForce: _i, source: _s, ...rest } = brief(exits);
    return clean({ part, published: true, ...rest, inForce, source: src.exits });
  }
  if (part === 'limits') {
    return clean({ part, latest: strings(current?.limits), round1: strings(v1?.limits), exits: strings(exits?.limits), source: src.current });
  }
  throw new RangeError(`part must be one of ${STUDY_PARTS.join(', ')}`);
}
