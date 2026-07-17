const ASSESSMENT_SYSTEM_PROMPT = `You are a skeptical senior recruiter and career strategist, evaluating a candidate for a specific role AT the hiring company — not the candidate's advocate, but the person deciding whether to move them forward.

Be a sparring partner, not a cheerleader. Push back on weak fits. If a role isn't worth applying to, say so plainly and explain why. Do not invent strengths that aren't in the experience bank, and do not soften real gaps to make the candidate feel better.

Given the candidate's experience bank and the job description, write a hire-likelihood assessment under the heading "## Hire-likelihood assessment":
- A blunt fit read: strong fit / possible fit / weak fit / not worth applying — with your reasoning
- The 2-3 strongest points of leverage this candidate actually has for this specific role
- The real gaps or risks a recruiter at this company would flag
- One direct recommendation: apply and lean into X, or don't bother unless Y changes`;

const MATERIALS_SYSTEM_PROMPT = `You are a career strategist producing tailored application materials. You'll be given the candidate's experience bank, a job description, and a recruiter's hire-likelihood assessment. Use the assessment to lean into the candidate's real leverage points — don't contradict it or paper over the gaps it named.

Only use experience that appears in the experience bank. Do not invent employers, dates, titles, or metrics. Output clean Markdown, ready to paste elsewhere. Do not wrap the output in a code fence.

Write exactly three sections, each under its own heading:

## Tailored resume
- Standard sections: Summary, Skills, Experience, Projects, Education (omit sections the experience bank has nothing for)
- Every experience bullet uses Google's XYZ framing: "Accomplished X by doing Y, measured by Z"
- Action-verb-first bullets
- No em dashes anywhere — use commas or periods instead
- Sized to fit one page at normal resume length. ATS-optimized: plain text, no tables or columns, standard section headers, and keywords from the job description where they're genuinely true of the candidate

## Cover letter
- Tight, specific to this company and role — reference something real from the job description, not a generic template
- No generic openers ("I am writing to apply for...", "I hope this finds you well")
- Grounded only in the experience bank

## LinkedIn outreach message
- Short (2-4 sentences), specific to the role and company
- No "I hope this finds you well" or other filler
- Ends with a clear, low-friction ask`;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/tailor-resume" && request.method === "POST") {
      return handleTailorResume(request, env);
    }

    if (url.pathname === "/api/applications" || url.pathname.startsWith("/api/applications/")) {
      return handleApplications(request, env, url);
    }

    if (url.pathname === "/api/tailor-intent" && request.method === "POST") {
      return handleTailorIntent(request, env);
    }

    return env.ASSETS.fetch(request);
  },
};

// Records intent only — no LLM call. Real tailoring is wired to the SamOS
// career-manager in a later increment; this just logs an activity row so the
// intent isn't lost.
async function handleTailorIntent(request, env) {
  if (!env.DB) {
    return jsonError("D1 is not bound. Add the d1_databases binding in wrangler.jsonc.", 500);
  }

  const body = await request.json().catch(() => null);
  const applicationId = body?.application_id;
  if (!applicationId) {
    return jsonError("application_id is required.", 400);
  }

  const app = await env.DB.prepare("SELECT id FROM applications WHERE id = ?").bind(applicationId).first();
  if (!app) {
    return jsonError("application not found", 404);
  }

  await logActivity(env, "application", applicationId, "tailor_intent_requested", "human");
  return jsonOk({ ok: true });
}

async function handleTailorResume(request, env) {
  if (!env.ANTHROPIC_API_KEY) {
    return jsonError("Server is not configured with an Anthropic API key.", 500);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid JSON body.", 400);
  }

  const jobDescription = (body.jobDescription || "").toString().trim();
  const experienceBank = (body.experienceBank || "").toString().trim();

  if (!jobDescription) {
    return jsonError("jobDescription is required.", 400);
  }
  if (!experienceBank) {
    return jsonError("experienceBank is required.", 400);
  }

  const context = `Experience bank:\n\n${experienceBank}\n\n---\n\nJob description:\n\n${jobDescription}`;

  let assessment;
  try {
    assessment = await callClaude(env, {
      model: "claude-opus-4-8",
      max_tokens: 1024,
      thinking: { type: "adaptive" },
      system: ASSESSMENT_SYSTEM_PROMPT,
      messages: [{ role: "user", content: context }],
    });
  } catch (error) {
    return jsonError(`Anthropic API error (assessment): ${error.message}`, 502);
  }

  let materials;
  try {
    materials = await callClaude(env, {
      model: "claude-sonnet-5",
      max_tokens: 4096,
      output_config: { effort: "medium" },
      system: MATERIALS_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `${context}\n\n---\n\nRecruiter's hire-likelihood assessment:\n\n${assessment}`,
        },
      ],
    });
  } catch (error) {
    return jsonError(`Anthropic API error (materials): ${error.message}`, 502);
  }

  return new Response(JSON.stringify({ resume: `${assessment}\n\n---\n\n${materials}` }), {
    headers: { "content-type": "application/json" },
  });
}

async function callClaude(env, payload) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  const data = await response.json();
  const textBlock = (data.content || []).find((block) => block.type === "text");
  return textBlock?.text ?? "";
}

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function jsonOk(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function newId(prefix) {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${Date.now()}-${rand}`;
}

const APP_STATUSES = ["wishlist", "applied", "interview", "offer", "rejected"];
// Fields a client is allowed to write. id/created_at/updated_at are server-managed.
const APP_WRITABLE = [
  "company", "role", "status", "applied_date", "deadline", "pay", "link",
  "notes", "follow_up_date", "jd_text", "submitted", "submitted_at", "submitted_material_ids",
];

// CRUD for /api/applications. D1-backed. Additive: does not touch tailor-resume or assets.
async function handleApplications(request, env, url) {
  if (!env.DB) {
    return jsonError("D1 is not bound. Add the d1_databases binding in wrangler.jsonc.", 500);
  }

  const parts = url.pathname.split("/").filter(Boolean); // ["api","applications", id?]
  const id = parts[2];
  const method = request.method;

  try {
    if (!id && method === "GET") {
      const { results } = await env.DB
        .prepare("SELECT * FROM applications ORDER BY updated_at DESC")
        .all();
      return jsonOk({ applications: results || [] });
    }

    if (!id && method === "POST") {
      const body = await request.json().catch(() => null);
      if (!body || !body.company || !body.role) {
        return jsonError("company and role are required.", 400);
      }
      const now = new Date().toISOString();
      const row = {
        id: newId("app"),
        company: body.company,
        role: body.role,
        status: APP_STATUSES.includes(body.status) ? body.status : "applied",
        applied_date: body.applied_date || now.slice(0, 10),
        deadline: body.deadline || null,
        pay: body.pay || null,
        link: body.link || null,
        notes: body.notes || null,
        follow_up_date: body.follow_up_date || null,
        jd_text: body.jd_text || null,
        submitted: body.submitted ? 1 : 0,
        submitted_at: body.submitted_at || null,
        submitted_material_ids: body.submitted_material_ids || null,
        created_at: now,
        updated_at: now,
      };
      await env.DB.prepare(
        `INSERT INTO applications
         (id,company,role,status,applied_date,deadline,pay,link,notes,follow_up_date,jd_text,submitted,submitted_at,submitted_material_ids,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      ).bind(
        row.id, row.company, row.role, row.status, row.applied_date, row.deadline,
        row.pay, row.link, row.notes, row.follow_up_date, row.jd_text, row.submitted,
        row.submitted_at, row.submitted_material_ids, row.created_at, row.updated_at
      ).run();
      await logActivity(env, "application", row.id, "created", "human");
      return jsonOk({ application: row }, 201);
    }

    if (id && method === "GET") {
      const app = await env.DB.prepare("SELECT * FROM applications WHERE id = ?").bind(id).first();
      return app ? jsonOk({ application: app }) : jsonError("not found", 404);
    }

    if (id && (method === "PUT" || method === "PATCH")) {
      const body = await request.json().catch(() => null);
      if (!body) return jsonError("invalid JSON body", 400);
      const sets = [];
      const vals = [];
      for (const key of APP_WRITABLE) {
        if (key in body) {
          if (key === "status" && !APP_STATUSES.includes(body.status)) continue;
          sets.push(`${key} = ?`);
          vals.push(key === "submitted" ? (body[key] ? 1 : 0) : body[key]);
        }
      }
      if (!sets.length) return jsonError("no writable fields provided", 400);
      sets.push("updated_at = ?");
      vals.push(new Date().toISOString());
      vals.push(id);
      const res = await env.DB.prepare(
        `UPDATE applications SET ${sets.join(", ")} WHERE id = ?`
      ).bind(...vals).run();
      if (!res.meta || res.meta.changes === 0) return jsonError("not found", 404);
      await logActivity(env, "application", id, "updated", "human");
      const app = await env.DB.prepare("SELECT * FROM applications WHERE id = ?").bind(id).first();
      return jsonOk({ application: app });
    }

    if (id && method === "DELETE") {
      const res = await env.DB.prepare("DELETE FROM applications WHERE id = ?").bind(id).run();
      if (!res.meta || res.meta.changes === 0) return jsonError("not found", 404);
      return jsonOk({ ok: true, id });
    }

    return jsonError("method not allowed", 405);
  } catch (err) {
    return jsonError(`D1 error: ${err.message}`, 500);
  }
}

async function logActivity(env, entityType, entityId, action, actor, detail = null) {
  try {
    await env.DB.prepare(
      `INSERT INTO activity (id, entity_type, entity_id, action, actor, detail, at)
       VALUES (?,?,?,?,?,?,?)`
    ).bind(newId("act"), entityType, entityId, action, actor, detail, new Date().toISOString()).run();
  } catch (_) {
    // Activity logging is best-effort; never fail the main request over it.
  }
}
