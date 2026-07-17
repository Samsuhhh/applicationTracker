// CareerOS online Worker — API for the SamOS Career domain.
//
// Honesty architecture (see SamOS docs/careeros-increment3.md):
//   - D1 ("DB") is the source of truth for structured records.
//   - R2 ("FILES") holds rendered material files (DOCX/PDF).
//   - Tailoring NEVER runs here. It runs in the SamOS career-manager (select from the
//     real achievement library, never invent), which renders locally and PUBLISHES the
//     results to /api/materials via the Access service-token-authenticated client.
//   - The old /api/tailor-resume LLM path fabricated experience and is retired (410).
//   - Submission is a human Level-3 action; this API only stores/serves, never submits.

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Retired: tailoring in the Worker fabricated experience. It now lives in the
    // disciplined SamOS career-manager, which publishes via /api/materials.
    if (url.pathname === "/api/tailor-resume") {
      return jsonError(
        "Retired. Tailoring runs in the SamOS career-manager (honest, from the real " +
        "achievement library) and is published via /api/materials. See docs/careeros-increment3.md.",
        410
      );
    }

    if (url.pathname === "/api/applications" || url.pathname.startsWith("/api/applications/")) {
      return handleApplications(request, env, url);
    }

    if (url.pathname === "/api/materials" || url.pathname.startsWith("/api/materials/")) {
      return handleMaterials(request, env, url);
    }

    if (url.pathname === "/api/tailor-intent" && request.method === "POST") {
      return handleTailorIntent(request, env);
    }

    return env.ASSETS.fetch(request);
  },
};

// Records intent only — no LLM call. The real tailoring happens in the SamOS
// career-manager; this just logs an activity row so the intent isn't lost.
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

// ---------------------------------------------------------------------------
// Applications
// ---------------------------------------------------------------------------

const APP_STATUSES = ["wishlist", "applied", "interview", "offer", "rejected"];
// Fields a client is allowed to write. id/created_at/updated_at are server-managed.
const APP_WRITABLE = [
  "company", "role", "status", "applied_date", "deadline", "pay", "link",
  "notes", "follow_up_date", "jd_text", "submitted", "submitted_at", "submitted_material_ids",
];

// CRUD for /api/applications. D1-backed.
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

// ---------------------------------------------------------------------------
// Materials (resume / cover_letter records + their rendered R2 files)
// ---------------------------------------------------------------------------

const MATERIAL_KINDS = ["resume", "cover_letter"];
const MATERIAL_RENDER_STATUSES = ["none", "queued", "rendering", "ready", "error"];
// Writable via POST/PUT. r2_key_* are server-managed (set by the file upload path).
const MATERIAL_WRITABLE = ["kind", "variant", "application_id", "markdown", "render_status"];

const DOCX_CTYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

async function handleMaterials(request, env, url) {
  if (!env.DB) {
    return jsonError("D1 is not bound. Add the d1_databases binding in wrangler.jsonc.", 500);
  }

  const parts = url.pathname.split("/").filter(Boolean); // ["api","materials", id?, "file"|"download"?]
  const id = parts[2];
  const sub = parts[3]; // "file" | "download" | undefined
  const method = request.method;

  try {
    // Collection: GET (list, optional ?application_id=) / POST (create)
    if (!id) {
      if (method === "GET") {
        const appId = url.searchParams.get("application_id");
        const stmt = appId
          ? env.DB.prepare("SELECT * FROM materials WHERE application_id = ? ORDER BY updated_at DESC").bind(appId)
          : env.DB.prepare("SELECT * FROM materials ORDER BY updated_at DESC");
        const { results } = await stmt.all();
        return jsonOk({ materials: results || [] });
      }

      if (method === "POST") {
        const body = await request.json().catch(() => null);
        if (!body || !body.kind || !body.markdown) {
          return jsonError("kind and markdown are required.", 400);
        }
        if (!MATERIAL_KINDS.includes(body.kind)) {
          return jsonError(`kind must be one of: ${MATERIAL_KINDS.join(", ")}`, 400);
        }
        // Honest FK: if an application_id is given, it must exist.
        if (body.application_id) {
          const app = await env.DB.prepare("SELECT id FROM applications WHERE id = ?").bind(body.application_id).first();
          if (!app) return jsonError("application_id not found", 404);
        }
        const now = new Date().toISOString();
        const row = {
          id: newId("mat"),
          kind: body.kind,
          variant: body.variant || null,
          application_id: body.application_id || null,
          markdown: body.markdown,
          r2_key_docx: null,
          r2_key_pdf: null,
          render_status: MATERIAL_RENDER_STATUSES.includes(body.render_status) ? body.render_status : "none",
          created_at: now,
          updated_at: now,
        };
        await env.DB.prepare(
          `INSERT INTO materials
           (id,kind,variant,application_id,markdown,r2_key_docx,r2_key_pdf,render_status,created_at,updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?)`
        ).bind(
          row.id, row.kind, row.variant, row.application_id, row.markdown,
          row.r2_key_docx, row.r2_key_pdf, row.render_status, row.created_at, row.updated_at
        ).run();
        await logActivity(env, "material", row.id, "created", "career-manager");
        return jsonOk({ material: row }, 201);
      }

      return jsonError("method not allowed", 405);
    }

    // Item-level file operations
    if (sub === "file" && method === "PUT") {
      return handleMaterialUpload(request, env, url, id);
    }
    if (sub === "download" && method === "GET") {
      return handleMaterialDownload(env, url, id);
    }
    if (sub) {
      return jsonError("method not allowed", 405);
    }

    // Item CRUD
    if (method === "GET") {
      const m = await env.DB.prepare("SELECT * FROM materials WHERE id = ?").bind(id).first();
      return m ? jsonOk({ material: m }) : jsonError("not found", 404);
    }

    if (method === "PUT" || method === "PATCH") {
      const body = await request.json().catch(() => null);
      if (!body) return jsonError("invalid JSON body", 400);
      const sets = [];
      const vals = [];
      for (const key of MATERIAL_WRITABLE) {
        if (key in body) {
          if (key === "kind" && !MATERIAL_KINDS.includes(body.kind)) continue;
          if (key === "render_status" && !MATERIAL_RENDER_STATUSES.includes(body.render_status)) continue;
          sets.push(`${key} = ?`);
          vals.push(body[key]);
        }
      }
      if (!sets.length) return jsonError("no writable fields provided", 400);
      sets.push("updated_at = ?");
      vals.push(new Date().toISOString());
      vals.push(id);
      const res = await env.DB.prepare(
        `UPDATE materials SET ${sets.join(", ")} WHERE id = ?`
      ).bind(...vals).run();
      if (!res.meta || res.meta.changes === 0) return jsonError("not found", 404);
      await logActivity(env, "material", id, "updated", "career-manager");
      const m = await env.DB.prepare("SELECT * FROM materials WHERE id = ?").bind(id).first();
      return jsonOk({ material: m });
    }

    if (method === "DELETE") {
      const m = await env.DB.prepare("SELECT * FROM materials WHERE id = ?").bind(id).first();
      if (!m) return jsonError("not found", 404);
      if (env.FILES) {
        if (m.r2_key_docx) await env.FILES.delete(m.r2_key_docx).catch(() => {});
        if (m.r2_key_pdf) await env.FILES.delete(m.r2_key_pdf).catch(() => {});
      }
      await env.DB.prepare("DELETE FROM materials WHERE id = ?").bind(id).run();
      return jsonOk({ ok: true, id });
    }

    return jsonError("method not allowed", 405);
  } catch (err) {
    return jsonError(`materials error: ${err.message}`, 500);
  }
}

// PUT /api/materials/:id/file?format=pdf|docx  — raw file body -> R2, marks render_status=ready.
async function handleMaterialUpload(request, env, url, id) {
  if (!env.FILES) {
    return jsonError("R2 is not bound. Add the r2_buckets binding (FILES -> careeros) in wrangler.jsonc.", 500);
  }
  const fmt = url.searchParams.get("format");
  if (!["pdf", "docx"].includes(fmt)) {
    return jsonError("format query param must be pdf or docx", 400);
  }
  const m = await env.DB.prepare("SELECT * FROM materials WHERE id = ?").bind(id).first();
  if (!m) return jsonError("not found", 404);

  const body = await request.arrayBuffer();
  if (!body || body.byteLength === 0) return jsonError("empty file body", 400);

  const key = `materials/${m.application_id || "base"}/${m.id}.${fmt}`;
  const ctype = fmt === "pdf" ? "application/pdf" : DOCX_CTYPE;
  await env.FILES.put(key, body, { httpMetadata: { contentType: ctype } });

  const col = fmt === "pdf" ? "r2_key_pdf" : "r2_key_docx";
  const now = new Date().toISOString();
  await env.DB.prepare(
    `UPDATE materials SET ${col} = ?, render_status = 'ready', updated_at = ? WHERE id = ?`
  ).bind(key, now, id).run();
  await logActivity(env, "material", id, "rendered", "career-manager", fmt);

  const updated = await env.DB.prepare("SELECT * FROM materials WHERE id = ?").bind(id).first();
  return jsonOk({ material: updated });
}

// GET /api/materials/:id/download?format=pdf|docx  — streams the file from R2.
async function handleMaterialDownload(env, url, id) {
  if (!env.FILES) return jsonError("R2 is not bound.", 500);
  const m = await env.DB.prepare("SELECT * FROM materials WHERE id = ?").bind(id).first();
  if (!m) return jsonError("not found", 404);

  let fmt = url.searchParams.get("format");
  if (!fmt) fmt = m.r2_key_pdf ? "pdf" : (m.r2_key_docx ? "docx" : null);
  if (!["pdf", "docx"].includes(fmt)) {
    return jsonError("no rendered file; specify format=pdf|docx", 400);
  }
  const key = fmt === "pdf" ? m.r2_key_pdf : m.r2_key_docx;
  if (!key) return jsonError(`no ${fmt} file for this material`, 404);

  const obj = await env.FILES.get(key);
  if (!obj) return jsonError("file missing from storage", 404);

  const ctype = fmt === "pdf" ? "application/pdf" : DOCX_CTYPE;
  const nameBase = `${m.kind}${m.variant ? "-" + m.variant : ""}`;
  return new Response(obj.body, {
    headers: {
      "content-type": ctype,
      "content-disposition": `attachment; filename="${nameBase}.${fmt}"`,
    },
  });
}

// ---------------------------------------------------------------------------
// Activity log (best-effort)
// ---------------------------------------------------------------------------

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
