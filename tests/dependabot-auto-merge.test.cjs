const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const workflow = fs.readFileSync('.github/workflows/dependabot-auto-merge.yml', 'utf8');
const scripts = [...workflow.matchAll(/          script: \|\n((?:            [^\n]*\n|\n)*)/g)]
  .map(match => match[1].split('\n').map(line => line.slice(12)).join('\n'));
assert.equal(scripts.length, 2);
const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
const execute = new AsyncFunction('github', 'context', 'core', scripts[0]);
const merge = new AsyncFunction('github', 'context', 'core', 'process', scripts[1]);

async function scenario(change = () => {}) {
  const fullName = 'monitoring-forge/flagrun';
  const run = {id: 1, workflow_id: 2, run_attempt: 1, status: 'completed', conclusion: 'success',
    event: 'push', head_sha: 'tested', head_branch: 'dependabot/github_actions/dependencies-123',
    head_repository: {full_name: fullName}, path: '.github/workflows/test.yml'};
  const pr = {number: 34, user: {login: 'dependabot[bot]'}, draft: false, changed_files: 1,
    head: {sha: 'tested', ref: run.head_branch, repo: {full_name: fullName}}, base: {ref: 'main', sha: 'base'}};
  const state = {run, eventRun: {...run}, pr, latest: {...run},
    files: [{filename: '.github/workflows/tagpr.yml', status: 'modified'}],
    before: 'steps:\n  - uses: Songmu/tagpr@old # v1\n    env:\n      TOKEN: example\n',
    after: 'steps:\n  - uses: Songmu/tagpr@new # v2\n    env:\n      TOKEN: example\n',
    repository: {mergeCommitAllowed: true, squashMergeAllowed: true, rebaseMergeAllowed: true}, merged: []};
  change(state);
  const github = {rest: {
    actions: {getWorkflowRun: async () => ({data: state.run}), listWorkflowRuns: 'runs'},
    pulls: {list: 'prs', listFiles: 'files', get: async () => ({data: state.pr}),
      merge: async args => {state.merged.push(args); return {data: {merged: true, sha: 'merged'}};}},
    repos: {get: async () => ({data: {}}), getContent: async args => ({data: {
      type: 'file', encoding: 'base64', content: Buffer.from(args.ref === 'base' ? state.before : state.after).toString('base64'),
    }})},
  }, graphql: async (query, variables) => {
    if (state.graphql) return state.graphql(query, variables);
    return {repository: state.repository};
  }, paginate: async (method) => ({runs: [state.latest], prs: [state.pr], files: state.files})[method]};
  const context = {repo: {owner: 'monitoring-forge', repo: 'flagrun'},
    payload: {workflow_run: state.eventRun, repository: {default_branch: 'main'}}};
  const outputs = {};
  const core = {info() {}, setOutput(key, value) {outputs[key] = String(value);}};
  const appGithub = {rest: {pulls: {merge: github.rest.pulls.merge}}};
  github.rest.pulls.merge = async () => {throw new Error('Default token must not merge');};
  await execute(github, context, core);
  if (outputs['pull-number']) {
    await merge(appGithub, context, core, {env: {
      PR_NUMBER: outputs['pull-number'], HEAD_SHA: outputs['head-sha'], MERGE_METHOD: outputs['merge-method'],
    }});
  }
  return state.merged;
}
test('tagpr-only grouped update merges exactly the tested SHA', async () => {
  const [merge] = await scenario();
  assert.equal(merge.sha, 'tested'); assert.equal(merge.pull_number, 34); assert.equal(merge.merge_method, 'merge');
});
test('pull_request CI and squash-only repositories are supported', async () => {
  const [merge] = await scenario(s => {s.run.event = 'pull_request'; s.run.path = '.github/workflows/ci.yml';
    s.repository = {mergeCommitAllowed: false, squashMergeAllowed: true, rebaseMergeAllowed: false};});
  assert.equal(merge.merge_method, 'squash');
});
for (const [name, change] of Object.entries({
  'failed tests': s => {s.run.conclusion = 'failure';},
  'pending rerun': s => {s.run.status = 'in_progress';},
  'stale attempt': s => {s.run.run_attempt = 2;},
  'unrelated workflow': s => {s.run.path = '.github/workflows/tagpr.yml';},
  'untrusted event': s => {s.run.event = 'workflow_dispatch';},
  'fork run': s => {s.run.head_repository = {full_name: 'other/flagrun'};},
  'human author': s => {s.pr.user.login = 'human';},
  'draft': s => {s.pr.draft = true;},
  'fork PR': s => {s.pr.head.repo.full_name = 'other/flagrun';},
  'new head after testing': s => {s.pr.head.sha = 'untested';},
  'non-default base': s => {s.pr.base.ref = 'other';},
  'additional dependency': s => {s.before += '  - uses: actions/checkout@old\n'; s.after += '  - uses: actions/checkout@new\n';},
  'changed executable content': s => {s.after += '  - run: echo unsafe\n';},
  'indentation change': s => {s.after = s.after.replace('  - uses:', '    - uses:');},
  'non-workflow file': s => {s.files[0].filename = 'go.mod';},
  'renamed file': s => {s.files[0].status = 'renamed';},
  'truncated file list': s => {s.pr.changed_files = 2;},
  'empty diff': s => {s.files = []; s.pr.changed_files = 0;},
  'newer test run': s => {s.latest.id = 2;},
  'latest failed': s => {s.latest.conclusion = 'failure';},
  'latest pending': s => {s.latest.status = 'in_progress';},
  'latest attempt changed': s => {s.latest.run_attempt = 2;},
})) test(`does not merge: ${name}`, async () => assert.deepEqual(await scenario(change), []));

test('rebase-only repositories are supported', async () => {
  const [merge] = await scenario(s => {s.repository = {
    mergeCommitAllowed: false, squashMergeAllowed: false, rebaseMergeAllowed: true,
  };});
  assert.equal(merge.merge_method, 'rebase');
});
test('missing settings are not treated as disabled', async () => {
  await assert.rejects(scenario(s => {s.repository = {};}), /Could not determine enabled merge methods/);
});
test('explicitly disabled methods stop the merge', async () => {
  await assert.rejects(scenario(s => {s.repository = {
    mergeCommitAllowed: false, squashMergeAllowed: false, rebaseMergeAllowed: false,
  };}), /No merge method is enabled/);
});
test('read-only GITHUB_TOKEN can query merge methods', {skip: !process.env.MERGE_SETTINGS_TOKEN}, async () => {
  await scenario(s => {s.graphql = async (query) => {
    const [owner, repo] = process.env.GITHUB_REPOSITORY.split('/');
    const response = await fetch('https://api.github.com/graphql', {
      method: 'POST',
      headers: {Authorization: `Bearer ${process.env.MERGE_SETTINGS_TOKEN}`, 'Content-Type': 'application/json'},
      body: JSON.stringify({query, variables: {owner, repo}}),
    });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.errors, undefined);
    return result.data;
  };});
});
