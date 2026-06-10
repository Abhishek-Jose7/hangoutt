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
    group: {
      name: string;
      groupType: string;
      description?: string | null;
      vibes?: string[];
      outingDate?: string | null;
      outingTime?: string | null;
      isFastTrack?: boolean;
    };
  }>(request);
  const user = await upsertUser(env.DB, body.user);
  const groupId = uuid();
  const code = inviteCode();
  const inviteId = uuid();
  const memberId = uuid();
  const expiresAt = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60;
  const description = body.group.description || null;
  const vibes = body.group.vibes ? JSON.stringify(body.group.vibes) : null;
  const outingDate = body.group.outingDate || null;
  const outingTime = body.group.outingTime || null;
  const isFastTrack = body.group.isFastTrack ? 1 : 0;
  const now = new Date().toISOString();
  let timerExpiresAt: string | null = null;
  if (isFastTrack === 1) {
    timerExpiresAt = new Date(Date.now() + 30 * 1000).toISOString();
  }

  await env.DB.batch([
    env.DB
      .prepare(
        `INSERT INTO groups
         (id, name, description, group_type, vibes, creator_id, invite_code, status, voting_status, max_members, outing_date, outing_time, is_fast_track, timer_expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'COLLECTING_MEMBERS', 'CLOSED', 20, ?, ?, ?, ?)`
      )
      .bind(groupId, body.group.name, description, body.group.groupType, vibes, user.id, code, outingDate, outingTime, isFastTrack, timerExpiresAt),
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
    outingDate,
    outingTime,
    isFastTrack,
    timerExpiresAt,
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
        g.outing_date AS outingDate,
        g.outing_time AS outingTime,
        g.is_fast_track AS isFastTrack,
        g.timer_expires_at AS timerExpiresAt,
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
        g.outing_date AS outingDate,
        g.outing_time AS outingTime,
        g.is_fast_track AS isFastTrack,
        g.timer_expires_at AS timerExpiresAt,
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
  const budgets = (budgetsRes.results || []) as Array<{ user_id: string; max_budget: number; travel_included: number | null }>;
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
  const currentUserBudgetRecord = budgets.find((budget) => budget.user_id === user.id);
  const currentUserBudget = currentUserBudgetRecord?.max_budget || null;
  const currentUserTravelIncluded = currentUserBudgetRecord ? currentUserBudgetRecord.travel_included === 1 : true;

  const summary = summaryRes || {};
  const budgetSummary = {
    min: Math.round(Number((summary as { min?: number }).min || 0)),
    avg: Math.round(Number((summary as { avg?: number }).avg || 0)),
    max: Math.round(Number((summary as { max?: number }).max || 0)),
    total: Math.round(Number((summary as { total?: number }).total || 0)),
    submittedCount: Number((summary as { submittedCount?: number }).submittedCount || 0),
    totalMembers: members.length,
  };

  const isReady = isGroupReady((group as { status: string }).status, members, budgets, locations);
  if (isReady && (group as { status: string }).status === 'COLLECTING_DETAILS') {
    await env.DB
      .prepare(`UPDATE groups SET status = 'READY_TO_GENERATE', updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .bind(groupId)
      .run();
    (group as any).status = 'READY_TO_GENERATE';
  }

  return json(
    {
      success: true,
      data: {
        group: { ...group, isReady },
        members,
        budgetSummary,
        submittedBudgetUserIds: budgets.map((budget) => budget.user_id),
        locations: cleanLocations,
        currentUser: {
          id: user.id,
          role: caller.role,
          budget: currentUserBudget,
          travelIncluded: currentUserTravelIncluded,
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
    .first<{ id: string; groupId: string; userId: string; role: string }>();

  if (existing) {
    return json({ success: true, data: existing }, { headers: corsHeaders(env) });
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
  const body = await readJson<{ clerkId: string; maxBudget: number; travelIncluded?: boolean }>(request);
  const user = await findUserByClerkId(env.DB, body.clerkId);
  if (!user) {
    return json(
      { success: false, error: { code: 'NOT_FOUND', message: 'User has not been synced to D1 yet.' } },
      { status: 404, headers: corsHeaders(env) }
    );
  }

  const id = uuid();
  const travelIncludedVal = body.travelIncluded === false ? 0 : 1;
  await env.DB
    .prepare(
      `INSERT INTO budgets (id, group_id, user_id, max_budget, travel_included)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(group_id, user_id)
       DO UPDATE SET max_budget = excluded.max_budget, travel_included = excluded.travel_included, updated_at = CURRENT_TIMESTAMP`
    )
    .bind(id, groupId, user.id, body.maxBudget, travelIncludedVal)
    .run();

  await updateReadiness(env.DB, groupId);
  const budget = await env.DB
    .prepare(
      `SELECT id, group_id AS groupId, user_id AS userId, max_budget AS maxBudget, travel_included AS travelIncluded, created_at AS createdAt, updated_at AS updatedAt
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

  const groupData = await env.DB
    .prepare(`SELECT is_fast_track AS isFastTrack FROM groups WHERE id = ?`)
    .bind(groupId)
    .first<{ isFastTrack: number }>();

  const timerExpiresAt = groupData?.isFastTrack === 1 ? new Date(Date.now() + 30 * 1000).toISOString() : null;

  await env.DB
    .prepare(`UPDATE groups SET status = 'COLLECTING_DETAILS', timer_expires_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
    .bind(timerExpiresAt, groupId)
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

async function getUser(request: Request, env: Env) {
  const url = new URL(request.url);
  const clerkId = url.searchParams.get('clerkId');
  if (!clerkId) {
    return json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Missing clerkId.' } }, { status: 422, headers: corsHeaders(env) });
  }
  const user = await env.DB.prepare(
    `SELECT id, clerk_id AS clerkId, email, name, image_url AS imageUrl,
            preferred_budget_min AS preferredBudgetMin, preferred_budget_max AS preferredBudgetMax,
            favorite_activities AS favoriteActivities
     FROM users WHERE clerk_id = ?`
  ).bind(clerkId).first();
  if (!user) {
    return json({ success: false, error: { code: 'NOT_FOUND', message: 'User not found.' } }, { status: 404, headers: corsHeaders(env) });
  }
  return json({ success: true, data: user }, { headers: corsHeaders(env) });
}

async function updateUserProfile(request: Request, env: Env) {
  const body = await readJson<{
    clerkId: string;
    name: string;
    preferredBudgetMin?: number;
    preferredBudgetMax?: number;
    favoriteActivities?: string[];
  }>(request);
  
  const user = await findUserByClerkId(env.DB, body.clerkId);
  if (!user) {
    return json({ success: false, error: { code: 'NOT_FOUND', message: 'User not found.' } }, { status: 404, headers: corsHeaders(env) });
  }

  const minB = body.preferredBudgetMin !== undefined ? body.preferredBudgetMin : null;
  const maxB = body.preferredBudgetMax !== undefined ? body.preferredBudgetMax : null;
  const favAct = body.favoriteActivities ? JSON.stringify(body.favoriteActivities) : null;

  await env.DB.prepare(
    `UPDATE users
     SET name = ?, preferred_budget_min = ?, preferred_budget_max = ?, favorite_activities = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).bind(body.name, minB, maxB, favAct, user.id).run();

  const updated = {
    id: user.id,
    clerkId: body.clerkId,
    email: user.email,
    name: body.name,
    imageUrl: user.imageUrl,
    preferredBudgetMin: minB,
    preferredBudgetMax: maxB,
    favoriteActivities: body.favoriteActivities || []
  };

  return json({ success: true, data: updated }, { headers: corsHeaders(env) });
}

async function savePlans(request: Request, env: Env, groupId: string) {
  const body = await readJson<{
    plans: any[];
    slots: any[];
    memberTravels: any[];
  }>(request);

  const group = await getGroupById(env.DB, groupId);
  if (!group) {
    return json({ success: false, error: { code: 'NOT_FOUND', message: 'Group not found.' } }, { status: 404, headers: corsHeaders(env) });
  }

  // Determine old plan IDs to delete associated slot/metrics/votes safely
  const oldPlans = await env.DB.prepare(`SELECT id FROM plans WHERE group_id = ?`).bind(groupId).all<{ id: string }>();
  const oldPlanIds = (oldPlans.results || []).map(p => p.id);

  const statements = [];

  if (oldPlanIds.length > 0) {
    for (const planId of oldPlanIds) {
      statements.push(env.DB.prepare(`DELETE FROM member_travel_metrics WHERE plan_id = ?`).bind(planId));
      statements.push(env.DB.prepare(`DELETE FROM plan_slots WHERE plan_id = ?`).bind(planId));
      statements.push(env.DB.prepare(`DELETE FROM votes WHERE plan_id = ?`).bind(planId));
    }
  }
  statements.push(env.DB.prepare(`DELETE FROM plans WHERE group_id = ?`).bind(groupId));

  // Insert new plans
  for (const plan of body.plans) {
    statements.push(env.DB.prepare(
      `INSERT INTO plans (
        id, group_id, plan_index, name, tagline, meetup_zone, budget_tier, 
        total_estimated_cost_per_head, total_duration_minutes, score,
        experience_score, travel_score, budget_score, fairness_score, popularity_score,
        group_type_match_score, vibe_match_score, composite_score,
        avg_train_time, avg_cab_time, avg_train_cost, avg_cab_cost,
        longest_travel_time, shortest_travel_time, travel_fairness_score, generated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      plan.id, plan.groupId, plan.planIndex, plan.name, plan.tagline, plan.meetupZone, plan.budgetTier || 'BALANCED',
      plan.totalEstimatedCostPerHead, plan.totalDurationMinutes, plan.score,
      plan.experienceScore, plan.travelScore, plan.budgetScore, plan.fairnessScore, plan.popularityScore,
      plan.groupTypeMatchScore, plan.vibeMatchScore, plan.compositeScore,
      plan.avgTrainTime, plan.avgCabTime, plan.avgTrainCost, plan.avgCabCost,
      plan.longestTravelTime, plan.shortestTravelTime, plan.travelFairnessScore, plan.generatedAt || new Date().toISOString()
    ));
  }

  // Insert new slots
  for (const slot of body.slots) {
    statements.push(env.DB.prepare(
      `INSERT INTO plan_slots (
        id, plan_id, slot_order, venue_id, experience_id, venue_name, name, category, 
        arrival_time, duration_minutes, travel_to_next_minutes, estimated_cost_per_head, note,
        travel_to_next_cost, image_url, link
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      slot.id, slot.planId, slot.slotOrder, slot.venueId || null, slot.experienceId || null, slot.venueName || null, slot.name, slot.category,
      slot.arrivalTime, slot.durationMinutes, slot.travelToNextMinutes || null, slot.estimatedCostPerHead, slot.note,
      slot.travelToNextCost || null, slot.imageUrl || null, slot.link || null
    ));
  }

  // Insert new travel metrics
  for (const t of body.memberTravels) {
    statements.push(env.DB.prepare(
      `INSERT INTO member_travel_metrics (
        id, plan_id, user_id, train_time, train_cost, cab_time, cab_cost, walk_time
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      t.id, t.planId, t.userId, t.trainTime, t.trainCost, t.cabTime, t.cabCost, t.walkTime
    ));
  }

  // Update group status to VOTING and open votingStatus
  const isFastTrackVal = (group as any)?.isFastTrack === 1 ? 1 : 0;
  const timerExpiresAt = isFastTrackVal === 1 ? new Date(Date.now() + 30 * 1000).toISOString() : null;
  statements.push(env.DB.prepare(
    `UPDATE groups SET status = 'VOTING', voting_status = 'OPEN', timer_expires_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
  ).bind(timerExpiresAt, groupId));

  await env.DB.batch(statements);

  return json({ success: true }, { headers: corsHeaders(env) });
}

async function getPlans(request: Request, env: Env, groupId: string) {
  // Query plans
  const plansRes = await env.DB.prepare(
    `SELECT 
      id, group_id AS groupId, plan_index AS planIndex, name, tagline, meetup_zone AS meetupZone,
      budget_tier AS budgetTier, total_estimated_cost_per_head AS totalEstimatedCostPerHead,
      total_duration_minutes AS totalDurationMinutes, score,
      experience_score AS experienceScore, travel_score AS travelScore, budget_score AS budgetScore,
      fairness_score AS fairnessScore, popularity_score AS popularityScore,
      group_type_match_score AS groupTypeMatchScore, vibe_match_score AS vibeMatchScore,
      composite_score AS compositeScore, avg_train_time AS avgTrainTime, avg_cab_time AS avgCabTime,
      avg_train_cost AS avgTrainCost, avg_cab_cost AS avgCabCost, longest_travel_time AS longestTravelTime,
      shortest_travel_time AS shortestTravelTime, travel_fairness_score AS travelFairnessScore,
      generated_at AS generatedAt
     FROM plans
     WHERE group_id = ?
     ORDER BY plan_index`
  ).bind(groupId).all<any>();

  const groupPlans = plansRes.results || [];
  if (groupPlans.length === 0) {
    return json({ success: true, data: [] }, { headers: corsHeaders(env) });
  }

  const planIds = groupPlans.map(p => p.id);
  
  // Fetch slots
  const slotsRes = await env.DB.prepare(
    `SELECT 
      id, plan_id AS planId, slot_order AS slotOrder, venue_id AS venueId,
      experience_id AS experienceId, venue_name AS venueName, name, category,
      arrival_time AS arrivalTime, duration_minutes AS durationMinutes,
      travel_to_next_minutes AS travelToNextMinutes, estimated_cost_per_head AS estimatedCostPerHead, note,
      travel_to_next_cost AS travelToNextCost, image_url AS imageUrl, link
     FROM plan_slots
     WHERE plan_id IN (${planIds.map(() => '?').join(', ')})
     ORDER BY slot_order`
  ).bind(...planIds).all<any>();

  const slots = slotsRes.results || [];
  const slotsMap = slots.reduce((acc, slot) => {
    if (!acc[slot.planId]) acc[slot.planId] = [];
    acc[slot.planId].push(slot);
    return acc;
  }, {} as Record<string, any[]>);

  // Fetch travel metrics
  const travelsRes = await env.DB.prepare(
    `SELECT 
      id, plan_id AS planId, user_id AS userId, train_time AS trainTime,
      train_cost AS trainCost, cab_time AS cabTime, cab_cost AS cabCost, walk_time AS walkTime,
      created_at AS createdAt
     FROM member_travel_metrics
     WHERE plan_id IN (${planIds.map(() => '?').join(', ')})`
  ).bind(...planIds).all<any>();

  const travels = travelsRes.results || [];
  const travelsMap = travels.reduce((acc, t) => {
    if (!acc[t.planId]) acc[t.planId] = [];
    acc[t.planId].push(t);
    return acc;
  }, {} as Record<string, any[]>);

  const data = groupPlans.map(p => ({
    ...p,
    slots: slotsMap[p.id] || [],
    memberTravelMetrics: travelsMap[p.id] || [],
  }));

  return json({ success: true, data }, { headers: corsHeaders(env) });
}

async function castVote(request: Request, env: Env, groupId: string) {
  const body = await readJson<{
    clerkId: string;
    planId: string;
  }>(request);

  const user = await findUserByClerkId(env.DB, body.clerkId);
  if (!user) {
    return json({ success: false, error: { code: 'NOT_FOUND', message: 'User not found.' } }, { status: 404, headers: corsHeaders(env) });
  }

  const member = await env.DB.prepare(`SELECT role FROM group_members WHERE group_id = ? AND user_id = ?`).bind(groupId, user.id).first();
  if (!member) {
    return json({ success: false, error: { code: 'FORBIDDEN', message: 'Not group member.' } }, { status: 403, headers: corsHeaders(env) });
  }

  const group = await getGroupById(env.DB, groupId);
  if (!group || (group as any).status !== 'VOTING' || (group as any).votingStatus !== 'OPEN') {
    return json({ success: false, error: { code: 'VOTE_CLOSED', message: 'Voting is closed.' } }, { status: 400, headers: corsHeaders(env) });
  }

  const voteId = uuid();
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO votes (id, group_id, user_id, plan_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(group_id, user_id)
     DO UPDATE SET plan_id = excluded.plan_id, updated_at = excluded.updated_at`
  ).bind(voteId, groupId, user.id, body.planId, now, now).run();

  const vote = {
    id: voteId,
    groupId,
    userId: user.id,
    planId: body.planId,
    createdAt: now,
    updatedAt: now
  };

  return json({ success: true, data: vote }, { headers: corsHeaders(env) });
}

async function tallyVotes(request: Request, env: Env, groupId: string) {
  const tallies = await env.DB.prepare(
    `SELECT plan_id AS planId, COUNT(id) AS count
     FROM votes
     WHERE group_id = ?
     GROUP BY plan_id`
  ).bind(groupId).all<{ planId: string; count: number }>();

  return json({ success: true, data: tallies.results || [] }, { headers: corsHeaders(env) });
}

async function getUserVote(request: Request, env: Env, groupId: string) {
  const url = new URL(request.url);
  const clerkId = url.searchParams.get('clerkId');
  if (!clerkId) {
    return json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Missing clerkId.' } }, { status: 422, headers: corsHeaders(env) });
  }

  const user = await findUserByClerkId(env.DB, clerkId);
  if (!user) {
    return json({ success: false, error: { code: 'NOT_FOUND', message: 'User not found.' } }, { status: 404, headers: corsHeaders(env) });
  }

  const vote = await env.DB.prepare(
    `SELECT plan_id AS planId FROM votes WHERE group_id = ? AND user_id = ?`
  ).bind(groupId, user.id).first<{ planId: string }>();

  return json({ success: true, data: vote ? vote.planId : null }, { headers: corsHeaders(env) });
}

async function closeVoting(request: Request, env: Env, groupId: string) {
  const body = await readJson<{
    clerkId: string;
    winnerPlanId: string;
    outingDate: string;
    groupName: string;
    planName: string;
    planTagline: string;
    venuesJson: string;
    participantsJson: string;
    totalCostPerHead: number;
  }>(request);

  const user = await findUserByClerkId(env.DB, body.clerkId);
  if (!user) {
    return json({ success: false, error: { code: 'NOT_FOUND', message: 'User not found.' } }, { status: 404, headers: corsHeaders(env) });
  }

  const member = await env.DB.prepare(`SELECT role FROM group_members WHERE group_id = ? AND user_id = ?`).bind(groupId, user.id).first<{ role: string }>();
  if (!member || member.role !== 'ADMIN') {
    return json({ success: false, error: { code: 'FORBIDDEN', message: 'Only admin can close voting.' } }, { status: 403, headers: corsHeaders(env) });
  }

  const historyId = uuid();
  const now = new Date().toISOString();

  await env.DB.batch([
    env.DB.prepare(
      `UPDATE groups 
       SET status = 'COMPLETED', voting_status = 'CLOSED', winning_plan_id = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    ).bind(body.winnerPlanId, groupId),
    env.DB.prepare(
      `INSERT INTO history (
        id, group_id, plan_id, outing_date, group_name, plan_name, plan_tagline, 
        venues_json, participants_json, total_cost_per_head, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      historyId, groupId, body.winnerPlanId, body.outingDate, body.groupName, body.planName, body.planTagline,
      body.venuesJson, body.participantsJson, body.totalCostPerHead, now
    )
  ]);

  return json({ success: true }, { headers: corsHeaders(env) });
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
      if (url.pathname === '/users' && request.method === 'GET') return getUser(request, env);
      if (url.pathname === '/users/profile' && request.method === 'PATCH') return updateUserProfile(request, env);

      const groupMatch = url.pathname.match(/^\/groups\/([^/]+)(?:\/([^/]+))?$/);
      if (groupMatch) {
        const groupId = groupMatch[1];
        const action = groupMatch[2];

        if (!action && request.method === 'GET') return getGroupDetails(request, env, groupId);
        if (action === 'start-details' && request.method === 'PATCH') return startDetailsCollection(request, env, groupId);
        if (action === 'budget' && request.method === 'POST') return submitBudget(request, env, groupId);
        if (action === 'location' && request.method === 'POST') return submitLocation(request, env, groupId);
        if (action === 'vibes' && request.method === 'POST') return submitVibes(request, env, groupId);
        if (action === 'plans' && request.method === 'POST') return savePlans(request, env, groupId);
        if (action === 'plans' && request.method === 'GET') return getPlans(request, env, groupId);
        if (action === 'vote' && request.method === 'POST') return castVote(request, env, groupId);
        if (action === 'votes' && request.method === 'GET') return tallyVotes(request, env, groupId);
        if (action === 'votes-user' && request.method === 'GET') return getUserVote(request, env, groupId);
        if (action === 'close-voting' && request.method === 'PATCH') return closeVoting(request, env, groupId);
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
