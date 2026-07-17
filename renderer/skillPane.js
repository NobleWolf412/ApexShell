// Apex — the SKILLS dock pane. Author Claude Code skills (personal or per-repo),
// promote persona recipes into skills, and see what's installed. Projection of
// main/skills.js.
'use strict';
(function () {
  const pane = document.getElementById('dock-skills');
  const formEl = pane.querySelector('.skForm');
  const recipesEl = pane.querySelector('.skRecipes');
  const installedEl = pane.querySelector('.skInstalled');

  let projectRepo = null;   // chosen repo for project-scope skills

  formEl.innerHTML =
    '<div class="skFormHead">CREATE A SKILL</div>' +
    '<p class="skFormHelp">A skill is a reusable capability your persona seats invoke on their own — the description tells Claude when to use it.</p>' +
    '<div class="skRow">' +
      '<select class="skScope"><option value="personal">Personal (all seats)</option>' +
        '<option value="project">Project (one repo)</option></select>' +
      '<button class="skRepo" type="button" hidden>pick repo…</button>' +
      '<span class="skRepoName"></span></div>' +
    '<input class="skName" type="text" maxlength="64" placeholder="skill-name (lowercase-kebab)">' +
    '<textarea class="skDesc" maxlength="1024" placeholder="When should Claude use this? (this drives auto-invocation)"></textarea>' +
    '<textarea class="skBody" placeholder="Instructions / steps (optional)"></textarea>' +
    '<div class="skRow skFormFoot"><button class="skCreate" type="button">CREATE SKILL</button></div>';
  const scopeSel = formEl.querySelector('.skScope');
  const repoBtn = formEl.querySelector('.skRepo');
  const repoName = formEl.querySelector('.skRepoName');
  const nameIn = formEl.querySelector('.skName');
  const descIn = formEl.querySelector('.skDesc');
  const bodyIn = formEl.querySelector('.skBody');

  const repoBase = (p) => (p.split(/[\\/]/).filter(Boolean).pop() || p);
  function syncScope() {
    const project = scopeSel.value === 'project';
    repoBtn.hidden = !project;
    repoName.textContent = project && projectRepo ? repoBase(projectRepo) : '';
    repoName.title = project && projectRepo ? projectRepo : '';
  }
  scopeSel.onchange = () => { syncScope(); ApexBus.post('skillList', { repo: projectRepo }); };
  repoBtn.onclick = () => ApexBus.post('skillPickRepo', {});
  formEl.querySelector('.skCreate').onclick = () => {
    ApexBus.post('skillCreate', {
      scope: scopeSel.value, repo: projectRepo,
      name: nameIn.value, description: descIn.value, body: bodyIn.value,
    });
  };

  function renderRecipes(m) {
    recipesEl.textContent = '';
    const recipes = (m && m.recipes) || [];
    if (!recipes.length) return;
    const head = document.createElement('div');
    head.className = 'skSubHead';
    head.textContent = 'PROMOTE A RECIPE → SKILL';
    recipesEl.appendChild(head);
    for (const r of recipes) {
      const row = document.createElement('div');
      row.className = 'skRecipeRow';
      const txt = document.createElement('div');
      txt.className = 'skRecipeText';
      txt.textContent = r.name + '  ·  ' + r.persona;
      if (r.preview) { const p = document.createElement('div'); p.className = 'skRecipePrev'; p.textContent = r.preview; txt.appendChild(p); }
      row.appendChild(txt);
      const use = document.createElement('button');
      use.type = 'button'; use.textContent = 'draft skill';
      use.title = 'prefill the form from this recipe';
      use.onclick = () => {
        nameIn.value = r.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 64);
        descIn.value = 'Use when ' + r.name.replace(/-/g, ' ') + '. ' + (r.preview || '').split('\n')[0];
        bodyIn.value = r.preview || '';
        nameIn.focus();
      };
      row.appendChild(use);
      recipesEl.appendChild(row);
    }
  }

  function renderInstalled(m) {
    installedEl.textContent = '';
    const groups = [['Personal', m.personal || []]];
    if (m.repo) groups.push([repoBase(m.repo) + ' (project)', m.project || []]);
    for (const [label, list] of groups) {
      const head = document.createElement('div');
      head.className = 'skSubHead';
      head.textContent = label.toUpperCase() + ' · ' + list.length;
      installedEl.appendChild(head);
      if (!list.length) {
        const n = document.createElement('div'); n.className = 'skEmpty';
        n.textContent = 'none yet';
        installedEl.appendChild(n);
        continue;
      }
      for (const s of list) {
        const row = document.createElement('div');
        row.className = 'skInstRow';
        const name = document.createElement('div'); name.className = 'skInstName'; name.textContent = s.name;
        const desc = document.createElement('div'); desc.className = 'skInstDesc'; desc.textContent = s.description || '(no description)';
        const open = document.createElement('button');
        open.type = 'button'; open.textContent = 'open'; open.title = s.path;
        open.onclick = () => ApexBus.post('openPath', { path: s.path });
        const meta = document.createElement('div'); meta.className = 'skInstText'; meta.append(name, desc);
        row.append(meta, open);
        installedEl.appendChild(row);
      }
    }
  }

  ApexBus.on('skillList', renderInstalled);
  ApexBus.on('skillRecipes', renderRecipes);
  ApexBus.on('skillRepoPicked', (m) => { projectRepo = m.path; scopeSel.value = 'project'; syncScope(); ApexBus.post('skillList', { repo: projectRepo }); });
  ApexBus.on('skillCreated', (m) => {
    if (m.ok) { nameIn.value = ''; descIn.value = ''; bodyIn.value = ''; }
  });

  syncScope();
  ApexBus.post('skillList', {});
  ApexBus.post('skillRecipes', {});
})();
