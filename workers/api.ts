type Env = {
  DB: D1Database;
  HANGOUT_API_SECRET: string;
  CORS_ORIGIN?: string;
};

type D1Database = {
  prepare(query: string): D1PreparedStatement;
  batch(statements: D1PreparedStatement[]): Promise<unknown[]>;
};

type D1PreparedStatement = {
  bind(...values: unknown[]): D1PreparedStatement;
  run(): Promise<unknown>;
  first<T = unknown>(): Promise<T | null>;
  all<T = unknown>(): Promise<{ results?: T[] }>;
};

type ApiUser = {
  clerkId: string;
  email: string;
  name: string;
  imageUrl: string | null;
};

const JSON_HEADERS = {
  'Content-Type': 'application/json',
};

function json(data: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      ...JSON_HEADERS,
      ...init.headers,
    },
  });
}

function corsHeaders(env: Env) {
  return {
    'Access-Control-Allow-Origin': env.CORS_ORIGIN || '*',
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  };
}

async function timingSafeEqual(a: string, b: string) {
  const encoder = new TextEncoder();
  const left = encoder.encode(a);
  const right = encoder.encode(b);

  if (left.byteLength !== right.byteLength) {
    return false;
  }

  let diff = 0;
  for (let index = 0; index < left.byteLength; index += 1) {
    diff |= left[index] ^ right[index];
  }

  return diff === 0;
}

async function assertAuthorized(request: Request, env: Env) {
  const header = request.headers.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';

  if (!env.HANGOUT_API_SECRET || !(await timingSafeEqual(token, env.HANGOUT_API_SECRET))) {
    return json(
      { success: false, error: { code: 'UNAUTHORIZED', message: 'Invalid API credentials.' } },
      { status: 401, headers: corsHeaders(env) }
    );
  }

  return null;
}

async function readJson<T>(request: Request): Promise<T> {
  return request.json() as Promise<T>;
}

function uuid() {
  return crypto.randomUUID();
}

function inviteCode() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => chars[byte % chars.length]).join('');
}

async function upsertUser(db: D1Database, user: ApiUser) {
  const existing = await db
    .prepare(
      `SELECT id, clerk_id AS clerkId, email, name, image_url AS imageUrl
       FROM users
       WHERE clerk_id = ?`
    )
    .bind(user.clerkId)
    .first<{ id: string; clerkId: string; email: string; name: string; imageUrl: string | null }>();

  if (existing) {
    await db
      .prepare(
        `UPDATE users
         SET email = ?, name = ?, image_url = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      )
      .bind(user.email, user.name, user.imageUrl, existing.id)
      .run();
    return { ...existing, email: user.email, name: user.name, imageUrl: user.imageUrl };
  }

  const id = uuid();
  await db
    .prepare(
      `INSERT INTO users (id, clerk_id, email, name, image_url)
       VALUES (?, ?, ?, ?, ?)`
    )
    .bind(id, user.clerkId, user.email, user.name, user.imageUrl)
    .run();

  return { id, clerkId: user.clerkId, email: user.email, name: user.name, imageUrl: user.imageUrl };
}

async function findUserByClerkId(db: D1Database, clerkId: string) {
  return db
    .prepare(
      `SELECT id, clerk_id AS clerkId, email, name, image_url AS imageUrl
       FROM users
       WHERE clerk_id = ?`
    )
    .bind(clerkId)
    .first<{ id: string; clerkId: string; email: string; name: string; imageUrl: string | null }>();
}

function normalizeInviteCode(code: string) {
  return code.trim().toUpperCase().replace(/[IL1]/g, 'L').replace(/[O0]/g, '0');
}

async function createGroup(request: Request, env: Env) {
  const body = await readJson<{
    user: ApiUser;
    group: { name: string; groupType: string; description?: string | null; vibes?: string[] };
  }>(request);
  const user = await upsertUser(env.DB, body.user);
  const groupId = uuid();
  const code = inviteCode();
  const inviteId = uuid();
  const memberId = uuid();
  const expiresAt = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60;
  const description = body.group.description || null;
  const vibes = body.group.vibes ? JSON.stringify(body.group.vibes) : null;
  const now = new Date().toISOString();

  await env.DB.batch([
    env.DB
      .prepare(
        `INSERT INTO groups
         (id, name, description, group_type, vibes, creator_id, invite_code, status, voting_status, max_members)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'COLLECTING_MEMBERS', 'CLOSED', 20)`
      )
      .bind(groupId, body.group.name, description, body.group.groupType, vibes, user.id, code),
    env.DB
      .prepare(
        `INSERT INTO group_members (id, group_id, user_id, role)
         VALUES (?, ?, ?, 'ADMIN')`
      )
      .bind(memberId, groupId, user.id),
    env.DB
      .prepare(
        `INSERT INTO invites (id, group_id, invite_code, expires_at, revoked)
         VALUES (?, ?, ?, ?, 0)`
      )
      .bind(inviteId, groupId, code, expiresAt),
  ]);

  const group = {
    id: groupId,
    name: body.group.name,
    description,
    groupType: body.group.groupType,
    vibes,
    creatorId: user.id,
    inviteCode: code,
    status: 'COLLECTING_MEMBERS',
    votingStatus: 'CLOSED',
    maxMembers: 20,
    winningPlanId: null,
    createdAt: now,
    updatedAt: now,
    memberCount: 1,
  };

  return json({ success: true, data: group }, { headers: corsHeaders(env) });
}

async function listGroups(request: Request, env: Env) {
  const url = new URL(request.url);
  const clerkId = url.searchParams.get('clerkId');
  if (!clerkId) {
    return json(
      { success: false, error: { code: 'VALIDATION_ERROR', message: 'Missing clerkId.' } },
      { status: 422, headers: corsHeaders(env) }
    );
  }

  const results = await env.DB
    .prepare(
      `SELECT
        g.id,
        g.name,
        g.description,
        g.group_type AS groupType,
        g.vibes,
        g.creator_id AS creatorId,
        g.invite_code AS inviteCode,
        g.status,
        g.voting_status AS votingStatus,
        g.max_members AS maxMembers,
        g.winning_plan_id AS winningPlanId,
        g.created_at AS createdAt,
        g.updated_at AS updatedAt,
        COUNT(gm_count.user_id) AS memberCount
       FROM groups g
       INNER JOIN group_members gm_self ON gm_self.group_id = g.id
       LEFT JOIN group_members gm_count ON gm_count.group_id = g.id
       INNER JOIN users u_self ON u_self.id = gm_self.user_id
       WHERE u_self.clerk_id = ? AND g.status != 'DELETED'
       GROUP BY g.id
       ORDER BY g.updated_at DESC`
    )
    .bind(clerkId)
    .all();

  return json({ success: true, data: results.results || [] }, { headers: corsHeaders(env) });
}

async function getGroupById(db: D1Database, groupId: string) {
  return db
    .prepare(
      `SELECT
        g.id,
        g.name,
        g.description,
        g.group_type AS groupType,
        g.vibes,
        g.creator_id AS creatorId,
        g.invite_code AS inviteCode,
        g.status,
        g.voting_status AS votingStatus,
        g.max_members AS maxMembers,
        g.winning_plan_id AS winningPlanId,
        g.created_at AS createdAt,
        g.updated_at AS updatedAt,
        COUNT(gm.user_id) AS memberCount
       FROM groups g
       LEFT JOIN group_members gm ON gm.group_id = g.id
       WHERE g.id = ?
       GROUP BY g.id`
    )
    .bind(groupId)
    .first();
}

async function getGroupDetails(request: Request, env: Env, groupId: string) {
  const url = new URL(request.url);
  const clerkId = url.searchParams.get('clerkId');
  if (!clerkId) {
    return json(
      { success: false, error: { code: 'VALIDATION_ERROR', message: 'Missing clerkId.' } },
      { status: 422, headers: corsHeaders(env) }
    );
  }

  const user = await findUserByClerkId(env.DB, clerkId);
  if (!user) {
    return json(
      { success: false, error: { code: 'NOT_FOUND', message: 'User has not been synced to D1 yet.' } },
      { status: 404, headers: corsHeaders(env) }
    );
  }

  const caller = await env.DB
    .prepare(`SELECT role FROM group_members WHERE group_id = ? AND user_id = ?`)
    .bind(groupId, user.id)
    .first<{ role: string }>();

  if (!caller) {
    return json(
      { success: false, error: { code: 'FORBIDDEN', message: 'You are not authorized to view this group.' } },
      { status: 403, headers: corsHeaders(env) }
    );
  }

  const group = await getGroupById(env.DB, groupId);
  if (!group || (group as { status?: string }).status === 'DELETED') {
    return json(
      { success: false, error: { code: 'NOT_FOUND', message: 'Group not found.' } },
      { status: 404, headers: corsHeaders(env) }
    );
  }

  const [membersRes, budgetsRes, locationsRes, summaryRes] = await Promise.all([
    env.DB
      .prepare(
        `SELECT
          u.id AS userId,
          u.clerk_id AS clerkId,
          u.name,
          u.email,
          u.image_url AS imageUrl,
          gm.role,
          gm.vibes,
          gm.created_at AS joinedAt
         FROM group_members gm
         INNER JOIN users u ON u.id = gm.user_id
         WHERE gm.group_id = ?`
      )
      .bind(groupId)
      .all(),
    env.DB.prepare(`SELECT * FROM budgets WHERE group_id = ?`).bind(groupId).all(),
    env.DB.prepare(`SELECT * FROM locations WHERE group_id = ?`).bind(groupId).all(),
    env.DB
      .prepare(
        `SELECT
          MIN(max_budget) AS min,
          AVG(max_budget) AS avg,
          MAX(max_budget) AS max,
          SUM(max_budget) AS total,
          COUNT(user_id) AS submittedCount
         FROM budgets
         WHERE group_id = ?`
      )
      .bind(groupId)
      .first(),
  ]);

  const members = (membersRes.results || []) as Array<{ userId: string; name: string; role: string }>;
  const budgets = (budgetsRes.results || []) as Array<{ user_id: string; max_budget: number }>;
  const locations = (locationsRes.results || []) as Array<{
    id: string;
    user_id: string;
    lat: number;
    lng: number;
    location_name: string | null;
  }>;
  const isAdmin = caller.role === 'ADMIN';
  const cleanLocations = locations.map((location) => {
    const member = members.find((item) => item.userId === location.user_id);
    return {
      name: member ? member.name : 'Participant',
      locationName: location.location_name || `${Number(location.lat).toFixed(2)}, ${Number(location.lng).toFixed(2)}`,
      lat: isAdmin || location.user_id === user.id ? location.lat : 0,
      lng: isAdmin || location.user_id === user.id ? location.lng : 0,
      userId: location.user_id,
    };
  });
  const currentUserLocation = locations.find((location) => location.user_id === user.id);
  const currentUserBudget = budgets.find((budget) => budget.user_id === user.id)?.max_budget || null;

  const summary = summaryRes || {};
  const budgetSummary = {
    min: Math.round(Number((summary as { min?: number }).min || 0)),
    avg: Math.round(Number((summary as { avg?: number }).avg || 0)),
    max: Math.round(Number((summary as { max?: number }).max || 0)),
    total: Math.round(Number((summary as { total?: number }).total || 0)),
    submittedCount: Number((summary as { submittedCount?: number }).submittedCount || 0),
    totalMembers: members.length,
  };

  return json(
    {
      success: true,
      data: {
        group: { ...group, isReady: isGroupReady((group as { status: string }).status, members, budgets, locations) },
        members,
        budgetSummary,
        submittedBudgetUserIds: budgets.map((budget) => budget.user_id),
        locations: cleanLocations,
        currentUser: {
          id: user.id,
          role: caller.role,
          budget: currentUserBudget,
          location: currentUserLocation
            ? {
                id: currentUserLocation.id,
                groupId,
                userId: user.id,
                lat: currentUserLocation.lat,
                lng: currentUserLocation.lng,
                locationName: currentUserLocation.location_name,
              }
            : null,
        },
      },
    },
    { headers: corsHeaders(env) }
  );
}

function isGroupReady(
  status: string,
  members: Array<{ userId: string }>,
  budgets: Array<{ user_id: string }>,
  locations: Array<{ user_id: string }>
) {
  if (status !== 'COLLECTING_DETAILS' && status !== 'READY_TO_GENERATE') {
    return ['READY_TO_GENERATE', 'GENERATING', 'VOTING', 'COMPLETED', 'ARCHIVED'].includes(status);
  }

  if (members.length === 0) return false;
  return members.every((member) => {
    return (
      budgets.some((budget) => budget.user_id === member.userId) &&
      locations.some((location) => location.user_id === member.userId)
    );
  });
}

async function joinGroup(request: Request, env: Env) {
  const body = await readJson<{ user: ApiUser; inviteCode: string }>(request);
  const user = await upsertUser(env.DB, body.user);
  const normalized = normalizeInviteCode(body.inviteCode);

  const invites = await env.DB
    .prepare(
      `SELECT i.id, i.group_id AS groupId, i.invite_code AS inviteCode, i.expires_at AS expiresAt, i.revoked
       FROM invites i
       WHERE i.revoked = 0`
    )
    .all<{ groupId: string; inviteCode: string; expiresAt: number; revoked: number }>();

  const invite = (invites.results || []).find((item) => normalizeInviteCode(item.inviteCode) === normalized);
  if (!invite) {
    return json(
      { success: false, error: { code: 'NOT_FOUND', message: 'Active invite code not found.' } },
      { status: 404, headers: corsHeaders(env) }
    );
  }

  if (Math.floor(Date.now() / 1000) > invite.expiresAt) {
    return json(
      { success: false, error: { code: 'INVITE_EXPIRED', message: 'Invite link has expired.' } },
      { status: 410, headers: corsHeaders(env) }
    );
  }

  const existing = await env.DB
    .prepare(`SELECT id, group_id AS groupId, user_id AS userId, role FROM group_members WHERE group_id = ? AND user_id = ?`)
    .bind(invite.groupId, user.id)
    .first();

  if (existing) {
    return json(
      { success: false, error: { code: 'DUPLICATE', message: 'You are already a member of this group.' } },
      { status: 409, headers: corsHeaders(env) }
    );
  }

  const member = {
    id: uuid(),
    groupId: invite.groupId,
    userId: user.id,
    role: 'MEMBER',
  };

  await env.DB
    .prepare(`INSERT INTO group_members (id, group_id, user_id, role) VALUES (?, ?, ?, 'MEMBER')`)
    .bind(member.id, member.groupId, member.userId)
    .run();

  return json({ success: true, data: member }, { headers: corsHeaders(env) });
}

async function submitBudget(request: Request, env: Env, groupId: string) {
  const body = await readJson<{ clerkId: string; maxBudget: number }>(request);
  const user = await findUserByClerkId(env.DB, body.clerkId);
  if (!user) {
    return json(
      { success: false, error: { code: 'NOT_FOUND', message: 'User has not been synced to D1 yet.' } },
      { status: 404, headers: corsHeaders(env) }
    );
  }

  const id = uuid();
  await env.DB
    .prepare(
      `INSERT INTO budgets (id, group_id, user_id, max_budget)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(group_id, user_id)
       DO UPDATE SET max_budget = excluded.max_budget, updated_at = CURRENT_TIMESTAMP`
    )
    .bind(id, groupId, user.id, body.maxBudget)
    .run();

  await updateReadiness(env.DB, groupId);
  const budget = await env.DB
    .prepare(
      `SELECT id, group_id AS groupId, user_id AS userId, max_budget AS maxBudget, created_at AS createdAt, updated_at AS updatedAt
       FROM budgets
       WHERE group_id = ? AND user_id = ?`
    )
    .bind(groupId, user.id)
    .first();

  return json({ success: true, data: budget }, { headers: corsHeaders(env) });
}

async function submitLocation(request: Request, env: Env, groupId: string) {
  const body = await readJson<{ clerkId: string; lat: number; lng: number; locationName?: string | null }>(request);
  const user = await findUserByClerkId(env.DB, body.clerkId);
  if (!user) {
    return json(
      { success: false, error: { code: 'NOT_FOUND', message: 'User has not been synced to D1 yet.' } },
      { status: 404, headers: corsHeaders(env) }
    );
  }

  const id = uuid();
  await env.DB
    .prepare(
      `INSERT INTO locations (id, group_id, user_id, lat, lng, location_name)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(group_id, user_id)
       DO UPDATE SET lat = excluded.lat, lng = excluded.lng, location_name = excluded.location_name, updated_at = CURRENT_TIMESTAMP`
    )
    .bind(id, groupId, user.id, body.lat, body.lng, body.locationName || null)
    .run();

  await updateReadiness(env.DB, groupId);
  const location = await env.DB
    .prepare(
      `SELECT id, group_id AS groupId, user_id AS userId, lat, lng, location_name AS locationName, created_at AS createdAt, updated_at AS updatedAt
       FROM locations
       WHERE group_id = ? AND user_id = ?`
    )
    .bind(groupId, user.id)
    .first();

  return json({ success: true, data: location }, { headers: corsHeaders(env) });
}

async function submitVibes(request: Request, env: Env, groupId: string) {
  const body = await readJson<{ clerkId: string; vibes: string[] }>(request);
  const user = await findUserByClerkId(env.DB, body.clerkId);
  if (!user) {
    return json(
      { success: false, error: { code: 'NOT_FOUND', message: 'User has not been synced to D1 yet.' } },
      { status: 404, headers: corsHeaders(env) }
    );
  }

  await env.DB
    .prepare(`UPDATE group_members SET vibes = ? WHERE group_id = ? AND user_id = ?`)
    .bind(JSON.stringify(body.vibes), groupId, user.id)
    .run();

  const member = await env.DB
    .prepare(
      `SELECT id, group_id AS groupId, user_id AS userId, role, vibes, created_at AS createdAt
       FROM group_members
       WHERE group_id = ? AND user_id = ?`
    )
    .bind(groupId, user.id)
    .first();

  return json({ success: true, data: member }, { headers: corsHeaders(env) });
}

async function startDetailsCollection(request: Request, env: Env, groupId: string) {
  const body = await readJson<{ clerkId: string }>(request);
  const user = await findUserByClerkId(env.DB, body.clerkId);
  if (!user) {
    return json(
      { success: false, error: { code: 'NOT_FOUND', message: 'User has not been synced to D1 yet.' } },
      { status: 404, headers: corsHeaders(env) }
    );
  }

  const member = await env.DB
    .prepare(`SELECT role FROM group_members WHERE group_id = ? AND user_id = ?`)
    .bind(groupId, user.id)
    .first<{ role: string }>();

  if (!member || member.role !== 'ADMIN') {
    return json(
      { success: false, error: { code: 'FORBIDDEN', message: 'Only the group admin can lock the member list.' } },
      { status: 403, headers: corsHeaders(env) }
    );
  }

  await env.DB
    .prepare(`UPDATE groups SET status = 'COLLECTING_DETAILS', updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
    .bind(groupId)
    .run();

  const group = await getGroupById(env.DB, groupId);
  return json({ success: true, data: group }, { headers: corsHeaders(env) });
}

async function updateReadiness(db: D1Database, groupId: string) {
  const group = await db.prepare(`SELECT status FROM groups WHERE id = ?`).bind(groupId).first<{ status: string }>();
  if (!group || group.status !== 'COLLECTING_DETAILS') return;

  const [membersRes, budgetsRes, locationsRes] = await Promise.all([
    db.prepare(`SELECT user_id AS userId FROM group_members WHERE group_id = ?`).bind(groupId).all<{ userId: string }>(),
    db.prepare(`SELECT user_id AS userId FROM budgets WHERE group_id = ?`).bind(groupId).all<{ userId: string }>(),
    db.prepare(`SELECT user_id AS userId FROM locations WHERE group_id = ?`).bind(groupId).all<{ userId: string }>(),
  ]);

  const members = membersRes.results || [];
  if (
    members.length > 0 &&
    members.every((member) => {
      return (
        (budgetsRes.results || []).some((budget) => budget.userId === member.userId) &&
        (locationsRes.results || []).some((location) => location.userId === member.userId)
      );
    })
  ) {
    await db
      .prepare(`UPDATE groups SET status = 'READY_TO_GENERATE', updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .bind(groupId)
      .run();
  }
}

async function health(env: Env) {
  await env.DB.prepare(`SELECT id FROM users LIMIT 1`).first();
  return json({ ok: true, database: { reachable: true, driver: 'd1-binding' } }, { headers: corsHeaders(env) });
}

export default {
  async fetch(request: Request, env: Env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders(env) });
    }

    const url = new URL(request.url);

    try {
      if (url.pathname === '/health/db' && request.method === 'GET') {
        return health(env);
      }

      const unauthorized = await assertAuthorized(request, env);
      if (unauthorized) return unauthorized;

      if (url.pathname === '/groups' && request.method === 'POST') return createGroup(request, env);
      if (url.pathname === '/groups' && request.method === 'GET') return listGroups(request, env);
      if (url.pathname === '/groups/join' && request.method === 'POST') return joinGroup(request, env);

      const groupMatch = url.pathname.match(/^\/groups\/([^/]+)(?:\/([^/]+))?$/);
      if (groupMatch) {
        const groupId = groupMatch[1];
        const action = groupMatch[2];

        if (!action && request.method === 'GET') return getGroupDetails(request, env, groupId);
        if (action === 'start-details' && request.method === 'PATCH') return startDetailsCollection(request, env, groupId);
        if (action === 'budget' && request.method === 'POST') return submitBudget(request, env, groupId);
        if (action === 'location' && request.method === 'POST') return submitLocation(request, env, groupId);
        if (action === 'vibes' && request.method === 'POST') return submitVibes(request, env, groupId);
      }

      return json(
        { success: false, error: { code: 'NOT_FOUND', message: 'Route not found.' } },
        { status: 404, headers: corsHeaders(env) }
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unexpected Worker error.';
      return json(
        { success: false, error: { code: 'INTERNAL_ERROR', message } },
        { status: 500, headers: corsHeaders(env) }
      );
    }
  },
};
