export const STATUSES = [
  { id: 'wishlist', label: 'Wishlist', order: 0 },
  { id: 'applied', label: 'Applied', order: 1 },
  { id: 'interview', label: 'Interview', order: 2 },
  { id: 'offer', label: 'Offer', order: 3 },
  { id: 'rejected', label: 'Rejected', order: 4 },
];

function normalizeStatus(status) {
  return STATUSES.some((entry) => entry.id === status) ? status : 'wishlist';
}

export function createJob({
  company,
  role,
  status = 'wishlist',
  appliedDate = '',
  deadline = '',
  notes = '',
  pay = '',
  link = '',
  jobDescription = '',
}) {
  const trimmedCompany = company.trim();
  const trimmedRole = role.trim();
  const trimmedNotes = notes.trim();
  const trimmedPay = pay.trim();
  const trimmedLink = link.trim();
  const trimmedJobDescription = jobDescription.trim();

  return {
    id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    company: trimmedCompany,
    role: trimmedRole,
    status: normalizeStatus(status),
    appliedDate,
    deadline,
    notes: trimmedNotes,
    pay: trimmedPay,
    link: trimmedLink,
    jobDescription: trimmedJobDescription,
    createdAt: new Date().toISOString(),
  };
}

export function moveJobStatus(job, direction) {
  const currentIndex = STATUSES.findIndex((entry) => entry.id === job.status);
  const nextIndex = direction === 'forward'
    ? Math.min(currentIndex + 1, STATUSES.length - 1)
    : Math.max(currentIndex - 1, 0);

  return {
    ...job,
    status: STATUSES[nextIndex].id,
  };
}

export function updateJob(job, updates) {
  return {
    ...job,
    ...updates,
    company: updates.company?.trim() ?? job.company,
    role: updates.role?.trim() ?? job.role,
    notes: updates.notes?.trim() ?? job.notes,
    pay: updates.pay?.trim() ?? job.pay,
    link: updates.link?.trim() ?? job.link,
    jobDescription: updates.jobDescription?.trim() ?? job.jobDescription,
    appliedDate: updates.appliedDate ?? job.appliedDate,
    deadline: updates.deadline ?? job.deadline,
  };
}

export function sortJobs(jobs) {
  return [...jobs].sort((left, right) => {
    const leftOrder = STATUSES.find((entry) => entry.id === left.status)?.order ?? 0;
    const rightOrder = STATUSES.find((entry) => entry.id === right.status)?.order ?? 0;

    if (leftOrder !== rightOrder) {
      return leftOrder - rightOrder;
    }

    return (right.createdAt || '').localeCompare(left.createdAt || '');
  });
}

export function getStats(jobs) {
  return jobs.reduce(
    (accumulator, job) => {
      accumulator.total += 1;
      accumulator[job.status] += 1;
      return accumulator;
    },
    {
      total: 0,
      wishlist: 0,
      applied: 0,
      interview: 0,
      offer: 0,
      rejected: 0,
    },
  );
}
