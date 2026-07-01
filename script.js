import { STATUSES, createJob, getStats, moveJobStatus, sortJobs, updateJob } from './src/jobTracker.js';

const STORAGE_KEY = 'application-tracker-jobs';
const form = document.querySelector('#job-form');
const statsContainer = document.querySelector('#stats');
const pipelineContainer = document.querySelector('#pipeline');

let jobs = loadJobs();
let editingJobId = null;

form?.addEventListener('submit', (event) => {
  event.preventDefault();
  const formData = new FormData(form);
  const appliedDate = formData.get('appliedDate')?.toString() || formatDate(new Date());

  if (editingJobId) {
    jobs = jobs.map((job) => {
      if (job.id !== editingJobId) {
        return job;
      }

      return updateJob(job, {
        company: formData.get('company')?.toString() ?? '',
        role: formData.get('role')?.toString() ?? '',
        status: formData.get('status')?.toString() ?? 'wishlist',
        appliedDate,
        notes: formData.get('notes')?.toString() ?? '',
        pay: formData.get('pay')?.toString() ?? '',
        link: formData.get('link')?.toString() ?? '',
      });
    });
    editingJobId = null;
  } else {
    const nextJob = createJob({
      company: formData.get('company')?.toString() ?? '',
      role: formData.get('role')?.toString() ?? '',
      status: formData.get('status')?.toString() ?? 'wishlist',
      appliedDate,
      notes: formData.get('notes')?.toString() ?? '',
      pay: formData.get('pay')?.toString() ?? '',
      link: formData.get('link')?.toString() ?? '',
    });

    jobs = [nextJob, ...jobs];
  }

  persistJobs();
  form.reset();
  setFormMode(false);
  render();
});

function loadJobs() {
  try {
    const storedJobs = window.localStorage.getItem(STORAGE_KEY);
    return storedJobs ? JSON.parse(storedJobs) : [];
  } catch (error) {
    console.error('Unable to load jobs', error);
    return [];
  }
}

function persistJobs() {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(jobs));
}

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
  form?.querySelector('h2')?.replaceChildren(document.createTextNode(isEditing ? 'Edit application' : 'Add a new role'));

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
  const payInput = form?.querySelector('input[name="pay"]');
  const linkInput = form?.querySelector('input[name="link"]');
  const notesInput = form?.querySelector('textarea[name="notes"]');

  if (companyInput) companyInput.value = job.company;
  if (roleInput) roleInput.value = job.role;
  if (statusInput) statusInput.value = job.status;
  if (appliedDateInput) appliedDateInput.value = job.appliedDate || formatDate(new Date());
  if (payInput) payInput.value = job.pay || '';
  if (linkInput) linkInput.value = job.link || '';
  if (notesInput) notesInput.value = job.notes || '';
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
          <h4>${job.company}</h4>
          <p><strong>${job.role}</strong></p>
          ${job.pay ? `<p class="pay-pill">${job.pay}</p>` : ''}
          ${job.appliedDate ? `<p class="muted">Applied ${job.appliedDate}</p>` : ''}
          ${notesText ? `<p class="note-line ${hasLongNotes ? 'note-collapsed' : ''}" data-full-text="${notesText}">${hasLongNotes ? previewText : notesText}</p>` : ''}
          ${hasLongNotes ? '<button class="read-more" data-action="toggle-notes" data-id="' + job.id + '">Read more</button>' : ''}
          <div class="card-actions">
            ${job.link ? `<a class="card-link" href="${job.link}" target="_blank" rel="noopener noreferrer">Open</a>` : ''}
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

pipelineContainer?.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) {
    return;
  }

  const { action, id } = button.dataset;

  if (action === 'edit') {
    const targetJob = jobs.find((job) => job.id === id);
    if (targetJob) {
      editingJobId = targetJob.id;
      setFormMode(true, targetJob);
      form?.scrollIntoView({ behavior: 'smooth', block: 'start' });
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

  jobs = jobs.filter((job) => {
    if (job.id !== id) {
      return true;
    }

    if (action === 'delete') {
      return false;
    }

    return true;
  });

  if (action !== 'delete') {
    const targetJob = jobs.find((job) => job.id === id);
    if (targetJob) {
      const updatedJob = moveJobStatus(targetJob, action === 'forward' ? 'forward' : 'back');
      jobs = jobs.map((job) => (job.id === id ? updatedJob : job));
    }
  }

  persistJobs();
  render();
});

render();
