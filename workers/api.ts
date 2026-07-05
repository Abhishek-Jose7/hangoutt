type Env = {
  DB: D1Database;
  HANGOUT_API_SECRET: string;
  CORS_ORIGIN?: string;
  OLA_MAPS_API_KEY?: string;
  GOOGLE_MAPS_API_KEY?: string;
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
        g.generation_options AS generationOptions,
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
        g.generation_options AS generationOptions,
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
          gm.is_present AS isPresent,
          gm.created_at AS joinedAt
         FROM group_members gm
         INNER JOIN users u ON u.id = gm.user_id
         WHERE gm.group_id = ?`
      )
      .bind(groupId)
      .all(),
    env.DB.prepare(`SELECT * FROM budgets WHERE group_id = ?`).bind(groupId).all(),
    env.DB.prepare(`SELECT * FROM locations WHERE group_id = ?`).bind(groupId).all(),
    env.DB.prepare(`SELECT 1`).bind().all() // placeholder since we calculate summary in JS now
  ]);

  const members = (membersRes.results || []) as Array<{ userId: string; name: string; role: string; isPresent: number }>;
  members.forEach((m) => {
    m.isPresent = 1;
  });
  const presentMembers = members;
  const presentUserIds = presentMembers.map(m => m.userId);

  const budgets = ((budgetsRes.results || []) as Array<{ user_id: string; max_budget: number; travel_included: number | null }>)
    .filter(b => presentUserIds.includes(b.user_id));
  const locations = ((locationsRes.results || []) as Array<{
    id: string;
    user_id: string;
    lat: number;
    lng: number;
    location_name: string | null;
  }>).filter(l => presentUserIds.includes(l.user_id));

  const cleanMembers = members.map((m) => {
    const budgetRec = budgets.find((b) => b.user_id === m.userId);
    return {
      ...m,
      budget: budgetRec ? budgetRec.max_budget : null
    };
  });

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

  const presentBudgets = budgets.map((b) => b.max_budget);
  const budgetSummary = {
    min: presentBudgets.length > 0 ? Math.min(...presentBudgets) : 0,
    avg: presentBudgets.length > 0 ? Math.round(presentBudgets.reduce((sum, b) => sum + b, 0) / presentBudgets.length) : 0,
    max: presentBudgets.length > 0 ? Math.max(...presentBudgets) : 0,
    total: presentBudgets.length > 0 ? presentBudgets.reduce((sum, b) => sum + b, 0) : 0,
    submittedCount: budgets.length,
    totalMembers: presentMembers.length,
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
        members: cleanMembers,
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
  members: Array<{ userId: string; isPresent?: number }>,
  budgets: Array<{ user_id: string }>,
  locations: Array<{ user_id: string }>
) {
  if (status !== 'COLLECTING_DETAILS' && status !== 'READY_TO_GENERATE') {
    return ['READY_TO_GENERATE', 'GENERATING', 'VOTING', 'COMPLETED', 'ARCHIVED'].includes(status);
  }

  return members.length > 0;
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
    db.prepare(`SELECT user_id AS userId, is_present AS isPresent FROM group_members WHERE group_id = ?`).bind(groupId).all<{ userId: string; isPresent: number }>(),
    db.prepare(`SELECT user_id AS userId FROM budgets WHERE group_id = ?`).bind(groupId).all<{ userId: string }>(),
    db.prepare(`SELECT user_id AS userId FROM locations WHERE group_id = ?`).bind(groupId).all<{ userId: string }>(),
  ]);

  const members = membersRes.results || [];
  if (members.length > 0) {
    await db
      .prepare(`UPDATE groups SET status = 'READY_TO_GENERATE', updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .bind(groupId)
      .run();
  }
}

async function updateMemberPresence(request: Request, env: Env, groupId: string) {
  const body = await readJson<{ clerkId: string; presenceMap: Record<string, boolean> }>(request);
  const user = await findUserByClerkId(env.DB, body.clerkId);
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

  if (!caller || caller.role !== 'ADMIN') {
    return json(
      { success: false, error: { code: 'FORBIDDEN', message: 'Only the group admin can update member presence.' } },
      { status: 403, headers: corsHeaders(env) }
    );
  }

  const statements = [];
  for (const [userId, isPresent] of Object.entries(body.presenceMap)) {
    statements.push(
      env.DB.prepare(`UPDATE group_members SET is_present = ? WHERE group_id = ? AND user_id = ?`)
        .bind(isPresent ? 1 : 0, groupId, userId)
    );
  }
  await env.DB.batch(statements);

  await updateReadiness(env.DB, groupId);

  return json({ success: true }, { headers: corsHeaders(env) });
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
    venues?: any[];
    generationOptions?: string[];
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

  // Sync any new venues passed in the body first to prevent foreign key errors on D1
  if (body.venues && Array.isArray(body.venues)) {
    const now = new Date().toISOString();
    for (const v of body.venues) {
      if (!v.id || v.id.startsWith('fb_') || v.id.startsWith('fallback_')) continue;

      let sourceName = 'GOOGLE';
      let sourcePlaceId = v.id;
      if (v.id.startsWith('GOOGLE_')) {
        sourcePlaceId = v.id.substring(7);
      } else if (v.id.startsWith('OLA_')) {
        sourceName = 'OLA';
        sourcePlaceId = v.id.substring(4);
      }

      // 1. Insert into places table
      statements.push(env.DB.prepare(
        `INSERT OR IGNORE INTO places (
          id, name, address, lat, lng, rating, review_count, 
          source_name, source_place_id, last_verified, verified_at, 
          is_featured, is_hidden, boost_factor, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 1.0, ?, ?)`
      ).bind(
        v.id, v.name, v.address || '', v.lat, v.lng, v.rating || null, v.reviewCount || 0,
        sourceName, sourcePlaceId, now, now, now, now
      ));

      // 2. Insert into place_categories table
      if (v.category) {
        statements.push(env.DB.prepare(
          `INSERT OR IGNORE INTO place_categories (id, place_id, category) VALUES (?, ?, ?)`
        ).bind(crypto.randomUUID(), v.id, v.category));
      }

      // 3. Insert into place_costs table
      statements.push(env.DB.prepare(
        `INSERT OR IGNORE INTO place_costs (place_id, mandatory_cost, optional_cost_min, optional_cost_max) VALUES (?, ?, ?, ?)`
      ).bind(
        v.id, v.mandatoryCost || 0, v.optionalCostMin || 0, v.optionalCostMax || 0
      ));
    }
  }

  // Insert new plans
  for (const plan of body.plans) {
    statements.push(env.DB.prepare(
      `INSERT INTO plans (
        id, group_id, plan_index, name, tagline, meetup_zone, budget_tier, 
        total_estimated_cost_per_head, total_duration_minutes, score,
        experience_score, travel_score, budget_score, fairness_score, popularity_score,
        group_type_match_score, vibe_match_score, composite_score,
        avg_train_time, avg_cab_time, avg_train_cost, avg_cab_cost,
        longest_travel_time, shortest_travel_time, travel_fairness_score,
        mandatory_cost, optional_cost_min, optional_cost_max, why_recommended,
        avg_auto_time, avg_auto_cost, avg_total_time, avg_total_cost, avg_walk_time,
        generated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      plan.id, plan.groupId, plan.planIndex, plan.name, plan.tagline, plan.meetupZone, plan.budgetTier || 'BALANCED',
      plan.totalEstimatedCostPerHead, plan.totalDurationMinutes, plan.score,
      plan.experienceScore, plan.travelScore, plan.budgetScore, plan.fairnessScore, plan.popularityScore,
      plan.groupTypeMatchScore, plan.vibeMatchScore, plan.compositeScore,
      plan.avgTrainTime, plan.avgCabTime, plan.avgTrainCost, plan.avgCabCost,
      plan.longestTravelTime, plan.shortestTravelTime, plan.travelFairnessScore,
      plan.mandatoryCost || 0, plan.optionalCostMin || 0, plan.optionalCostMax || 0, plan.whyRecommended || null,
      plan.avgAutoTime || 0, plan.avgAutoCost || 0, plan.avgTotalTime || 0, plan.avgTotalCost || 0, plan.avgWalkTime || 0,
      plan.generatedAt || new Date().toISOString()
    ));
  }

  // Insert new slots
  for (const slot of body.slots) {
    const finalVenueId = (slot.venueId && !slot.venueId.startsWith('fb_') && !slot.venueId.startsWith('fallback_')) ? slot.venueId : null;
    statements.push(env.DB.prepare(
      `INSERT INTO plan_slots (
        id, plan_id, slot_order, venue_id, experience_id, venue_name, name, category, 
        arrival_time, duration_minutes, travel_to_next_minutes, estimated_cost_per_head, note,
        travel_to_next_cost, image_url, link
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      slot.id, slot.planId, slot.slotOrder, finalVenueId, slot.experienceId || null, slot.venueName || null, slot.name, slot.category,
      slot.arrivalTime, slot.durationMinutes, slot.travelToNextMinutes || null, slot.estimatedCostPerHead, slot.note,
      slot.travelToNextCost || null, slot.imageUrl || null, slot.link || null
    ));
  }

  // Insert new travel metrics
  for (const t of body.memberTravels) {
    statements.push(env.DB.prepare(
      `INSERT INTO member_travel_metrics (
        id, plan_id, user_id, train_time, train_cost, cab_time, cab_cost, walk_time,
        auto_time, auto_cost, total_time, total_cost
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      t.id, t.planId, t.userId, t.trainTime, t.trainCost, t.cabTime, t.cabCost, t.walkTime,
      t.autoTime || 0, t.autoCost || 0, t.totalTime || 0, t.totalCost || 0
    ));
  }

  // Increment times_generated for each place in the plan slots
  for (const slot of body.slots) {
    const finalVenueId = (slot.venueId && !slot.venueId.startsWith('fb_') && !slot.venueId.startsWith('fallback_')) ? slot.venueId : null;
    if (finalVenueId) {
      statements.push(env.DB.prepare(
        `INSERT INTO ranking_metrics (place_id, times_generated, times_viewed, times_voted, times_won)
         VALUES (?, 1, 0, 0, 0)
         ON CONFLICT(place_id)
         DO UPDATE SET times_generated = times_generated + 1`
      ).bind(finalVenueId));
    }
  }

  // Update group status to VOTING and open votingStatus
  const isFastTrackVal = (group as any)?.isFastTrack === 1 ? 1 : 0;
  const timerExpiresAt = isFastTrackVal === 1 ? new Date(Date.now() + 30 * 1000).toISOString() : null;
  const genOptionsStr = body.generationOptions ? JSON.stringify(body.generationOptions) : null;
  statements.push(env.DB.prepare(
    `UPDATE groups SET status = 'VOTING', voting_status = 'OPEN', timer_expires_at = ?, generation_options = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
  ).bind(timerExpiresAt, genOptionsStr, groupId));

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
      mandatory_cost AS mandatoryCost, optional_cost_min AS optionalCostMin, optional_cost_max AS optionalCostMax,
      why_recommended AS whyRecommended, avg_auto_time AS avgAutoTime, avg_auto_cost AS avgAutoCost,
      avg_total_time AS avgTotalTime, avg_total_cost AS avgTotalCost, avg_walk_time AS avgWalkTime,
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
      auto_time AS autoTime, auto_cost AS autoCost, total_time AS totalTime, total_cost AS totalCost,
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

  const data = groupPlans.map(p => {
    let parsedWhyRecommended: string[] = [];
    if (p.whyRecommended) {
      try {
        parsedWhyRecommended = typeof p.whyRecommended === 'string'
          ? JSON.parse(p.whyRecommended)
          : p.whyRecommended;
      } catch (e) {
        parsedWhyRecommended = [];
      }
    }
    return {
      ...p,
      whyRecommended: parsedWhyRecommended,
      slots: slotsMap[p.id] || [],
      memberTravelMetrics: travelsMap[p.id] || [],
    };
  });

  // Increment times_viewed for all unique places being viewed
  const uniqueVenueIds = Array.from(new Set(slots.map((s: any) => s.venueId).filter(id => id && !id.startsWith('fb_') && !id.startsWith('fallback_'))));
  if (uniqueVenueIds.length > 0) {
    const viewStatements = [];
    for (const venueId of uniqueVenueIds) {
      viewStatements.push(env.DB.prepare(
        `INSERT INTO ranking_metrics (place_id, times_generated, times_viewed, times_voted, times_won)
         VALUES (?, 0, 1, 0, 0)
         ON CONFLICT(place_id)
         DO UPDATE SET times_viewed = times_viewed + 1`
      ).bind(venueId));
    }
    try {
      await env.DB.batch(viewStatements);
    } catch (err) {
      console.error('Failed to batch update times_viewed metrics:', err);
    }
  }

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

  // Increment times_voted for each place in the plan
  try {
    const slotsRes = await env.DB.prepare(`SELECT venue_id FROM plan_slots WHERE plan_id = ?`).bind(body.planId).all<{ venue_id: string | null }>();
    const voteVenueIds = (slotsRes.results || []).map(s => s.venue_id).filter(id => id && !id.startsWith('fb_') && !id.startsWith('fallback_'));
    const voteStatements = [];
    for (const venueId of voteVenueIds) {
      voteStatements.push(env.DB.prepare(
        `INSERT INTO ranking_metrics (place_id, times_generated, times_viewed, times_voted, times_won)
         VALUES (?, 0, 0, 1, 0)
         ON CONFLICT(place_id)
         DO UPDATE SET times_voted = times_voted + 1`
      ).bind(venueId));
    }
    if (voteStatements.length > 0) {
      await env.DB.batch(voteStatements);
    }
  } catch (err) {
    console.error('Failed to update times_voted metrics:', err);
  }

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
    winningCategories?: string;
    winningBudgetTier?: string;
    winningActivities?: string;
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

  // Query slots to get winning place IDs
  let winnerVenueIds: string[] = [];
  try {
    const winnerSlotsRes = await env.DB.prepare(`SELECT venue_id FROM plan_slots WHERE plan_id = ?`).bind(body.winnerPlanId).all<{ venue_id: string | null }>();
    winnerVenueIds = (winnerSlotsRes.results || []).map(s => s.venue_id).filter(id => id && !id.startsWith('fb_') && !id.startsWith('fallback_')) as string[];
  } catch (err) {
    console.error('Failed to query winning plan slots:', err);
  }

  const closeStatements = [
    env.DB.prepare(
      `UPDATE groups 
       SET status = 'COMPLETED', voting_status = 'CLOSED', winning_plan_id = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    ).bind(body.winnerPlanId, groupId),
    env.DB.prepare(
      `INSERT INTO history (
        id, group_id, plan_id, outing_date, group_name, plan_name, plan_tagline, 
        venues_json, participants_json, total_cost_per_head, winning_categories, winning_budget_tier, winning_activities, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      historyId, groupId, body.winnerPlanId, body.outingDate, body.groupName, body.planName, body.planTagline,
      body.venuesJson, body.participantsJson, body.totalCostPerHead, body.winningCategories || null, body.winningBudgetTier || null, body.winningActivities || null, now
    )
  ];

  for (const venueId of winnerVenueIds) {
    closeStatements.push(env.DB.prepare(
      `INSERT INTO ranking_metrics (place_id, times_generated, times_viewed, times_voted, times_won)
       VALUES (?, 0, 0, 0, 1)
       ON CONFLICT(place_id)
       DO UPDATE SET times_won = times_won + 1`
    ).bind(venueId));
  }

  await env.DB.batch(closeStatements);

  return json({ success: true }, { headers: corsHeaders(env) });
}

const DISCOVERY_ZONES = [
  // === South Mumbai ===
  { name: 'Colaba', lat: 18.9219, lng: 72.8319, radius: 2000 },
  { name: 'Fort', lat: 18.9389, lng: 72.8354, radius: 2000 },
  { name: 'Churchgate', lat: 18.9347, lng: 72.8263, radius: 2000 },
  { name: 'Marine Lines', lat: 18.9455, lng: 72.8215, radius: 2000 },
  { name: 'Girgaon', lat: 18.9536, lng: 72.8159, radius: 2000 },
  { name: 'Grant Road', lat: 18.9636, lng: 72.8178, radius: 2000 },
  { name: 'Mumbai Central', lat: 18.9697, lng: 72.8199, radius: 2000 },
  { name: 'Mahalakshmi', lat: 18.9798, lng: 72.8167, radius: 2000 },
  // === Central Mumbai ===
  { name: 'Byculla', lat: 18.9795, lng: 72.8364, radius: 2000 },
  { name: 'Worli', lat: 19.0082, lng: 72.8178, radius: 2500 },
  { name: 'Lower Parel', lat: 18.9996, lng: 72.8283, radius: 2500 },
  { name: 'Prabhadevi', lat: 19.0073, lng: 72.8273, radius: 2000 },
  { name: 'Parel', lat: 19.0016, lng: 72.8429, radius: 2000 },
  { name: 'Dadar', lat: 19.0178, lng: 72.8478, radius: 2500 },
  { name: 'Matunga', lat: 19.0292, lng: 72.8457, radius: 2000 },
  { name: 'Sewri', lat: 19.0089, lng: 72.8600, radius: 2000 },
  { name: 'Wadala', lat: 19.0263, lng: 72.8631, radius: 2000 },
  { name: 'Sion', lat: 19.0453, lng: 72.8695, radius: 2000 },
  // === Western Suburbs ===
  { name: 'Mahim', lat: 19.0411, lng: 72.8380, radius: 2000 },
  { name: 'Bandra', lat: 19.0596, lng: 72.8295, radius: 3000 },
  { name: 'BKC', lat: 19.0660, lng: 72.8668, radius: 2500 },
  { name: 'Khar', lat: 19.0717, lng: 72.8355, radius: 2000 },
  { name: 'Santacruz', lat: 19.0824, lng: 72.8425, radius: 2500 },
  { name: 'Juhu', lat: 19.1075, lng: 72.8263, radius: 2500 },
  { name: 'Vile Parle', lat: 19.0990, lng: 72.8486, radius: 2500 },
  { name: 'Andheri', lat: 19.1136, lng: 72.8697, radius: 3500 },
  { name: 'Versova', lat: 19.1385, lng: 72.8116, radius: 2500 },
  { name: 'Jogeshwari', lat: 19.1346, lng: 72.8456, radius: 2500 },
  { name: 'Goregaon', lat: 19.1544, lng: 72.8482, radius: 3000 },
  { name: 'Malad', lat: 19.1872, lng: 72.8483, radius: 3000 },
  { name: 'Kandivali', lat: 19.2054, lng: 72.8544, radius: 3000 },
  { name: 'Borivali', lat: 19.2290, lng: 72.8570, radius: 3500 },
  { name: 'Dahisar', lat: 19.2618, lng: 72.8595, radius: 3000 },
  // === Eastern Suburbs (Central Line) ===
  { name: 'Kurla', lat: 19.0607, lng: 72.8826, radius: 3000 },
  { name: 'Chunabhatti', lat: 19.0417, lng: 72.8888, radius: 2000 },
  { name: 'Chembur', lat: 19.0622, lng: 72.8999, radius: 2500 },
  { name: 'Ghatkopar', lat: 19.0860, lng: 72.9082, radius: 3000 },
  { name: 'Vikhroli', lat: 19.1048, lng: 72.9297, radius: 2500 },
  { name: 'Powai', lat: 19.1176, lng: 72.9060, radius: 3000 },
  { name: 'Bhandup', lat: 19.1519, lng: 72.9396, radius: 2500 },
  { name: 'Mulund', lat: 19.1724, lng: 72.9596, radius: 3000 },
  { name: 'Thane', lat: 19.2183, lng: 72.9781, radius: 4500 },
  { name: 'Dombivli', lat: 19.2149, lng: 73.0893, radius: 3500 },
  // === Harbour Line / Navi Mumbai ===
  { name: 'Mankhurd', lat: 19.0683, lng: 72.9272, radius: 2500 },
  { name: 'Vashi', lat: 19.0745, lng: 72.9978, radius: 3500 },
  { name: 'Sanpada', lat: 19.0630, lng: 72.9998, radius: 2500 },
  { name: 'Juinagar', lat: 19.0445, lng: 73.0064, radius: 2000 },
  { name: 'Nerul', lat: 19.0341, lng: 73.0198, radius: 2500 },
  { name: 'Seawoods', lat: 19.0212, lng: 73.0192, radius: 2500 },
  { name: 'Belapur', lat: 19.0180, lng: 73.0392, radius: 3000 },
  { name: 'Kharghar', lat: 19.0460, lng: 73.0680, radius: 3000 },
  { name: 'Airoli', lat: 19.1505, lng: 73.0095, radius: 2500 },
  { name: 'Panvel', lat: 18.9894, lng: 73.1175, radius: 4000 },
];

const CONVERSATION_SCORES_WORKER: Record<string, number> = {
  POTTERY: 10,
  BOARD_GAMES: 8,
  ESCAPE_ROOM: 8,
  MUSEUM: 7,
  ART_GALLERY: 7,
  CAFE: 6,
  RESTAURANT: 5,
  PARK: 6,
  DESSERT: 5,
  ARCADE: 4,
  BOWLING: 4,
  MOVIE: 4,
  SPORTS: 3,
  MALL: 3,
};

const DISCOVERY_CATEGORY_TYPES = [
  { type: 'cafe', cat: 'CAFE' },
  { type: 'restaurant', cat: 'RESTAURANT' },
  { type: 'amusement_park', cat: 'ARCADE' },
  { type: 'bowling_alley', cat: 'BOWLING' },
  { type: 'museum', cat: 'MUSEUM' },
  { type: 'shopping_mall', cat: 'MALL' },
  { type: 'park', cat: 'PARK' },
  { type: 'bakery', cat: 'DESSERT' },
  { type: 'movie_theater', cat: 'MOVIE' },
  { type: 'stadium', cat: 'SPORTS' },
];

const STRONG_HANGOUT_NAME_PATTERNS = [
  'social', 'cafe', 'café', 'coffee', 'bistro', 'bakery', 'patisserie', 'dessert',
  'creamery', 'ice cream', 'gelato', 'waffle', 'theobroma', 'le15',
  'taproom', 'bar', 'brew', 'brewery', 'diner', 'kitchen', 'trattoria',
  'restaurant', 'pizza', 'sushi', 'ramen', 'bbq', 'barbeque',
  'arcade', 'game', 'gaming', 'timezone', 'smaaash', 'bowling', 'escape',
  'museum', 'gallery', 'art', 'studio', 'pottery', 'workshop',
  'promenade', 'beach', 'lake', 'garden', 'fort', 'national park', 'nature park',
  'cinema', 'pvr', 'inox', 'cinepolis', 'theatre', 'mall'
];

const WEAK_OR_NON_HANGOUT_PATTERNS = [
  ' pvt ltd', ' pvt. ltd', ' limited', ' ltd.', 'corporate', 'office',
  'apartment', ' housing', ' society', ' co-op', ' chs', 'chs ', 'c.h.s',
  'residency', 'residences', 'tower', 'villa', 'bungalow', 'building', 'bldg',
  'gate no', ' gate 1', ' gate 2', 'transit', 'compound', 'estate',
  'marriage hall', 'banquet hall', 'community hall', 'rickshaw', 'auto stand',
  'parking', 'metro station', 'railway station', 'bus stand', 'bus depot',
  'bus terminal', 'collection', 'boutique', 'clothing', 'designer', 'couture',
  'tailor', 'saree', 'fashion', 'textile', 'dulha', 'bridal', 'jewellers',
  'jewellery', 'jewelers', 'advisory', 'advisor', 'advisors', 'fund ', ' fund',
  'wealth', 'consultancy', 'consulting', 'associates', 'advocates', 'chambers',
  'law firm', 'legal', 'finance', 'financial', 'investments', 'venture',
  'capital', 'foundation', 'trust', 'ngo', 'charity', 'diagnostic', ' clinic',
  'clinic ', 'hospital', 'nursing home', 'dental', 'eyecare', 'enterprises',
  'services', 'store', 'shop', 'mart', 'supermarket', 'medical', 'pharma',
  'pharmacy', 'school', 'college', 'classes', 'tuition', 'hostel', 'pg ',
  'gymkhana', 'club house', 'ground', 'maidan', 'kridangan', 'football turf',
  'cricket ground', 'mandir', 'temple', 'masjid', 'church', 'vihar',
  'holiday', 'holidays', 'travel', 'travels', 'tour', 'tours', 'frame',
  'frames', 'branding', 'conclave', 'dynamic positioning', 'training centre',
  'training center', 'guest house', 'resturant service', 'hotel ', 'max',
  'wholesale', 'exhibition centre'
];

const GENERIC_WEAK_FOOD_PATTERNS = [
  'family restaurant', 'veg restaurant', 'pure veg', 'hotel ', 'fast food',
  'snacks corner', 'sweets', 'caterers', 'biryani', 'chinese foods',
  'juice centre', 'cold drinks', 'tea stall', 'dhaba', 'mess'
];

const LOW_INTENT_CHAIN_PATTERNS = [
  'mcdonald', 'domino', 'kfc', 'subway', 'burger king', 'pizza hut',
  'barbeque nation', 'bbq nation', 'monginis', 'ribbons and balloons',
  'cafe coffee day', 'café coffee day', 'ccd', 'mad over donuts',
  'belgian waffle', 'naturals ice cream', 'starbucks', 'barista', 'mccafé',
  'mccafe', 'coffee day express'
];

function hasAnyPattern(text: string, patterns: string[]) {
  return patterns.some(pattern => text.includes(pattern));
}

function isHighIntentHangoutPlace(name: string, cat: string, rating: number | null, reviewCount: number, googleTypes: string[] = []) {
  const normalized = `${name} ${googleTypes.join(' ')}`.toLowerCase();

  const hasStrongSignal = hasAnyPattern(normalized, STRONG_HANGOUT_NAME_PATTERNS);
  if (hasAnyPattern(normalized, LOW_INTENT_CHAIN_PATTERNS)) return false;
  if (hasAnyPattern(normalized, WEAK_OR_NON_HANGOUT_PATTERNS) && !hasStrongSignal) return false;
  const isHighlyReviewed = reviewCount >= 75;
  const isVeryHighlyRated = rating !== null && rating >= 4.3 && reviewCount >= 40;

  if (cat === 'RESTAURANT') {
    if (hasAnyPattern(normalized, GENERIC_WEAK_FOOD_PATTERNS) && !hasStrongSignal) return false;
    return hasStrongSignal || isHighlyReviewed || isVeryHighlyRated;
  }

  if (cat === 'PARK') {
    const scenicSignal = hasAnyPattern(normalized, ['promenade', 'beach', 'lake', 'fort', 'national park', 'nature park', 'waterfront', 'viewpoint', 'central park', 'jio world garden']);
    return scenicSignal && (reviewCount >= 25 || rating === null || rating >= 4.0);
  }

  if (cat === 'MALL') {
    return hasStrongSignal && reviewCount >= 100;
  }

  if (cat === 'CAFE' || cat === 'DESSERT') {
    return hasStrongSignal || isHighlyReviewed || isVeryHighlyRated;
  }

  return hasStrongSignal || isHighlyReviewed || isVeryHighlyRated;
}

function parseEventLocation(text: string) {
  const t = text.toLowerCase();
  if (t.includes('bandra')) return { lat: 19.0596, lng: 72.8295 };
  if (t.includes('andheri')) return { lat: 19.1136, lng: 72.8697 };
  if (t.includes('lower parel') || t.includes('parel')) return { lat: 19.0034, lng: 72.8276 };
  if (t.includes('worli')) return { lat: 19.0176, lng: 72.8179 };
  if (t.includes('juhu')) return { lat: 19.1075, lng: 72.8263 };
  if (t.includes('powai')) return { lat: 19.1176, lng: 72.9060 };
  if (t.includes('borivali')) return { lat: 19.2290, lng: 72.8570 };
  if (t.includes('vashi')) return { lat: 19.0745, lng: 72.9978 };
  if (t.includes('belapur')) return { lat: 19.0180, lng: 73.0392 };
  if (t.includes('thane')) return { lat: 19.2183, lng: 72.9781 };
  if (t.includes('dadar')) return { lat: 19.0178, lng: 72.8478 };
  return { lat: 19.0178, lng: 72.8478 };
}

async function discoverZonePlaces(db: D1Database, zoneName: string, lat: number, lng: number, radius: number, apiKey: string, onlyCategory?: string) {
  // Perturb the search coordinates slightly (within 40% of search radius) to discover different places on each periodic run
  const maxOffsetDegrees = (radius * 0.4) / 111000;
  const angle = Math.random() * 2 * Math.PI;
  const distance = Math.random() * maxOffsetDegrees;
  const searchLat = lat + distance * Math.cos(angle);
  const searchLng = lng + distance * Math.sin(angle);

  const categoriesToSearch = onlyCategory
    ? DISCOVERY_CATEGORY_TYPES.filter(c => c.cat === onlyCategory.toUpperCase())
    : DISCOVERY_CATEGORY_TYPES;

  let discoveredCount = 0;
  let skippedExisting = 0;
  let skippedWeak = 0;
  let skippedQuality = 0;
  const seenPlaceIds = new Set<string>();

  for (const { type, cat } of categoriesToSearch) {
    const url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${searchLat},${searchLng}&radius=${radius}&type=${type}&key=${apiKey}`;
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const data = await res.json() as any;
      const results = data?.results || [];

      for (const item of results.slice(0, 8)) {
        const placeId = item.place_id;
        if (!placeId || seenPlaceIds.has(placeId)) continue;
        seenPlaceIds.add(placeId);

        const name = item.name || 'Unknown Place';
        const address = item.vicinity || item.formatted_address || '';
        const placeLat = item.geometry?.location?.lat;
        const placeLng = item.geometry?.location?.lng;
        if (!placeLat || !placeLng) continue;

        const parsedRating = Number(item.rating || 0);
        const finalRating: number | null = parsedRating > 0 ? parsedRating : null;
        const finalReviewCount = Number(item.user_ratings_total || 0);

        const id = `GOOGLE_${placeId}`;

        // Skip if place already exists in database (fetch new places only)
        try {
          const existing = await db.prepare(`SELECT id FROM places WHERE id = ? LIMIT 1`).bind(id).first();
          if (existing) {
            skippedExisting++;
            continue;
          }
        } catch (e) {
          // Proceed if query fails for any reason
        }

        // Filter closed places
        const businessStatus = (item.business_status || '').toUpperCase();
        if (businessStatus.includes('CLOSED')) {
          continue;
        }

        // Quality Gate for Google Places. Unknown ratings are allowed only when the name/type is strongly hangout-coded.
        if (finalRating !== null && finalRating > 0 && finalReviewCount > 0 && (finalRating < 4.0 || finalReviewCount < 20)) {
          skippedQuality++;
          continue;
        }

        const nameLower = name.toLowerCase();
        const googleTypes = Array.isArray(item.types) ? item.types : [];
        if (!isHighIntentHangoutPlace(nameLower, cat, finalRating, finalReviewCount, googleTypes)) {
          skippedWeak++;
          continue;
        }

        let imageUrl: string | null = null;
        if (item.photos && item.photos.length > 0 && item.photos[0].photo_reference) {
          const photoRef = item.photos[0].photo_reference;
          imageUrl = `/api/places/photo?ref=${encodeURIComponent(photoRef)}`;
        }

        // Budget Calculations
        const priceLevel = typeof item.price_level === 'number' ? item.price_level : null;
        let mandatoryCost = 0;
        let optionalCostMin = 0;
        let optionalCostMax = 0;

        if (cat === 'CAFE') {
          mandatoryCost = 0;
          if (priceLevel === 1) { optionalCostMin = 150; optionalCostMax = 350; }
          else if (priceLevel === 2) { optionalCostMin = 300; optionalCostMax = 600; }
          else if (priceLevel === 3) { optionalCostMin = 500; optionalCostMax = 1000; }
          else if (priceLevel === 4) { optionalCostMin = 1000; optionalCostMax = 2000; }
          else { optionalCostMin = 250; optionalCostMax = 550; }
        } else if (cat === 'RESTAURANT') {
          mandatoryCost = 0;
          if (priceLevel === 1) { optionalCostMin = 200; optionalCostMax = 500; }
          else if (priceLevel === 2) { optionalCostMin = 400; optionalCostMax = 900; }
          else if (priceLevel === 3) { optionalCostMin = 800; optionalCostMax = 1800; }
          else if (priceLevel === 4) { optionalCostMin = 1500; optionalCostMax = 3500; }
          else { optionalCostMin = 350; optionalCostMax = 950; }
        } else if (cat === 'DESSERT') {
          mandatoryCost = 0;
          if (priceLevel === 1) { optionalCostMin = 100; optionalCostMax = 300; }
          else if (priceLevel === 2) { optionalCostMin = 200; optionalCostMax = 500; }
          else if (priceLevel === 3) { optionalCostMin = 400; optionalCostMax = 900; }
          else { optionalCostMin = 150; optionalCostMax = 450; }
        } else if (cat === 'BOWLING') {
          mandatoryCost = 350;
          optionalCostMin = 100;
          optionalCostMax = 400;
        } else if (cat === 'ARCADE') {
          mandatoryCost = 300;
          optionalCostMin = 100;
          optionalCostMax = 500;
        } else if (cat === 'MUSEUM') {
          mandatoryCost = 150;
          optionalCostMin = 0;
          optionalCostMax = 0;
        } else if (cat === 'MALL') {
          mandatoryCost = 0;
          optionalCostMin = 100;
          optionalCostMax = 500;
        } else if (cat === 'PARK') {
          mandatoryCost = 0;
          optionalCostMin = 0;
          optionalCostMax = 0;
        } else if (cat === 'MOVIE') {
          mandatoryCost = 300;
          optionalCostMin = 0;
          optionalCostMax = 200;
        } else if (cat === 'SPORTS') {
          mandatoryCost = 300;
          optionalCostMin = 100;
          optionalCostMax = 500;
        }

        const now = new Date().toISOString();

        // Check for existing first_seen
        let firstSeen = now;
        try {
          const existing = await db.prepare(`SELECT first_seen FROM places WHERE id = ?`).bind(id).first<{ first_seen: string }>();
          if (existing?.first_seen) {
            firstSeen = existing.first_seen;
          }
        } catch (err) {
          // ignore
        }

        // Save to D1
        await db.prepare(
          `INSERT INTO places (
            id, name, address, lat, lng, rating, review_count, 
            source_name, source_place_id, last_verified, verified_at, 
            first_seen, business_status, image_url, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 'GOOGLE', ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            address = excluded.address,
            lat = excluded.lat,
            lng = excluded.lng,
            rating = excluded.rating,
            review_count = excluded.review_count,
            last_verified = excluded.last_verified,
            verified_at = excluded.verified_at,
            business_status = excluded.business_status,
            image_url = COALESCE(excluded.image_url, places.image_url),
            updated_at = excluded.updated_at`
        ).bind(
          id, name, address, placeLat, placeLng, finalRating, finalReviewCount, 
          placeId, now, now, firstSeen, businessStatus, imageUrl, now, now
        ).run();

        // Save categories
        const catId1 = crypto.randomUUID();
        await db.prepare(
          `INSERT OR IGNORE INTO place_categories (id, place_id, category) VALUES (?, ?, ?)`
        ).bind(catId1, id, cat).run();

        // Classify
        let experienceType = 'OPTIONAL_STOP';
        if (['BOWLING', 'ARCADE', 'MUSEUM', 'POTTERY'].includes(cat)) {
          experienceType = 'PRIMARY_EXPERIENCE';
        } else if (['CAFE', 'RESTAURANT', 'DESSERT'].includes(cat)) {
          experienceType = 'FOOD_STOP';
        }
        const catId2 = crypto.randomUUID();
        await db.prepare(
          `INSERT OR IGNORE INTO place_categories (id, place_id, category) VALUES (?, ?, ?)`
        ).bind(catId2, id, experienceType).run();

        // Save costs
        await db.prepare(
          `INSERT OR REPLACE INTO place_costs (place_id, mandatory_cost, optional_cost_min, optional_cost_max)
           VALUES (?, ?, ?, ?)`
        ).bind(id, mandatoryCost, optionalCostMin, optionalCostMax).run();

        // Save scores
        const popularity = finalRating === null ? 0.5 : finalRating / 5.0;
        const budgetFriendliness = Math.max(0.0, Math.min(1.0, 1.0 - (mandatoryCost / 1500)));
        const conversationScoreVal = (CONVERSATION_SCORES_WORKER[cat] || 5) / 10.0;

        const groupSuitability = ['CAFE', 'RESTAURANT', 'BOWLING', 'ARCADE', 'MOVIE', 'SPORTS'].includes(cat) ? 0.8 : 0.5;
        const dateSuitability = ['CAFE', 'PARK', 'RESTAURANT', 'DESSERT', 'MOVIE'].includes(cat) ? 0.9 : 0.5;
        const friendsSuitability = ['BOWLING', 'ARCADE', 'CAFE', 'SPORTS', 'ESCAPE_ROOM'].includes(cat) ? 0.9 : 0.5;
        const familySuitability = ['MUSEUM', 'PARK', 'RESTAURANT', 'MOVIE', 'MALL'].includes(cat) ? 0.9 : 0.5;
        const weatherSuitability = ['PARK'].includes(cat) ? 0.6 : 1.0;
        const uniqueness = ['MUSEUM', 'ESCAPE_ROOM'].includes(cat) ? 0.8 : 0.5;
        const experienceScore = 0.8;
        const overall = (popularity + conversationScoreVal + experienceScore) / 3.0;

        await db.prepare(
          `INSERT OR REPLACE INTO place_scores (
            place_id, popularity, budget_friendliness, conversation, group_suitability,
            date_suitability, friends_suitability, family_suitability, weather_suitability,
            uniqueness, experience_score, overall
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          id, popularity, budgetFriendliness, conversationScoreVal, groupSuitability,
          dateSuitability, friendsSuitability, familySuitability, weatherSuitability,
          uniqueness, experienceScore, overall
        ).run();

        discoveredCount++;
      }
    } catch (err) {
      console.error(`Error discovering ${type} in ${zoneName}:`, err);
    }
  }

  console.log(`[DISCOVERY] ${zoneName}${onlyCategory ? `/${onlyCategory}` : ''}: inserted=${discoveredCount}, existing=${skippedExisting}, weak=${skippedWeak}, low_quality=${skippedQuality}`);
  return discoveredCount;
}

function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
}

async function rebuildFeaturedExperiences(db: D1Database) {
  console.log('Rebuilding featured experiences (top 50 active events)...');
  await db.prepare(`DELETE FROM featured_experiences`).run();

  const topEvents = await db.prepare(
    `SELECT id, trending_score 
     FROM experiences 
     WHERE is_active = 1 
     ORDER BY trending_score DESC 
     LIMIT 50`
  ).all<any>();

  const results = topEvents.results || [];
  console.log(`Found ${results.length} active events to feature.`);

  for (const event of results) {
    const featId = crypto.randomUUID();
    const now = new Date().toISOString();
    await db.prepare(
      `INSERT INTO featured_experiences (id, experience_id, score, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`
    ).bind(featId, event.id, event.trending_score, now, now).run();
  }
  console.log('Featured experiences rebuilt.');
}

async function discoverExperiences(db: D1Database, tavilyApiKey?: string) {
  await db.prepare(`INSERT OR IGNORE INTO experience_sources (id, name, reliability_weight) VALUES ('BOOKMYSHOW', 'BookMyShow', 1.0)`).run();
  await db.prepare(`INSERT OR IGNORE INTO experience_sources (id, name, reliability_weight) VALUES ('TAVILY', 'Tavily Search', 1.0)`).run();

  const categories = ['CONCERT', 'WORKSHOP', 'POTTERY', 'PAINTING', 'COMIC_CON', 'ANIME_EVENT', 'STANDUP_COMEDY', 'ART_EXHIBITION'];
  for (const cat of categories) {
    await db.prepare(`INSERT OR IGNORE INTO experience_categories (id, name) VALUES (?, ?)`).bind(cat, cat).run();
  }

  const mockEvents = [
    {
      title: "Sanjay's Clay Pottery Masterclass",
      description: "Learn traditional clay wheel pottery from master artisan Sanjay in a cozy Bandra studio.",
      category: "POTTERY",
      city: "Mumbai",
      lat: 19.0500,
      lng: 72.8300,
      price: 1200,
      url: "https://bookmyshow.com/mumbai/events/pottery-masterclass",
      imageUrl: "https://images.unsplash.com/photo-1565192647048-f997ded87958?w=500"
    },
    {
      title: "Canvas Painting Social",
      description: "Unleash your creativity with guided painting, mocktails, and music in Andheri West.",
      category: "PAINTING",
      city: "Mumbai",
      lat: 19.1329,
      lng: 72.8147,
      price: 900,
      url: "https://bookmyshow.com/mumbai/events/painting-social",
      imageUrl: "https://images.unsplash.com/photo-1513364776144-60967b0f800f?w=500"
    },
    {
      title: "Mumbai Standup Showcase",
      description: "Catch Mumbai's funniest comics live at the Lower Parel comedy club.",
      category: "STANDUP_COMEDY",
      city: "Mumbai",
      lat: 19.0034,
      lng: 72.8276,
      price: 499,
      url: "https://bookmyshow.com/mumbai/events/standup-showcase",
      imageUrl: "https://images.unsplash.com/photo-1585699324551-f6c309eed262?w=500"
    },
    {
      title: "Art & Soul Exhibition",
      description: "Exquisite contemporary art installations by local artists at the Worli Gallery.",
      category: "ART_EXHIBITION",
      city: "Mumbai",
      lat: 19.0176,
      lng: 72.8179,
      price: 0,
      url: "https://bookmyshow.com/mumbai/events/art-soul",
      imageUrl: "https://images.unsplash.com/photo-1460661419201-fd4cecdf8a8b?w=500"
    },
    {
      title: "Anime & Comic Fan Fest",
      description: "Celebrate anime, cosplay, and gaming at the Vashi convention center.",
      category: "ANIME_EVENT",
      city: "Mumbai",
      lat: 19.0745,
      lng: 72.9978,
      price: 350,
      url: "https://bookmyshow.com/mumbai/events/anime-fest",
      imageUrl: "https://images.unsplash.com/photo-1607604276583-eef5d076aa5f?w=500"
    }
  ];

  let added = 0;
  const nowTime = new Date().toISOString();
  const nextMonthTime = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  // 1. Insert Base/Mock Events
  for (const event of mockEvents) {
    const id = 'exp_' + simpleHash(event.url);

    // Check existing first_seen
    let firstSeen = nowTime;
    try {
      const existing = await db.prepare(`SELECT first_seen FROM experiences WHERE id = ?`).bind(id).first<{ first_seen: string }>();
      if (existing?.first_seen) {
        firstSeen = existing.first_seen;
      }
    } catch (err) {
      // ignore
    }

    const daysSinceDiscovery = Math.max(0, (Date.now() - new Date(firstSeen).getTime()) / (1000 * 60 * 60 * 24));
    const freshness = Math.exp(-daysSinceDiscovery / 14);
    const rating = null;
    const popularity = 0.8;
    const trendingScore = 100 * freshness * popularity;

    await db.prepare(
      `INSERT OR REPLACE INTO experiences (
        id, title, description, category, city, latitude, longitude,
        start_date, end_date, ticket_price, source, source_url, image_url,
        rating, popularity_score, is_recurring, is_active, trending_score, first_seen, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'BOOKMYSHOW', ?, ?, ?, ?, 1, 1, ?, ?, ?, ?)`
    ).bind(
      id, event.title, event.description, event.category, event.city, event.lat, event.lng,
      nowTime, nextMonthTime, event.price, event.url, event.imageUrl, rating, popularity, trendingScore, firstSeen, nowTime, nowTime
    ).run();
    added++;
  }

  // 2. Query Tavily Search API if key is available
  if (tavilyApiKey) {
    console.log('Tavily Search API key detected. Fetching live experiences...');
    const searchQueries = [
      { query: 'upcoming workshops in Mumbai', cat: 'WORKSHOP' },
      { query: 'upcoming pottery classes in Mumbai', cat: 'POTTERY' },
      { query: 'upcoming painting classes in Mumbai', cat: 'PAINTING' },
      { query: 'upcoming comic cons in Mumbai', cat: 'COMIC_CON' },
      { query: 'upcoming anime events in Mumbai', cat: 'ANIME_EVENT' },
      { query: 'upcoming standup comedy shows in Mumbai', cat: 'STANDUP_COMEDY' },
      { query: 'upcoming art exhibitions in Mumbai', cat: 'ART_EXHIBITION' },
      { query: 'upcoming concerts in Mumbai', cat: 'CONCERT' }
    ];

    for (const item of searchQueries) {
      try {
        const response = await fetch('https://api.tavily.com/search', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            api_key: tavilyApiKey,
            query: item.query,
            search_depth: 'advanced',
            max_results: 5
          })
        });

        if (response.ok) {
          const searchData = await response.json() as any;
          const results = searchData?.results || [];

          for (const res of results) {
            const title = res.title || 'Special Mumbai Event';
            const description = res.content || 'Enjoy an exciting event in Mumbai.';
            const url = res.url || 'https://www.google.com/search?q=' + encodeURIComponent(title);
            const { lat, lng } = parseEventLocation(title + ' ' + description);

            const id = 'exp_' + simpleHash(url);

            // Check existing first_seen
            let firstSeen = nowTime;
            try {
              const existing = await db.prepare(`SELECT first_seen FROM experiences WHERE id = ?`).bind(id).first<{ first_seen: string }>();
              if (existing?.first_seen) {
                firstSeen = existing.first_seen;
              }
            } catch (err) {
              // ignore
            }

            const daysSinceDiscovery = Math.max(0, (Date.now() - new Date(firstSeen).getTime()) / (1000 * 60 * 60 * 24));
            const freshness = Math.exp(-daysSinceDiscovery / 14);
            const rating = null;
            const popularity = 0.8;
            const trendingScore = 100 * freshness * popularity;

            // Try to parse price
            let price = 500;
            const priceMatch = description.match(/(?:rs\.?|inr|₹)\s*(\d+)/i);
            if (priceMatch) {
              price = parseInt(priceMatch[1], 10);
            }

            await db.prepare(
              `INSERT OR REPLACE INTO experiences (
                id, title, description, category, city, latitude, longitude,
                start_date, end_date, ticket_price, source, source_url, image_url,
                rating, popularity_score, is_recurring, is_active, trending_score, first_seen, created_at, updated_at
              ) VALUES (?, ?, ?, ?, 'Mumbai', ?, ?, ?, ?, ?, 'TAVILY', ?, ?, ?, ?, 1, 1, ?, ?, ?, ?)`
            ).bind(
              id, title, description, item.cat, lat, lng,
              nowTime, nextMonthTime, price, url, 'https://images.unsplash.com/photo-1543157145-f78c636d023d?w=500', rating, popularity, trendingScore, firstSeen, nowTime, nowTime
            ).run();
            added++;
          }
        }
      } catch (err) {
        console.error(`Error searching Tavily for ${item.query}:`, err);
      }
    }
  }

  // 3. Inactivate stale/expired events
  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    await db.prepare(`UPDATE experiences SET is_active = 0 WHERE is_active = 1 AND updated_at < ?`).bind(thirtyDaysAgo).run();
    const todayStr = new Date().toISOString().split('T')[0];
    await db.prepare(`UPDATE experiences SET is_active = 0 WHERE is_active = 1 AND end_date < ?`).bind(todayStr).run();
  } catch (err) {
    console.error('Error inactivating events:', err);
  }

  // 4. Rebuild featured experiences (Top 50)
  try {
    await rebuildFeaturedExperiences(db);
  } catch (err) {
    console.error('Error rebuilding featured experiences:', err);
  }

  return added;
}

async function handleAdminDiscoverZone(request: Request, env: Env) {
  const body = await readJson<{ zoneName: string }>(request);
  const zoneName = body.zoneName;
  if (!zoneName) {
    return json({ success: false, error: { message: 'Missing zoneName' } }, { status: 400, headers: corsHeaders(env) });
  }

  const zone = DISCOVERY_ZONES.find(z => z.name.toLowerCase() === zoneName.toLowerCase());
  if (!zone) {
    return json({ success: false, error: { message: `Zone ${zoneName} not supported` } }, { status: 400, headers: corsHeaders(env) });
  }

  const apiKey = env.GOOGLE_MAPS_API_KEY || env.OLA_MAPS_API_KEY || '';
  if (!apiKey) {
    return json({ success: false, error: { message: 'GOOGLE_MAPS_API_KEY not configured on worker' } }, { status: 500, headers: corsHeaders(env) });
  }

  const count = await discoverZonePlaces(env.DB, zone.name, zone.lat, zone.lng, zone.radius, apiKey);
  return json({ success: true, count }, { headers: corsHeaders(env) });
}

async function handleAdminDiscoverExperiences(request: Request, env: Env) {
  const count = await discoverExperiences(env.DB, env.OLA_MAPS_API_KEY ? env.OLA_MAPS_API_KEY : undefined); // passes key if configured, or undefined
  return json({ success: true, count }, { headers: corsHeaders(env) });
}

async function handleAdminCuratePlace(request: Request, env: Env, placeId: string) {
  const body = await readJson<{
    isFeatured?: boolean | number;
    isHidden?: boolean | number;
    boostFactor?: number;
  }>(request);

  const existing = await env.DB.prepare(`SELECT id FROM places WHERE id = ?`).bind(placeId).first();
  if (!existing) {
    return json({ success: false, error: { message: 'Place not found' } }, { status: 404, headers: corsHeaders(env) });
  }

  const isFeaturedVal = body.isFeatured === true || body.isFeatured === 1 ? 1 : 0;
  const isHiddenVal = body.isHidden === true || body.isHidden === 1 ? 1 : 0;
  const boostFactorVal = typeof body.boostFactor === 'number' ? body.boostFactor : 1.0;

  await env.DB.prepare(
    `UPDATE places
     SET is_featured = ?, is_hidden = ?, boost_factor = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).bind(isFeaturedVal, isHiddenVal, boostFactorVal, placeId).run();

  return json({ success: true }, { headers: corsHeaders(env) });
}

async function getAdminPlacesWorker(request: Request, env: Env) {
  let zonesList: any[] = [];
  try {
    const zonesResult = await env.DB.prepare(`SELECT name, center_lat AS centerLat, center_lng AS centerLng FROM zones`).all<any>();
    zonesList = zonesResult.results || [];
  } catch (err) {
    console.error('Error fetching zones in worker:', err);
  }

  function getDistance(lat1: number, lon1: number, lat2: number, lon2: number) {
    const R = 6371; // km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  const query = `
    SELECT 
      p.id, p.name, p.address, p.lat, p.lng, p.rating, p.review_count AS reviewCount, 
      p.is_featured AS isFeatured, p.is_hidden AS isHidden, p.boost_factor AS boostFactor,
      p.image_url AS imageUrl,
      c.mandatory_cost AS mandatoryCost, c.optional_cost_min AS optionalCostMin, c.optional_cost_max AS optionalCostMax,
      s.popularity, s.budget_friendliness AS budgetFriendliness, s.overall,
      (SELECT group_concat(cat.category, ', ') FROM place_categories cat WHERE cat.place_id = p.id) AS categories
    FROM places p
    LEFT JOIN place_costs c ON c.place_id = p.id
    LEFT JOIN place_scores s ON s.place_id = p.id
    ORDER BY p.name ASC
  `;
  const result = await env.DB.prepare(query).all();

  // Format boolean columns properly for JSON response and map nearest zone
  const data = (result.results || []).map((r: any) => {
    let zoneName = 'Mumbai';
    let minD = Infinity;
    for (const z of zonesList) {
      if (z.centerLat && z.centerLng) {
        const d = getDistance(r.lat, r.lng, z.centerLat, z.centerLng);
        if (d < minD) {
          minD = d;
          zoneName = z.name;
        }
      }
    }

    return {
      ...r,
      zoneName,
      isFeatured: r.isFeatured === 1 || r.isFeatured === true ? 1 : 0,
      isHidden: r.isHidden === 1 || r.isHidden === true ? 1 : 0,
      boostFactor: typeof r.boostFactor === 'number' ? r.boostFactor : 1.0,
    };
  });

  return json({ success: true, data }, { headers: corsHeaders(env) });
}

async function handleAddPlace(request: Request, env: Env) {
  const body = await readJson<any>(request);
  const placeId = body.id || uuid();
  const name = body.name || 'Unknown Place';
  const address = body.address || '';
  const lat = Number(body.lat || 0);
  const lng = Number(body.lng || 0);
  const rating = Number(body.rating || 0);
  const reviewCount = Number(body.reviewCount || 0);
  const isFeaturedVal = body.isFeatured === true || body.isFeatured === 1 ? 1 : 0;
  const isHiddenVal = body.isHidden === true || body.isHidden === 1 ? 1 : 0;
  const boostFactorVal = typeof body.boostFactor === 'number' ? body.boostFactor : 1.0;
  const now = new Date().toISOString();

  const mandatoryCost = Number(body.mandatoryCost || 0);
  const optionalCostMin = Number(body.optionalCostMin || 0);
  const optionalCostMax = Number(body.optionalCostMax || 0);

  const popularity = Number(body.popularity || 0);
  const budgetFriendliness = Number(body.budgetFriendliness || 0);
  const conversation = Number(body.conversation || 0);
  const groupSuitability = Number(body.groupSuitability || 0);
  const dateSuitability = Number(body.dateSuitability || 0);
  const friendsSuitability = Number(body.friendsSuitability || 0);
  const familySuitability = Number(body.familySuitability || 0);
  const weatherSuitability = Number(body.weatherSuitability || 0);
  const uniqueness = Number(body.uniqueness || 0);
  const experienceScore = Number(body.experienceScore || 0);
  const overall = Number(body.overall || 0);

  const statements = [
    env.DB.prepare(
      `INSERT INTO places (id, name, address, lat, lng, rating, review_count, source_name, source_place_id, last_verified, verified_at, is_featured, is_hidden, boost_factor, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'MANUAL', ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(placeId, name, address, lat, lng, rating, reviewCount, placeId, now, now, isFeaturedVal, isHiddenVal, boostFactorVal, now, now),

    env.DB.prepare(
      `INSERT OR REPLACE INTO place_costs (place_id, mandatory_cost, optional_cost_min, optional_cost_max)
       VALUES (?, ?, ?, ?)`
    ).bind(placeId, mandatoryCost, optionalCostMin, optionalCostMax),

    env.DB.prepare(
      `INSERT OR REPLACE INTO place_scores (
        place_id, popularity, budget_friendliness, conversation, group_suitability,
        date_suitability, friends_suitability, family_suitability, weather_suitability,
        uniqueness, experience_score, overall
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      placeId, popularity, budgetFriendliness, conversation, groupSuitability,
      dateSuitability, friendsSuitability, familySuitability, weatherSuitability,
      uniqueness, experienceScore, overall
    )
  ];

  // Categories
  const categories = Array.isArray(body.categories) ? body.categories : (typeof body.categories === 'string' ? body.categories.split(',').map((c: string) => c.trim()) : []);
  for (const cat of categories) {
    if (cat) {
      statements.push(
        env.DB.prepare(
          `INSERT OR IGNORE INTO place_categories (id, place_id, category) VALUES (?, ?, ?)`
        ).bind(uuid(), placeId, cat.toUpperCase())
      );
    }
  }

  await env.DB.batch(statements);
  return json({ success: true, id: placeId }, { headers: corsHeaders(env) });
}

async function handleUpdatePlace(request: Request, env: Env, placeId: string) {
  const body = await readJson<any>(request);
  const existing = await env.DB.prepare(`SELECT id FROM places WHERE id = ?`).bind(placeId).first();
  if (!existing) {
    return json({ success: false, error: { message: 'Place not found' } }, { status: 404, headers: corsHeaders(env) });
  }

  const name = body.name;
  const address = body.address;
  const lat = body.lat !== undefined ? Number(body.lat) : undefined;
  const lng = body.lng !== undefined ? Number(body.lng) : undefined;
  const rating = body.rating !== undefined ? Number(body.rating) : undefined;
  const reviewCount = body.reviewCount !== undefined ? Number(body.reviewCount) : undefined;
  const isFeaturedVal = body.isFeatured !== undefined ? (body.isFeatured === true || body.isFeatured === 1 ? 1 : 0) : undefined;
  const isHiddenVal = body.isHidden !== undefined ? (body.isHidden === true || body.isHidden === 1 ? 1 : 0) : undefined;
  const boostFactorVal = body.boostFactor !== undefined ? Number(body.boostFactor) : undefined;

  const mandatoryCost = body.mandatoryCost !== undefined ? Number(body.mandatoryCost) : undefined;
  const optionalCostMin = body.optionalCostMin !== undefined ? Number(body.optionalCostMin) : undefined;
  const optionalCostMax = body.optionalCostMax !== undefined ? Number(body.optionalCostMax) : undefined;

  const popularity = body.popularity !== undefined ? Number(body.popularity) : undefined;
  const budgetFriendliness = body.budgetFriendliness !== undefined ? Number(body.budgetFriendliness) : undefined;
  const conversation = body.conversation !== undefined ? Number(body.conversation) : undefined;
  const groupSuitability = body.groupSuitability !== undefined ? Number(body.groupSuitability) : undefined;
  const dateSuitability = body.dateSuitability !== undefined ? Number(body.dateSuitability) : undefined;
  const friendsSuitability = body.friendsSuitability !== undefined ? Number(body.friendsSuitability) : undefined;
  const familySuitability = body.familySuitability !== undefined ? Number(body.familySuitability) : undefined;
  const weatherSuitability = body.weatherSuitability !== undefined ? Number(body.weatherSuitability) : undefined;
  const uniqueness = body.uniqueness !== undefined ? Number(body.uniqueness) : undefined;
  const experienceScore = body.experienceScore !== undefined ? Number(body.experienceScore) : undefined;
  const overall = body.overall !== undefined ? Number(body.overall) : undefined;

  const statements = [];

  // Update places fields
  let placesUpdate = 'UPDATE places SET updated_at = CURRENT_TIMESTAMP';
  const placesParams = [];
  if (name !== undefined) { placesUpdate += ', name = ?'; placesParams.push(name); }
  if (address !== undefined) { placesUpdate += ', address = ?'; placesParams.push(address); }
  if (lat !== undefined) { placesUpdate += ', lat = ?'; placesParams.push(lat); }
  if (lng !== undefined) { placesUpdate += ', lng = ?'; placesParams.push(lng); }
  if (rating !== undefined) { placesUpdate += ', rating = ?'; placesParams.push(rating); }
  if (reviewCount !== undefined) { placesUpdate += ', review_count = ?'; placesParams.push(reviewCount); }
  if (isFeaturedVal !== undefined) { placesUpdate += ', is_featured = ?'; placesParams.push(isFeaturedVal); }
  if (isHiddenVal !== undefined) { placesUpdate += ', is_hidden = ?'; placesParams.push(isHiddenVal); }
  if (boostFactorVal !== undefined) { placesUpdate += ', boost_factor = ?'; placesParams.push(boostFactorVal); }
  placesUpdate += ' WHERE id = ?';
  placesParams.push(placeId);
  statements.push(env.DB.prepare(placesUpdate).bind(...placesParams));

  // Update costs
  let costsUpdate = 'UPDATE place_costs SET place_id = place_id';
  const costsParams = [];
  if (mandatoryCost !== undefined) { costsUpdate += ', mandatory_cost = ?'; costsParams.push(mandatoryCost); }
  if (optionalCostMin !== undefined) { costsUpdate += ', optional_cost_min = ?'; costsParams.push(optionalCostMin); }
  if (optionalCostMax !== undefined) { costsUpdate += ', optional_cost_max = ?'; costsParams.push(optionalCostMax); }
  costsUpdate += ' WHERE place_id = ?';
  costsParams.push(placeId);
  statements.push(env.DB.prepare(costsUpdate).bind(...costsParams));

  // Update scores
  let scoresUpdate = 'UPDATE place_scores SET place_id = place_id';
  const scoresParams = [];
  if (popularity !== undefined) { scoresUpdate += ', popularity = ?'; scoresParams.push(popularity); }
  if (budgetFriendliness !== undefined) { scoresUpdate += ', budget_friendliness = ?'; scoresParams.push(budgetFriendliness); }
  if (conversation !== undefined) { scoresUpdate += ', conversation = ?'; scoresParams.push(conversation); }
  if (groupSuitability !== undefined) { scoresUpdate += ', group_suitability = ?'; scoresParams.push(groupSuitability); }
  if (dateSuitability !== undefined) { scoresUpdate += ', date_suitability = ?'; scoresParams.push(dateSuitability); }
  if (friendsSuitability !== undefined) { scoresUpdate += ', friends_suitability = ?'; scoresParams.push(friendsSuitability); }
  if (familySuitability !== undefined) { scoresUpdate += ', family_suitability = ?'; scoresParams.push(familySuitability); }
  if (weatherSuitability !== undefined) { scoresUpdate += ', weather_suitability = ?'; scoresParams.push(weatherSuitability); }
  if (uniqueness !== undefined) { scoresUpdate += ', uniqueness = ?'; scoresParams.push(uniqueness); }
  if (experienceScore !== undefined) { scoresUpdate += ', experience_score = ?'; scoresParams.push(experienceScore); }
  if (overall !== undefined) { scoresUpdate += ', overall = ?'; scoresParams.push(overall); }
  scoresUpdate += ' WHERE place_id = ?';
  scoresParams.push(placeId);
  statements.push(env.DB.prepare(scoresUpdate).bind(...scoresParams));

  // Update categories if provided
  if (body.categories !== undefined) {
    statements.push(env.DB.prepare(`DELETE FROM place_categories WHERE place_id = ?`).bind(placeId));
    const categories = Array.isArray(body.categories) ? body.categories : (typeof body.categories === 'string' ? body.categories.split(',').map((c: string) => c.trim()) : []);
    for (const cat of categories) {
      if (cat) {
        statements.push(
          env.DB.prepare(
            `INSERT OR IGNORE INTO place_categories (id, place_id, category) VALUES (?, ?, ?)`
          ).bind(uuid(), placeId, cat.toUpperCase())
        );
      }
    }
  }

  await env.DB.batch(statements);
  return json({ success: true }, { headers: corsHeaders(env) });
}

async function handleDeletePlace(request: Request, env: Env, placeId: string) {
  const existing = await env.DB.prepare(`SELECT id FROM places WHERE id = ?`).bind(placeId).first();
  if (!existing) {
    return json({ success: false, error: { message: 'Place not found' } }, { status: 404, headers: corsHeaders(env) });
  }

  const statements = [
    env.DB.prepare(`DELETE FROM place_categories WHERE place_id = ?`).bind(placeId),
    env.DB.prepare(`DELETE FROM place_costs WHERE place_id = ?`).bind(placeId),
    env.DB.prepare(`DELETE FROM place_scores WHERE place_id = ?`).bind(placeId),
    env.DB.prepare(`DELETE FROM ranking_metrics WHERE place_id = ?`).bind(placeId),
    env.DB.prepare(`DELETE FROM places WHERE id = ?`).bind(placeId)
  ];

  await env.DB.batch(statements);
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

      if (url.pathname === '/api/places/photo' && request.method === 'GET') {
        return handlePlacePhotoWorker(request, env);
      }

      const unauthorized = await assertAuthorized(request, env);
      if (unauthorized) return unauthorized;

      if (url.pathname === '/api/admin/discover-zone' && request.method === 'POST') return handleAdminDiscoverZone(request, env);
      if (url.pathname === '/api/admin/trigger-cron' && request.method === 'POST') {
        const cron = url.searchParams.get('cron') || '0 * * * *';
        const apiKey = env.GOOGLE_MAPS_API_KEY || env.OLA_MAPS_API_KEY || '';
        if (!apiKey) {
          return json({ error: 'API key not configured' }, { status: 500, headers: corsHeaders(env) });
        }
        if (cron === '0 * * * *') {
          await consumeDiscoveryQueue(env.DB, apiKey, 10);
        } else if (cron === '15 */3 * * *') {
          await refreshStalePlaces(env.DB, apiKey, 25);
          await computeZoneCoverage(env.DB);
        } else if (cron === '0 2 * * *') {
          await computeZoneCoverage(env.DB);
          await seedDiscoveryQueue(env.DB);
          await recomputePopularity(env.DB);
          await runDedupePass(env.DB);
          await discoverExperiences(env.DB);
          await resetDailyBudget(env.DB);
        }
        return json({ success: true, triggered: cron }, { headers: corsHeaders(env) });
      }
      if (url.pathname === '/api/admin/discover-experiences' && request.method === 'POST') return handleAdminDiscoverExperiences(request, env);
      if (url.pathname === '/api/admin/places' && request.method === 'GET') return getAdminPlacesWorker(request, env);
      if (url.pathname === '/api/admin/places' && request.method === 'POST') return handleAddPlace(request, env);

      const curateMatch = url.pathname.match(/^\/api\/admin\/places\/([^/]+)\/curate$/);
      if (curateMatch && request.method === 'PATCH') {
        const placeId = curateMatch[1];
        return handleAdminCuratePlace(request, env, placeId);
      }

      const placeMatch = url.pathname.match(/^\/api\/admin\/places\/([^/]+)$/);
      if (placeMatch) {
        const placeId = placeMatch[1];
        if (request.method === 'PATCH') return handleUpdatePlace(request, env, placeId);
        if (request.method === 'DELETE') return handleDeletePlace(request, env, placeId);
      }

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
        if (action === 'presence' && request.method === 'PATCH') return updateMemberPresence(request, env, groupId);
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

  async scheduled(event: { cron: string }, env: Env, ctx: any) {
    console.log(`Scheduled worker triggered with cron: ${event.cron}`);
    const apiKey = env.GOOGLE_MAPS_API_KEY || env.OLA_MAPS_API_KEY || '';
    if (!apiKey) {
      console.error('GOOGLE_MAPS_API_KEY or OLA_MAPS_API_KEY is not set. Scheduled run aborted.');
      return;
    }

    const cron = event.cron;

    // Hourly: consume discovery queue (demand-driven predictive discovery)
    if (cron === '0 * * * *') {
      await consumeDiscoveryQueue(env.DB, apiKey, 10);
    }

    // Every 3 hours: refresh stale places + recompute zone coverage
    if (cron === '15 */3 * * *') {
      await refreshStalePlaces(env.DB, apiKey, 25);
      await computeZoneCoverage(env.DB);
    }

    // Nightly 2 AM: seed queue with deficit zones, recompute popularity, dedup pass
    if (cron === '0 2 * * *') {
      await computeZoneCoverage(env.DB);
      await seedDiscoveryQueue(env.DB);
      await recomputePopularity(env.DB);
      await runDedupePass(env.DB);
      await discoverExperiences(env.DB);
      await resetDailyBudget(env.DB);
    }
  }
};

// ─── Worker background functions ─────────────────────────────────────────────

async function getApiBudgetRemaining(db: D1Database, source: string): Promise<number> {
  const today = new Date().toISOString().split('T')[0];
  try {
    const row = await db
      .prepare(`SELECT calls_used, calls_limit FROM api_budget WHERE day_utc = ? AND source = ?`)
      .bind(today, source)
      .first<{ calls_used: number; calls_limit: number }>();
    return row ? Math.max(0, row.calls_limit - row.calls_used) : (source === 'predictive' ? 500 : source === 'maintenance' ? 200 : 300);
  } catch {
    return 500;
  }
}

async function incrementApiBudget(db: D1Database, source: string): Promise<void> {
  const today = new Date().toISOString().split('T')[0];
  const now = new Date().toISOString();
  const defaultLimit = source === 'predictive' ? 500 : source === 'maintenance' ? 200 : 300;
  try {
    await db.prepare(
      `INSERT INTO api_budget (id, day_utc, source, calls_used, calls_limit, updated_at)
       VALUES (?, ?, ?, 1, ?, ?)
       ON CONFLICT(day_utc, source) DO UPDATE SET calls_used = calls_used + 1, updated_at = ?`
    ).bind(crypto.randomUUID(), today, source, defaultLimit, now, now).run();
  } catch {
    // Non-critical
  }
}

async function resetDailyBudget(db: D1Database): Promise<void> {
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  try {
    await db.prepare(`DELETE FROM api_budget WHERE day_utc < ?`).bind(yesterday).run();
    console.log('[WORKER] Daily budget reset complete');
  } catch (e) {
    console.error('[WORKER] Budget reset failed:', e);
  }
}

async function computeZoneCoverage(db: D1Database): Promise<void> {
  // Only track categories we can actively discover via nearbysearch (ESCAPE_ROOM excluded — no suitable Ola type)
  const categories = ['CAFE', 'RESTAURANT', 'ARCADE', 'BOWLING', 'MUSEUM', 'MALL', 'PARK', 'DESSERT', 'SPORTS', 'MOVIE'];
  const now = new Date().toISOString();

  try {
    // Fetch all active places along with their categories and scores in a single query
    const placesRes = await db.prepare(
      `SELECT p.lat, p.lng, pc.category, p.business_status, ps.overall, p.review_count
       FROM places p
       JOIN place_categories pc ON pc.place_id = p.id
       LEFT JOIN place_scores ps ON ps.place_id = p.id
       WHERE p.is_hidden = 0`
    ).all<{ lat: number; lng: number; category: string; business_status: string; overall: number | null; review_count: number }>();

    const allPlaces = placesRes.results || [];
    const statements: D1PreparedStatement[] = [];

    for (const zone of DISCOVERY_ZONES) {
      const radiusKm = zone.radius / 1000;
      const latDiff = radiusKm / 111.0;
      const lngDiff = radiusKm / (111.0 * Math.cos(zone.lat * Math.PI / 180));

      const minLat = zone.lat - latDiff;
      const maxLat = zone.lat + latDiff;
      const minLng = zone.lng - lngDiff;
      const maxLng = zone.lng + lngDiff;

      // Filter places in memory for this zone's bounding box
      const zonePlaces = allPlaces.filter(
        p => p.lat >= minLat && p.lat <= maxLat && p.lng >= minLng && p.lng <= maxLng
      );

      for (const cat of categories) {
        const catPlaces = zonePlaces.filter(p => p.category === cat);
        const countTotal = catPlaces.length;
        const countViable = catPlaces.filter(
          p => p.business_status === 'OPERATIONAL' && (p.overall ?? 0) >= 0.58 && p.review_count >= 20
        ).length;

        const targetCount = 8;
        const deficitScore = countViable < targetCount ? (targetCount - countViable) / targetCount : 0;

        statements.push(
          db.prepare(
            `INSERT INTO zone_coverage (id, zone_name, category, count_viable, count_total, deficit_score, last_recomputed_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(zone_name, category) DO UPDATE SET
               count_viable = ?, count_total = ?, deficit_score = ?, last_recomputed_at = ?`
          ).bind(
            crypto.randomUUID(), zone.name, cat, countViable, countTotal, deficitScore, now,
            countViable, countTotal, deficitScore, now
          )
        );
      }
    }

    // Execute INSERT/UPDATE statements in batches of 100
    const BATCH_SIZE = 100;
    for (let i = 0; i < statements.length; i += BATCH_SIZE) {
      const chunk = statements.slice(i, i + BATCH_SIZE);
      await db.batch(chunk);
    }

    console.log('[WORKER] Zone coverage recomputed for all zones');
  } catch (e) {
    console.error('[WORKER] computeZoneCoverage failed:', e);
  }
}

async function seedDiscoveryQueue(db: D1Database): Promise<void> {
  const now = new Date().toISOString();
  try {
    const deficits = await db.prepare(
      `SELECT zone_name, category, deficit_score FROM zone_coverage
       WHERE deficit_score > 0 ORDER BY deficit_score DESC LIMIT 100`
    ).all<{ zone_name: string; category: string; deficit_score: number }>();

    // Fetch all currently pending discovery queue items up-front to prevent N+1 SELECT queries
    const pendingItems = await db.prepare(
      `SELECT zone_name, category FROM discovery_queue WHERE status = 'PENDING'`
    ).all<{ zone_name: string; category: string }>();

    const pendingSet = new Set(
      (pendingItems.results || []).map(item => `${item.zone_name}:${item.category}`)
    );

    const statements: D1PreparedStatement[] = [];

    for (const row of deficits.results ?? []) {
      // Skip if already pending
      if (pendingSet.has(`${row.zone_name}:${row.category}`)) {
        continue;
      }

      const zone = DISCOVERY_ZONES.find(z => z.name === row.zone_name);
      if (!zone) continue;

      const priority = Math.min(1.0, row.deficit_score * 1.2);
      statements.push(
        db.prepare(
          `INSERT INTO discovery_queue (id, zone_name, zone_lat, zone_lng, zone_radius, category, priority_score, reason, status, attempt_count, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'scheduled_refresh', 'PENDING', 0, ?, ?)`
        ).bind(
          crypto.randomUUID(), zone.name, zone.lat, zone.lng, zone.radius, row.category, priority, now, now
        )
      );
    }

    // Execute INSERT statements in batches of 100
    const BATCH_SIZE = 100;
    for (let i = 0; i < statements.length; i += BATCH_SIZE) {
      const chunk = statements.slice(i, i + BATCH_SIZE);
      await db.batch(chunk);
    }

    console.log(`[WORKER] Seeded ${statements.length} items into discovery queue`);
  } catch (e) {
    console.error('[WORKER] seedDiscoveryQueue failed:', e);
  }
}

async function consumeDiscoveryQueue(db: D1Database, apiKey: string, maxItems: number): Promise<void> {
  const remaining = await getApiBudgetRemaining(db, 'predictive');
  if (remaining <= 0) {
    console.log('[WORKER] Predictive API budget exhausted, skipping discovery tick');
    return;
  }

  const toProcess = Math.min(maxItems, remaining);

  try {
    let rows = await db.prepare(
      `SELECT * FROM discovery_queue WHERE status = 'PENDING' ORDER BY priority_score DESC LIMIT ?`
    ).bind(toProcess).all<any>();

    if (!rows.results || rows.results.length === 0) {
      console.log('[WORKER] Discovery queue empty; recomputing coverage and seeding deficits');
      await computeZoneCoverage(db);
      await seedDiscoveryQueue(db);
      rows = await db.prepare(
        `SELECT * FROM discovery_queue WHERE status = 'PENDING' ORDER BY priority_score DESC LIMIT ?`
      ).bind(toProcess).all<any>();
    }

    for (const item of rows.results ?? []) {
      const now = new Date().toISOString();
      try {
        // Mark in-progress
        await db.prepare(
          `UPDATE discovery_queue SET status = 'IN_PROGRESS', last_attempted_at = ?, attempt_count = attempt_count + 1, updated_at = ? WHERE id = ?`
        ).bind(now, now, item.id).run();

        const count = await discoverZonePlaces(db, item.zone_name, item.zone_lat, item.zone_lng, item.zone_radius, apiKey, item.category);
        await incrementApiBudget(db, 'predictive');

        await db.prepare(
          `UPDATE discovery_queue SET status = 'COMPLETED', last_error = NULL, updated_at = ? WHERE id = ?`
        ).bind(now, item.id).run();

        console.log(`[WORKER] Queue item completed: ${item.zone_name}/${item.category} → ${count} places`);
      } catch (itemErr) {
        const errMsg = itemErr instanceof Error ? itemErr.message : String(itemErr);
        await db.prepare(
          `UPDATE discovery_queue SET status = 'FAILED', last_error = ?, updated_at = ? WHERE id = ?`
        ).bind(errMsg.slice(0, 500), new Date().toISOString(), item.id).run();
        console.error(`[WORKER] Queue item failed: ${item.zone_name}/${item.category}:`, itemErr);
      }
    }
  } catch (e) {
    console.error('[WORKER] consumeDiscoveryQueue failed:', e);
  }
}

async function refreshStalePlaces(db: D1Database, apiKey: string, count: number): Promise<void> {
  const remaining = await getApiBudgetRemaining(db, 'maintenance');
  if (remaining <= 0) return;

  const staleCutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  try {
    const rows = await db.prepare(
      `SELECT id, source_place_id FROM places
       WHERE is_hidden = 0 AND business_status = 'OPERATIONAL' AND last_verified < ?
       ORDER BY last_verified ASC LIMIT ?`
    ).bind(staleCutoff, Math.min(count, remaining)).all<{ id: string; source_place_id: string }>();

    const now = new Date().toISOString();
    for (const place of rows.results ?? []) {
      try {
        const detailsUrl = `https://api.olamaps.io/places/v1/details?place_id=${encodeURIComponent(place.source_place_id)}&api_key=${apiKey}`;
        const res = await fetch(detailsUrl, {
          headers: { 'X-Request-Id': `hangoutt-refresh-${Date.now()}`, 'Referer': 'http://localhost:3000', 'Origin': 'http://localhost:3000' },
          signal: AbortSignal.timeout(5000),
        });
        await incrementApiBudget(db, 'maintenance');

        if (!res.ok) {
          // If 404, increment miss counter; hide after 3 misses
          if (res.status === 404) {
            await db.prepare(
              `UPDATE places SET times_returned_zero_results = COALESCE(times_returned_zero_results, 0) + 1, updated_at = ? WHERE id = ?`
            ).bind(now, place.id).run().catch(() => {});
            const row = await db.prepare(`SELECT COALESCE(times_returned_zero_results, 0) as c FROM places WHERE id = ?`).bind(place.id).first<{ c: number }>();
            if (row && row.c >= 3) {
              await db.prepare(`UPDATE places SET is_hidden = 1, updated_at = ? WHERE id = ?`).bind(now, place.id).run();
              console.log(`[WORKER] Hidden place ${place.id} after 3 consecutive 404s`);
            }
          }
          continue;
        }

        const data = await res.json() as any;
        const result = data?.result;
        if (!result) continue;

        const businessStatus = (result.business_status || 'OPERATIONAL').toUpperCase();
        const isPermanentlyClosed = businessStatus.includes('PERMANENTLY') || businessStatus.includes('CLOSED_PERMANENTLY');
        const rating = result.rating ? Number(result.rating) : null;
        const reviewCount = result.user_ratings_total || 0;
        const phone = result.formatted_phone_number || null;
        const openingHoursJson = result.opening_hours ? JSON.stringify(result.opening_hours) : null;

        await db.prepare(
          `UPDATE places SET rating = ?, review_count = ?, business_status = ?, phone = ?,
           opening_hours_json = ?, last_verified = ?, is_hidden = ?, updated_at = ? WHERE id = ?`
        ).bind(rating, reviewCount, isPermanentlyClosed ? 'CLOSED_PERMANENTLY' : 'OPERATIONAL', phone,
          openingHoursJson, now, isPermanentlyClosed ? 1 : 0, now, place.id).run();

        if (isPermanentlyClosed) {
          console.log(`[WORKER] Marked ${place.id} as permanently closed`);
        }
      } catch (e) {
        console.error(`[WORKER] Refresh failed for place ${place.id}:`, e);
      }
    }
    console.log(`[WORKER] Refreshed up to ${count} stale places`);
  } catch (e) {
    console.error('[WORKER] refreshStalePlaces failed:', e);
  }
}

async function recomputePopularity(db: D1Database): Promise<void> {
  try {
    // Update popularity score from ranking_metrics using log-scaled formula
    await db.prepare(
      `UPDATE place_scores SET popularity = (
         SELECT MIN(1.0, (
           LOG(1 + rm.times_viewed) * 0.4 +
           LOG(1 + rm.times_voted) * 0.3 +
           LOG(1 + rm.times_won) * 0.3
         ) / 3.0)
         FROM ranking_metrics rm WHERE rm.place_id = place_scores.place_id
       )
       WHERE place_id IN (SELECT place_id FROM ranking_metrics WHERE times_generated > 0)`
    ).run();

    // Recompute overall as average of popularity + conversation + experience_score
    await db.prepare(
      `UPDATE place_scores SET overall = (popularity + conversation + experience_score) / 3.0`
    ).run();

    console.log('[WORKER] Popularity recomputed from ranking_metrics');
  } catch (e) {
    console.error('[WORKER] recomputePopularity failed:', e);
  }
}

async function runDedupePass(db: D1Database): Promise<void> {
  // Hide places that have the same source_place_id as a higher-rated version
  try {
    await db.prepare(
      `UPDATE places SET is_hidden = 1 WHERE id IN (
         SELECT p2.id FROM places p1
         JOIN places p2 ON p1.source_place_id = p2.source_place_id AND p1.id != p2.id
         WHERE p1.rating >= COALESCE(p2.rating, 0) AND p1.id < p2.id AND p2.is_hidden = 0
       )`
    ).run();
    console.log('[WORKER] Dedupe pass complete');
  } catch (e) {
    console.error('[WORKER] runDedupePass failed:', e);
  }
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

async function handlePlacePhotoWorker(request: Request, env: Env) {
  try {
    const url = new URL(request.url);
    const ref = url.searchParams.get('ref');
    const maxWidth = url.searchParams.get('maxwidth') || '300';

    if (!ref) {
      return json({ error: 'Missing photo reference ("ref")' }, { status: 400, headers: corsHeaders(env) });
    }

    // 1. Check D1 cache — match by exact image_url to avoid LIKE pattern complexity errors
    const expectedImageUrl = `/api/places/photo?ref=${encodeURIComponent(ref)}`;
    const cached = await env.DB.prepare(
      `SELECT image_data FROM places 
       WHERE image_data IS NOT NULL AND image_url = ? LIMIT 1`
    ).bind(expectedImageUrl).first<{ image_data: string }>();

    if (cached && cached.image_data) {
      const imageBuffer = base64ToArrayBuffer(cached.image_data);
      return new Response(imageBuffer, {
        status: 200,
        headers: {
          'Content-Type': 'image/jpeg',
          'Cache-Control': 'public, max-age=604800, s-maxage=604800, stale-while-revalidate=86400',
          'Content-Length': String(imageBuffer.byteLength),
          ...corsHeaders(env)
        },
      });
    }

    const fallbackRedirect = async () => {
      try {
        const placeRecord = await env.DB.prepare(
          `SELECT pc.category 
           FROM places p 
           JOIN place_categories pc ON p.id = pc.place_id 
           WHERE p.image_url = ? LIMIT 1`
        ).bind(expectedImageUrl).first<{ category: string }>();
        const category = placeRecord ? placeRecord.category : undefined;
        const CATEGORY_FALLBACK_IMAGES: Record<string, string> = {
          'CAFE': 'https://images.unsplash.com/photo-1501339847302-ac426a4a7cbb?w=600&auto=format&fit=crop',
          'RESTAURANT': 'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=600&auto=format&fit=crop',
          'DESSERT': 'https://images.unsplash.com/photo-1488477181946-6428a0291777?w=600&auto=format&fit=crop',
          'PARK': 'https://images.unsplash.com/photo-1519331379826-f10be5486c6f?w=600&auto=format&fit=crop',
          'ARCADE': 'https://images.unsplash.com/photo-1511512578047-dfb367046420?w=600&auto=format&fit=crop',
          'BOWLING': 'https://images.unsplash.com/photo-1538510166367-5477e2a521e7?w=600&auto=format&fit=crop',
          'ESCAPE_ROOM': 'https://images.unsplash.com/photo-1519074069444-1ba4e6664104?w=600&auto=format&fit=crop',
          'POTTERY': 'https://images.unsplash.com/photo-1565192647048-f997ded87ab5?w=600&auto=format&fit=crop',
          'LIVE_MUSIC': 'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=600&auto=format&fit=crop',
        };
        const fallbackUrl = (category && CATEGORY_FALLBACK_IMAGES[category.toUpperCase()]) || 'https://images.unsplash.com/photo-1528605248644-14dd04022da1?w=600&auto=format&fit=crop';
        return new Response(null, {
          status: 307,
          headers: {
            'Location': fallbackUrl,
            ...corsHeaders(env)
          }
        });
      } catch {
        return new Response(null, {
          status: 307,
          headers: {
            'Location': 'https://images.unsplash.com/photo-1528605248644-14dd04022da1?w=600&auto=format&fit=crop',
            ...corsHeaders(env)
          }
        });
      }
    };

    // 2. Fetch from Google
    const apiKey = env.GOOGLE_MAPS_API_KEY || env.OLA_MAPS_API_KEY || '';
    if (!apiKey) {
      return fallbackRedirect();
    }

    const googleUrl = `https://maps.googleapis.com/maps/api/place/photo?maxwidth=${maxWidth}&photo_reference=${ref}&key=${apiKey}`;

    const redirectRes = await fetch(googleUrl, { redirect: 'manual' });
    const redirectUrl = redirectRes.headers.get('location');

    if (!redirectUrl) {
      return fallbackRedirect();
    }

    const imageRes = await fetch(redirectUrl);
    if (!imageRes.ok) {
      return fallbackRedirect();
    }

    const imageBuffer = await imageRes.arrayBuffer();
    const base64 = arrayBufferToBase64(imageBuffer);

    // 3. Cache in DB (save to D1) — use exact match on image_url
    try {
      await env.DB.prepare(
        `UPDATE places SET image_data = ? WHERE image_url = ?`
      ).bind(base64, expectedImageUrl).run();
      console.log(`[PHOTO CACHE] Cached image for ref ${ref.substring(0, 30)}...`);
    } catch (err: any) {
      console.warn('[PHOTO CACHE] Failed to cache image:', err.message);
    }

    return new Response(imageBuffer, {
      status: 200,
      headers: {
        'Content-Type': imageRes.headers.get('content-type') || 'image/jpeg',
        'Cache-Control': 'public, max-age=604800, s-maxage=604800, stale-while-revalidate=86400',
        'Content-Length': String(imageBuffer.byteLength),
        ...corsHeaders(env)
      },
    });
  } catch (err: any) {
    console.error('[PHOTO PROXY ERROR]', err);
    return new Response(null, {
      status: 307,
      headers: {
        'Location': 'https://images.unsplash.com/photo-1528605248644-14dd04022da1?w=600&auto=format&fit=crop',
        ...corsHeaders(env)
      }
    });
  }
}
