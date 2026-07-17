import { STATUSES, createJob, getStats, moveJobStatus, sortJobs, updateJob } from './src/jobTracker.js';

const API_BASE = '/api/applications';
// Legacy localStorage key. No longer the source of truth — read-only, for the
// one-time "import my existing entries" action below.
const LEGACY_STORAGE_KEY = 'application-tracker-jobs';
const LEGACY_IMPORTED_FLAG = 'application-tracker-imported-to-d1';

const form = document.querySelector('#job-form');
const statsContainer = document.querySelector('#stats');
const pipelineContainer = document.querySelector('#pipeline');
const apiErrorBanner = document.querySelector('#api-error');
const importPanel = document.querySelector('#import-panel');
const importButton = document.querySelector('#import-local');
const importStatus = document.querySelector('#import-status');

const jobModal = document.querySelector('#job-modal');
const jobModalTitle = document.querySelector('#job-modal-title');
const jobModalCloseButton = document.querySelector('#job-modal-close');
const jobCancelButton = document.querySelector('#job-cancel');
const newApplicationButton = document.querySelector('#new-application-button');

const materialsModal = document.querySelector('#materials-modal');
const materialsModalCloseButton = document.querySelector('#materials-modal-close');
const materialsCloseButton = document.querySelector('#materials-close');
const materialsSubtitle = document.querySelector('#materials-subtitle');
const materialsList = document.querySelector('#materials-list');

let jobs = [];
let editingJobId = null;

// --- API client + camelCase (UI) <-> snake_case (D1) mapping ---
// The mapping lives here, not in src/jobTracker.js, which stays pure UI-agnostic logic.

function toApiPayload(job) {
  return {
    company: job.company,
    role: job.role,
    status: job.status,
    applied_date: job.appliedDate || null,
    deadline: job.deadline || null,
    pay: job.pay || null,
    link: job.link || null,
    notes: job.notes || null,
    jd_text: job.jobDescription || null,
  };
}

function fromApiRow(row) {
  return {
    id: row.id,
    company: row.company,
    role: row.role,
    status: row.status,
    appliedDate: row.applied_date || '',
    deadline: row.deadline || '',
    pay: row.pay || '',
    link: row.link || '',
    notes: row.notes || '',
    jobDescription: row.jd_text || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function apiListJobs() {
  const response = await fetch(API_BASE);
  if (!response.ok) {
    throw new Error(`GET ${API_BASE} failed: ${response.status}`);
  }
  const data = await response.json();
  return (data.applications || []).map(fromApiRow);
}

async function apiCreateJob(job) {
  const response = await fetch(API_BASE, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(toApiPayload(job)),
  });
  if (!response.ok) {
    throw new Error(`POST ${API_BASE} failed: ${response.status}`);
  }
  const data = await response.json();
  return fromApiRow(data.application);
}

async function apiUpdateJob(id, patch) {
  const response = await fetch(`${API_BASE}/${id}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!response.ok) {
    throw new Error(`PUT ${API_BASE}/${id} failed: ${response.status}`);
  }
  const data = await response.json();
  return fromApiRow(data.application);
}

async function apiDeleteJob(id) {
  const response = await fetch(`${API_BASE}/${id}`, { method: 'DELETE' });
  if (!response.ok) {
    throw new Error(`DELETE ${API_BASE}/${id} failed: ${response.status}`);
  }
}

async function apiListMaterials(applicationId) {
  const response = await fetch(`/api/materials?application_id=${encodeURIComponent(applicationId)}`);
  if (!response.ok) {
    throw new Error(`GET /api/materials failed: ${response.status}`);
  }
  const data = await response.json();
  return data.materials || [];
}

// Records intent only (an activity row) — never calls an LLM. The real tailoring
// happens in the SamOS career-manager, which publishes materials back here.
async function apiRequestTailorIntent(applicationId) {
  const response = await fetch('/api/tailor-intent', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ application_id: applicationId }),
  });
  if (!response.ok) {
    throw new Error(`POST /api/tailor-intent failed: ${response.status}`);
  }
}

function showApiError(message = "Can't reach the server. Your change wasn't saved — check your connection and try again.") {
  if (!apiErrorBanner) return;
  apiErrorBanner.textContent = message;
  apiErrorBanner.classList.remove('hidden');
}

function clearApiError() {
  apiErrorBanner?.classList.add('hidden');
}

// --- One-time import of legacy localStorage jobs into D1 ---

function getLegacyJobs() {
  try {
    const stored = window.localStorage.getItem(LEGACY_STORAGE_KEY);
    const parsed = stored ? JSON.parse(stored) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error('Unable to read legacy jobs', error);
    return [];
  }
}

function maybeShowImportPanel() {
  if (!importPanel) return;
  const alreadyImported = window.localStorage.getItem(LEGACY_IMPORTED_FLAG) === 'true';
  const legacyJobs = getLegacyJobs();
  importPanel.classList.toggle('hidden', alreadyImported || legacyJobs.length === 0);
}

importButton?.addEventListener('click', async () => {
  const legacyJobs = getLegacyJobs();
  importButton.disabled = true;
  importStatus.textContent = 'Importing…';

  let importedCount = 0;
  try {
    for (const legacyJob of legacyJobs) {
      const created = await apiCreateJob(legacyJob);
      jobs = [created, ...jobs];
      importedCount += 1;
    }
    window.localStorage.setItem(LEGACY_IMPORTED_FLAG, 'true');
    importStatus.textContent = `Imported ${importedCount} application${importedCount === 1 ? '' : 's'}.`;
    importButton.classList.add('hidden');
    clearApiError();
    render();
  } catch (error) {
    showApiError();
    importStatus.textContent = `Imported ${importedCount} of ${legacyJobs.length} before losing the connection. Try again.`;
  } finally {
    importButton.disabled = false;
  }
});

async function loadJobsFromServer() {
  try {
    jobs = await apiListJobs();
    clearApiError();
  } catch (error) {
    console.error('Unable to load applications', error);
    jobs = [];
    showApiError("Can't reach the server. Applications can't be loaded right now.");
  }
  maybeShowImportPanel();
  render();
}

// --- Modal helpers (focus trap, Esc) shared by job + materials modals ---

let modalLastFocusedElement = null;

function getFocusableElements(container) {
  return Array.from(
    container.querySelectorAll(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  );
}

function makeModalKeydownHandler(modalEl, closeFn) {
  return function handleKeydown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeFn();
      return;
    }
    if (event.key === 'Tab') {
      const focusable = getFocusableElements(modalEl);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  };
}

// --- New Application modal ---

const handleJobModalKeydown = makeModalKeydownHandler(jobModal, closeJobModal);

function openJobModal(job = null) {
  modalLastFocusedElement = document.activeElement;
  editingJobId = job ? job.id : null;
  setFormMode(Boolean(job), job);
  jobModal.classList.remove('hidden');
  document.addEventListener('keydown', handleJobModalKeydown);
  const focusable = getFocusableElements(jobModal);
  (focusable[0] || jobModal).focus();
}

function closeJobModal() {
  jobModal.classList.add('hidden');
  document.removeEventListener('keydown', handleJobModalKeydown);
  editingJobId = null;
  modalLastFocusedElement?.focus?.();
}

newApplicationButton?.addEventListener('click', () => openJobModal());
jobModalCloseButton?.addEventListener('click', closeJobModal);
jobCancelButton?.addEventListener('click', closeJobModal);
jobModal?.addEventListener('click', (event) => {
  if (event.target === jobModal) {
    closeJobModal();
  }
});

form?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const formData = new FormData(form);
  const appliedDate = formData.get('appliedDate')?.toString() || formatDate(new Date());
  const submitButton = form.querySelector('button[type="submit"]');

  const fields = {
    company: formData.get('company')?.toString() ?? '',
    role: formData.get('role')?.toString() ?? '',
    status: formData.get('status')?.toString() ?? 'wishlist',
    appliedDate,
    deadline: formData.get('deadline')?.toString() ?? '',
    notes: formData.get('notes')?.toString() ?? '',
    pay: formData.get('pay')?.toString() ?? '',
    link: formData.get('link')?.toString() ?? '',
    jobDescription: formData.get('jobDescription')?.toString() ?? '',
  };
  const tailorNow = formData.get('tailorNow') === 'on';

  submitButton && (submitButton.disabled = true);

  try {
    let saved;
    if (editingJobId) {
      const existing = jobs.find((job) => job.id === editingJobId);
      const merged = existing ? updateJob(existing, fields) : createJob(fields);
      saved = await apiUpdateJob(editingJobId, toApiPayload(merged));
      jobs = jobs.map((job) => (job.id === editingJobId ? saved : job));
      editingJobId = null;
    } else {
      const nextJob = createJob(fields);
      saved = await apiCreateJob(nextJob);
      jobs = [saved, ...jobs];
    }

    clearApiError();
    form.reset();
    render();
    closeJobModal();

    if (tailorNow) {
      try {
        await apiRequestTailorIntent(saved.id);
      } catch (error) {
        console.error('Unable to record tailor intent', error);
        showApiError('Application saved, but the tailor request could not be recorded.');
      }
    }
  } catch (error) {
    console.error('Unable to save application', error);
    showApiError();
  } finally {
    submitButton && (submitButton.disabled = false);
  }
});

function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function setFormMode(isEditing, job = null) {
  const submitButton = form?.querySelector('button[type="submit"]');
  if (!submitButton) {
    return;
  }

  submitButton.textContent = isEditing ? 'Save changes' : 'Save application';
  jobModalTitle?.replaceChildren(document.createTextNode(isEditing ? 'Edit application' : 'Add a new role'));

  if (!job) {
    form?.reset();
    const today = formatDate(new Date());
    const appliedDateInput = form?.querySelector('input[name="appliedDate"]');
    if (appliedDateInput) {
      appliedDateInput.value = today;
    }
    return;
  }

  const companyInput = form?.querySelector('input[name="company"]');
  const roleInput = form?.querySelector('input[name="role"]');
  const statusInput = form?.querySelector('select[name="status"]');
  const appliedDateInput = form?.querySelector('input[name="appliedDate"]');
  const deadlineInput = form?.querySelector('input[name="deadline"]');
  const payInput = form?.querySelector('input[name="pay"]');
  const linkInput = form?.querySelector('input[name="link"]');
  const jobDescriptionInput = form?.querySelector('textarea[name="jobDescription"]');
  const notesInput = form?.querySelector('textarea[name="notes"]');

  if (companyInput) companyInput.value = job.company;
  if (roleInput) roleInput.value = job.role;
  if (statusInput) statusInput.value = job.status;
  if (appliedDateInput) appliedDateInput.value = job.appliedDate || formatDate(new Date());
  if (deadlineInput) deadlineInput.value = job.deadline || '';
  if (payInput) payInput.value = job.pay || '';
  if (linkInput) linkInput.value = job.link || '';
  if (jobDescriptionInput) jobDescriptionInput.value = job.jobDescription || '';
  if (notesInput) notesInput.value = job.notes || '';
}

function escapeHtml(str) {
  return String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function render() {
  const stats = getStats(jobs);
  const sortedJobs = sortJobs(jobs);
  statsContainer.innerHTML = '';
  pipelineContainer.innerHTML = '';

  statsContainer.innerHTML = [
    '<div class="stat-card"><span>Total</span><strong>' + stats.total + '</strong></div>',
    '<div class="stat-card"><span>Wishlist</span><strong>' + stats.wishlist + '</strong></div>',
    '<div class="stat-card"><span>Applied</span><strong>' + stats.applied + '</strong></div>',
    '<div class="stat-card"><span>Interview</span><strong>' + stats.interview + '</strong></div>',
    '<div class="stat-card"><span>Offers</span><strong>' + stats.offer + '</strong></div>',
  ].join('');

  STATUSES.forEach((status) => {
    const columnJobs = sortedJobs.filter((job) => job.status === status.id);
    const column = document.createElement('section');
    column.className = 'pipe-column';
    column.innerHTML = `
      <h3>${status.label}</h3>
      <p>${columnJobs.length} ${columnJobs.length === 1 ? 'application' : 'applications'}</p>
    `;

    if (columnJobs.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.textContent = 'No applications here yet.';
      column.appendChild(empty);
    } else {
      columnJobs.forEach((job) => {
        const card = document.createElement('article');
        card.className = 'job-card';
        const notesText = job.notes || '';
        const previewText = notesText.length > 120 ? `${notesText.slice(0, 117)}...` : notesText;
        const hasLongNotes = notesText.length > 120;

        card.innerHTML = `
          <h4>${escapeHtml(job.company)}</h4>
          <p><strong>${escapeHtml(job.role)}</strong></p>
          ${job.pay ? `<p class="pay-pill">${escapeHtml(job.pay)}</p>` : ''}
          ${job.appliedDate ? `<p class="muted">Applied ${escapeHtml(job.appliedDate)}</p>` : ''}
          ${notesText ? `<p class="note-line ${hasLongNotes ? 'note-collapsed' : ''}" data-full-text="${escapeHtml(notesText)}">${hasLongNotes ? escapeHtml(previewText) : escapeHtml(notesText)}</p>` : ''}
          ${hasLongNotes ? '<button class="read-more" data-action="toggle-notes" data-id="' + job.id + '">Read more</button>' : ''}
          <div class="card-actions">
            ${job.link ? `<a class="card-link" href="${escapeHtml(job.link)}" target="_blank" rel="noopener noreferrer">Open</a>` : ''}
            <button data-action="materials" data-id="${job.id}">Materials</button>
            <button data-action="edit" data-id="${job.id}">Edit</button>
            <button data-action="back" data-id="${job.id}">←</button>
            <button data-action="forward" data-id="${job.id}">→</button>
            <button class="danger" data-action="delete" data-id="${job.id}">×</button>
          </div>
        `;
        column.appendChild(card);
      });
    }

    pipelineContainer.appendChild(column);
  });
}

pipelineContainer?.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) {
    return;
  }

  const { action, id } = button.dataset;

  if (action === 'edit') {
    const targetJob = jobs.find((job) => job.id === id);
    if (targetJob) {
      openJobModal(targetJob);
    }
    return;
  }

  if (action === 'materials') {
    const targetJob = jobs.find((job) => job.id === id);
    if (targetJob) {
      openMaterialsModal(targetJob);
    }
    return;
  }

  if (action === 'toggle-notes') {
    const noteNode = button.previousElementSibling;
    if (noteNode?.dataset.fullText) {
      const isExpanded = button.textContent === 'Show less';
      button.textContent = isExpanded ? 'Read more' : 'Show less';
      noteNode.textContent = isExpanded ? `${noteNode.dataset.fullText.slice(0, 117)}...` : noteNode.dataset.fullText;
      noteNode.classList.toggle('note-expanded', !isExpanded);
    }
    return;
  }

  if (action !== 'delete' && action !== 'forward' && action !== 'back') {
    return;
  }

  const targetJob = jobs.find((job) => job.id === id);
  if (!targetJob) {
    return;
  }

  button.disabled = true;

  try {
    if (action === 'delete') {
      await apiDeleteJob(id);
      jobs = jobs.filter((job) => job.id !== id);
    } else {
      const moved = moveJobStatus(targetJob, action === 'forward' ? 'forward' : 'back');
      const saved = await apiUpdateJob(id, { status: moved.status });
      jobs = jobs.map((job) => (job.id === id ? saved : job));
    }
    clearApiError();
    render();
  } catch (error) {
    console.error(`Unable to ${action} application`, error);
    showApiError();
    button.disabled = false;
  }
});

// --- Materials modal: list published materials + download from R2 ---

const handleMaterialsModalKeydown = makeModalKeydownHandler(materialsModal, closeMaterialsModal);

const MATERIAL_KIND_LABELS = { resume: 'Resume', cover_letter: 'Cover letter' };
const RENDER_STATUS_LABELS = {
  none: 'Not rendered',
  queued: 'Queued',
  rendering: 'Rendering…',
  ready: 'Ready',
  error: 'Render error',
};

function materialDownloadLinks(m) {
  const links = [];
  if (m.r2_key_pdf) {
    links.push(`<a class="card-link" href="/api/materials/${m.id}/download?format=pdf">Download PDF</a>`);
  }
  if (m.r2_key_docx) {
    links.push(`<a class="card-link" href="/api/materials/${m.id}/download?format=docx">Download DOCX</a>`);
  }
  return links.length ? links.join(' ') : '<span class="muted">No file yet</span>';
}

function renderMaterials(materials) {
  if (!materials.length) {
    materialsList.innerHTML =
      '<p class="empty-state">Nothing published yet. Ask CareerOS to tailor this role, and the resume and cover letter will show up here.</p>';
    return;
  }
  materialsList.innerHTML = materials
    .map((m) => {
      const kind = MATERIAL_KIND_LABELS[m.kind] || m.kind;
      const variant = m.variant ? ` · ${escapeHtml(m.variant)}` : '';
      const statusLabel = RENDER_STATUS_LABELS[m.render_status] || m.render_status;
      return `
        <div class="material-row">
          <div class="material-head">
            <strong>${escapeHtml(kind)}</strong><span class="muted">${variant}</span>
            <span class="material-status status-${escapeHtml(m.render_status)}">${escapeHtml(statusLabel)}</span>
          </div>
          <div class="material-actions">${materialDownloadLinks(m)}</div>
        </div>
      `;
    })
    .join('');
}

async function openMaterialsModal(job) {
  modalLastFocusedElement = document.activeElement;
  materialsSubtitle.textContent = `${job.company} — ${job.role}`;
  materialsList.innerHTML = '<p class="muted">Loading…</p>';
  materialsModal.classList.remove('hidden');
  document.addEventListener('keydown', handleMaterialsModalKeydown);
  const focusable = getFocusableElements(materialsModal);
  (focusable[0] || materialsModal).focus();

  try {
    const materials = await apiListMaterials(job.id);
    renderMaterials(materials);
  } catch (error) {
    console.error('Unable to load materials', error);
    materialsList.innerHTML = '<p class="empty-state">Could not load materials. Try again.</p>';
  }
}

function closeMaterialsModal() {
  materialsModal.classList.add('hidden');
  document.removeEventListener('keydown', handleMaterialsModalKeydown);
  modalLastFocusedElement?.focus?.();
}

materialsModalCloseButton?.addEventListener('click', closeMaterialsModal);
materialsCloseButton?.addEventListener('click', closeMaterialsModal);
materialsModal?.addEventListener('click', (event) => {
  if (event.target === materialsModal) {
    closeMaterialsModal();
  }
});

loadJobsFromServer();
