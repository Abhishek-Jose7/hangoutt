var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// workers/api.ts
var JSON_HEADERS = {
  "Content-Type": "application/json"
};
function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      ...JSON_HEADERS,
      ...init.headers
    }
  });
}
__name(json, "json");
function corsHeaders(env) {
  return {
    "Access-Control-Allow-Origin": env.CORS_ORIGIN || "*",
    "Access-Control-Allow-Methods": "GET,POST,PATCH,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization"
  };
}
__name(corsHeaders, "corsHeaders");
async function timingSafeEqual(a, b) {
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
__name(timingSafeEqual, "timingSafeEqual");
async function assertAuthorized(request, env) {
  const header = request.headers.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
  if (!env.HANGOUT_API_SECRET || !await timingSafeEqual(token, env.HANGOUT_API_SECRET)) {
    return json(
      { success: false, error: { code: "UNAUTHORIZED", message: "Invalid API credentials." } },
      { status: 401, headers: corsHeaders(env) }
    );
  }
  return null;
}
__name(assertAuthorized, "assertAuthorized");
async function readJson(request) {
  return request.json();
}
__name(readJson, "readJson");
function uuid() {
  return crypto.randomUUID();
}
__name(uuid, "uuid");
function inviteCode() {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => chars[byte % chars.length]).join("");
}
__name(inviteCode, "inviteCode");
async function upsertUser(db, user) {
  const existing = await db.prepare(
    `SELECT id, clerk_id AS clerkId, email, name, image_url AS imageUrl
       FROM users
       WHERE clerk_id = ?`
  ).bind(user.clerkId).first();
  if (existing) {
    await db.prepare(
      `UPDATE users
         SET email = ?, name = ?, image_url = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`
    ).bind(user.email, user.name, user.imageUrl, existing.id).run();
    return { ...existing, email: user.email, name: user.name, imageUrl: user.imageUrl };
  }
  const id = uuid();
  await db.prepare(
    `INSERT INTO users (id, clerk_id, email, name, image_url)
       VALUES (?, ?, ?, ?, ?)`
  ).bind(id, user.clerkId, user.email, user.name, user.imageUrl).run();
  return { id, clerkId: user.clerkId, email: user.email, name: user.name, imageUrl: user.imageUrl };
}
__name(upsertUser, "upsertUser");
async function findUserByClerkId(db, clerkId) {
  return db.prepare(
    `SELECT id, clerk_id AS clerkId, email, name, image_url AS imageUrl
       FROM users
       WHERE clerk_id = ?`
  ).bind(clerkId).first();
}
__name(findUserByClerkId, "findUserByClerkId");
function normalizeInviteCode(code) {
  return code.trim().toUpperCase().replace(/[IL1]/g, "L").replace(/[O0]/g, "0");
}
__name(normalizeInviteCode, "normalizeInviteCode");
async function createGroup(request, env) {
  const body = await readJson(request);
  const user = await upsertUser(env.DB, body.user);
  const groupId = uuid();
  const code = inviteCode();
  const inviteId = uuid();
  const memberId = uuid();
  const expiresAt = Math.floor(Date.now() / 1e3) + 7 * 24 * 60 * 60;
  const description = body.group.description || null;
  const vibes = body.group.vibes ? JSON.stringify(body.group.vibes) : null;
  const outingDate = body.group.outingDate || null;
  const outingTime = body.group.outingTime || null;
  const isFastTrack = body.group.isFastTrack ? 1 : 0;
  const now = (/* @__PURE__ */ new Date()).toISOString();
  let timerExpiresAt = null;
  if (isFastTrack === 1) {
    timerExpiresAt = new Date(Date.now() + 30 * 1e3).toISOString();
  }
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO groups
         (id, name, description, group_type, vibes, creator_id, invite_code, status, voting_status, max_members, outing_date, outing_time, is_fast_track, timer_expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'COLLECTING_MEMBERS', 'CLOSED', 20, ?, ?, ?, ?)`
    ).bind(groupId, body.group.name, description, body.group.groupType, vibes, user.id, code, outingDate, outingTime, isFastTrack, timerExpiresAt),
    env.DB.prepare(
      `INSERT INTO group_members (id, group_id, user_id, role)
         VALUES (?, ?, ?, 'ADMIN')`
    ).bind(memberId, groupId, user.id),
    env.DB.prepare(
      `INSERT INTO invites (id, group_id, invite_code, expires_at, revoked)
         VALUES (?, ?, ?, ?, 0)`
    ).bind(inviteId, groupId, code, expiresAt)
  ]);
  const group = {
    id: groupId,
    name: body.group.name,
    description,
    groupType: body.group.groupType,
    vibes,
    creatorId: user.id,
    inviteCode: code,
    status: "COLLECTING_MEMBERS",
    votingStatus: "CLOSED",
    maxMembers: 20,
    winningPlanId: null,
    outingDate,
    outingTime,
    isFastTrack,
    timerExpiresAt,
    createdAt: now,
    updatedAt: now,
    memberCount: 1
  };
  return json({ success: true, data: group }, { headers: corsHeaders(env) });
}
__name(createGroup, "createGroup");
async function listGroups(request, env) {
  const url = new URL(request.url);
  const clerkId = url.searchParams.get("clerkId");
  if (!clerkId) {
    return json(
      { success: false, error: { code: "VALIDATION_ERROR", message: "Missing clerkId." } },
      { status: 422, headers: corsHeaders(env) }
    );
  }
  const results = await env.DB.prepare(
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
  ).bind(clerkId).all();
  return json({ success: true, data: results.results || [] }, { headers: corsHeaders(env) });
}
__name(listGroups, "listGroups");
async function getGroupById(db, groupId) {
  return db.prepare(
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
  ).bind(groupId).first();
}
__name(getGroupById, "getGroupById");
async function getGroupDetails(request, env, groupId) {
  const url = new URL(request.url);
  const clerkId = url.searchParams.get("clerkId");
  if (!clerkId) {
    return json(
      { success: false, error: { code: "VALIDATION_ERROR", message: "Missing clerkId." } },
      { status: 422, headers: corsHeaders(env) }
    );
  }
  const user = await findUserByClerkId(env.DB, clerkId);
  if (!user) {
    return json(
      { success: false, error: { code: "NOT_FOUND", message: "User has not been synced to D1 yet." } },
      { status: 404, headers: corsHeaders(env) }
    );
  }
  const caller = await env.DB.prepare(`SELECT role FROM group_members WHERE group_id = ? AND user_id = ?`).bind(groupId, user.id).first();
  if (!caller) {
    return json(
      { success: false, error: { code: "FORBIDDEN", message: "You are not authorized to view this group." } },
      { status: 403, headers: corsHeaders(env) }
    );
  }
  const group = await getGroupById(env.DB, groupId);
  if (!group || group.status === "DELETED") {
    return json(
      { success: false, error: { code: "NOT_FOUND", message: "Group not found." } },
      { status: 404, headers: corsHeaders(env) }
    );
  }
  const [membersRes, budgetsRes, locationsRes, summaryRes] = await Promise.all([
    env.DB.prepare(
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
    ).bind(groupId).all(),
    env.DB.prepare(`SELECT * FROM budgets WHERE group_id = ?`).bind(groupId).all(),
    env.DB.prepare(`SELECT * FROM locations WHERE group_id = ?`).bind(groupId).all(),
    env.DB.prepare(`SELECT 1`).bind().all()
    // placeholder since we calculate summary in JS now
  ]);
  const members = membersRes.results || [];
  members.forEach((m) => {
    m.isPresent = 1;
  });
  const presentMembers = members;
  const presentUserIds = presentMembers.map((m) => m.userId);
  const budgets = (budgetsRes.results || []).filter((b) => presentUserIds.includes(b.user_id));
  const locations = (locationsRes.results || []).filter((l) => presentUserIds.includes(l.user_id));
  const isAdmin = caller.role === "ADMIN";
  const cleanLocations = locations.map((location) => {
    const member = members.find((item) => item.userId === location.user_id);
    return {
      name: member ? member.name : "Participant",
      locationName: location.location_name || `${Number(location.lat).toFixed(2)}, ${Number(location.lng).toFixed(2)}`,
      lat: isAdmin || location.user_id === user.id ? location.lat : 0,
      lng: isAdmin || location.user_id === user.id ? location.lng : 0,
      userId: location.user_id
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
    totalMembers: presentMembers.length
  };
  const isReady = isGroupReady(group.status, members, budgets, locations);
  if (isReady && group.status === "COLLECTING_DETAILS") {
    await env.DB.prepare(`UPDATE groups SET status = 'READY_TO_GENERATE', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(groupId).run();
    group.status = "READY_TO_GENERATE";
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
          location: currentUserLocation ? {
            id: currentUserLocation.id,
            groupId,
            userId: user.id,
            lat: currentUserLocation.lat,
            lng: currentUserLocation.lng,
            locationName: currentUserLocation.location_name
          } : null
        }
      }
    },
    { headers: corsHeaders(env) }
  );
}
__name(getGroupDetails, "getGroupDetails");
function isGroupReady(status, members, budgets, locations) {
  if (status !== "COLLECTING_DETAILS" && status !== "READY_TO_GENERATE") {
    return ["READY_TO_GENERATE", "GENERATING", "VOTING", "COMPLETED", "ARCHIVED"].includes(status);
  }
  return members.length > 0;
}
__name(isGroupReady, "isGroupReady");
async function joinGroup(request, env) {
  const body = await readJson(request);
  const user = await upsertUser(env.DB, body.user);
  const normalized = normalizeInviteCode(body.inviteCode);
  const invites = await env.DB.prepare(
    `SELECT i.id, i.group_id AS groupId, i.invite_code AS inviteCode, i.expires_at AS expiresAt, i.revoked
       FROM invites i
       WHERE i.revoked = 0`
  ).all();
  const invite = (invites.results || []).find((item) => normalizeInviteCode(item.inviteCode) === normalized);
  if (!invite) {
    return json(
      { success: false, error: { code: "NOT_FOUND", message: "Active invite code not found." } },
      { status: 404, headers: corsHeaders(env) }
    );
  }
  if (Math.floor(Date.now() / 1e3) > invite.expiresAt) {
    return json(
      { success: false, error: { code: "INVITE_EXPIRED", message: "Invite link has expired." } },
      { status: 410, headers: corsHeaders(env) }
    );
  }
  const existing = await env.DB.prepare(`SELECT id, group_id AS groupId, user_id AS userId, role FROM group_members WHERE group_id = ? AND user_id = ?`).bind(invite.groupId, user.id).first();
  if (existing) {
    return json({ success: true, data: existing }, { headers: corsHeaders(env) });
  }
  const member = {
    id: uuid(),
    groupId: invite.groupId,
    userId: user.id,
    role: "MEMBER"
  };
  await env.DB.prepare(`INSERT INTO group_members (id, group_id, user_id, role) VALUES (?, ?, ?, 'MEMBER')`).bind(member.id, member.groupId, member.userId).run();
  return json({ success: true, data: member }, { headers: corsHeaders(env) });
}
__name(joinGroup, "joinGroup");
async function submitBudget(request, env, groupId) {
  const body = await readJson(request);
  const user = await findUserByClerkId(env.DB, body.clerkId);
  if (!user) {
    return json(
      { success: false, error: { code: "NOT_FOUND", message: "User has not been synced to D1 yet." } },
      { status: 404, headers: corsHeaders(env) }
    );
  }
  const id = uuid();
  const travelIncludedVal = body.travelIncluded === false ? 0 : 1;
  await env.DB.prepare(
    `INSERT INTO budgets (id, group_id, user_id, max_budget, travel_included)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(group_id, user_id)
       DO UPDATE SET max_budget = excluded.max_budget, travel_included = excluded.travel_included, updated_at = CURRENT_TIMESTAMP`
  ).bind(id, groupId, user.id, body.maxBudget, travelIncludedVal).run();
  await updateReadiness(env.DB, groupId);
  const budget = await env.DB.prepare(
    `SELECT id, group_id AS groupId, user_id AS userId, max_budget AS maxBudget, travel_included AS travelIncluded, created_at AS createdAt, updated_at AS updatedAt
       FROM budgets
       WHERE group_id = ? AND user_id = ?`
  ).bind(groupId, user.id).first();
  return json({ success: true, data: budget }, { headers: corsHeaders(env) });
}
__name(submitBudget, "submitBudget");
async function submitLocation(request, env, groupId) {
  const body = await readJson(request);
  const user = await findUserByClerkId(env.DB, body.clerkId);
  if (!user) {
    return json(
      { success: false, error: { code: "NOT_FOUND", message: "User has not been synced to D1 yet." } },
      { status: 404, headers: corsHeaders(env) }
    );
  }
  const id = uuid();
  await env.DB.prepare(
    `INSERT INTO locations (id, group_id, user_id, lat, lng, location_name)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(group_id, user_id)
       DO UPDATE SET lat = excluded.lat, lng = excluded.lng, location_name = excluded.location_name, updated_at = CURRENT_TIMESTAMP`
  ).bind(id, groupId, user.id, body.lat, body.lng, body.locationName || null).run();
  await updateReadiness(env.DB, groupId);
  const location = await env.DB.prepare(
    `SELECT id, group_id AS groupId, user_id AS userId, lat, lng, location_name AS locationName, created_at AS createdAt, updated_at AS updatedAt
       FROM locations
       WHERE group_id = ? AND user_id = ?`
  ).bind(groupId, user.id).first();
  return json({ success: true, data: location }, { headers: corsHeaders(env) });
}
__name(submitLocation, "submitLocation");
async function submitVibes(request, env, groupId) {
  const body = await readJson(request);
  const user = await findUserByClerkId(env.DB, body.clerkId);
  if (!user) {
    return json(
      { success: false, error: { code: "NOT_FOUND", message: "User has not been synced to D1 yet." } },
      { status: 404, headers: corsHeaders(env) }
    );
  }
  await env.DB.prepare(`UPDATE group_members SET vibes = ? WHERE group_id = ? AND user_id = ?`).bind(JSON.stringify(body.vibes), groupId, user.id).run();
  const member = await env.DB.prepare(
    `SELECT id, group_id AS groupId, user_id AS userId, role, vibes, created_at AS createdAt
       FROM group_members
       WHERE group_id = ? AND user_id = ?`
  ).bind(groupId, user.id).first();
  return json({ success: true, data: member }, { headers: corsHeaders(env) });
}
__name(submitVibes, "submitVibes");
async function startDetailsCollection(request, env, groupId) {
  const body = await readJson(request);
  const user = await findUserByClerkId(env.DB, body.clerkId);
  if (!user) {
    return json(
      { success: false, error: { code: "NOT_FOUND", message: "User has not been synced to D1 yet." } },
      { status: 404, headers: corsHeaders(env) }
    );
  }
  const member = await env.DB.prepare(`SELECT role FROM group_members WHERE group_id = ? AND user_id = ?`).bind(groupId, user.id).first();
  if (!member || member.role !== "ADMIN") {
    return json(
      { success: false, error: { code: "FORBIDDEN", message: "Only the group admin can lock the member list." } },
      { status: 403, headers: corsHeaders(env) }
    );
  }
  const groupData = await env.DB.prepare(`SELECT is_fast_track AS isFastTrack FROM groups WHERE id = ?`).bind(groupId).first();
  const timerExpiresAt = groupData?.isFastTrack === 1 ? new Date(Date.now() + 30 * 1e3).toISOString() : null;
  await env.DB.prepare(`UPDATE groups SET status = 'COLLECTING_DETAILS', timer_expires_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(timerExpiresAt, groupId).run();
  const group = await getGroupById(env.DB, groupId);
  return json({ success: true, data: group }, { headers: corsHeaders(env) });
}
__name(startDetailsCollection, "startDetailsCollection");
async function updateReadiness(db, groupId) {
  const group = await db.prepare(`SELECT status FROM groups WHERE id = ?`).bind(groupId).first();
  if (!group || group.status !== "COLLECTING_DETAILS") return;
  const [membersRes, budgetsRes, locationsRes] = await Promise.all([
    db.prepare(`SELECT user_id AS userId, is_present AS isPresent FROM group_members WHERE group_id = ?`).bind(groupId).all(),
    db.prepare(`SELECT user_id AS userId FROM budgets WHERE group_id = ?`).bind(groupId).all(),
    db.prepare(`SELECT user_id AS userId FROM locations WHERE group_id = ?`).bind(groupId).all()
  ]);
  const members = membersRes.results || [];
  if (members.length > 0) {
    await db.prepare(`UPDATE groups SET status = 'READY_TO_GENERATE', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(groupId).run();
  }
}
__name(updateReadiness, "updateReadiness");
async function updateMemberPresence(request, env, groupId) {
  const body = await readJson(request);
  const user = await findUserByClerkId(env.DB, body.clerkId);
  if (!user) {
    return json(
      { success: false, error: { code: "NOT_FOUND", message: "User has not been synced to D1 yet." } },
      { status: 404, headers: corsHeaders(env) }
    );
  }
  const caller = await env.DB.prepare(`SELECT role FROM group_members WHERE group_id = ? AND user_id = ?`).bind(groupId, user.id).first();
  if (!caller || caller.role !== "ADMIN") {
    return json(
      { success: false, error: { code: "FORBIDDEN", message: "Only the group admin can update member presence." } },
      { status: 403, headers: corsHeaders(env) }
    );
  }
  const statements = [];
  for (const [userId, isPresent] of Object.entries(body.presenceMap)) {
    statements.push(
      env.DB.prepare(`UPDATE group_members SET is_present = ? WHERE group_id = ? AND user_id = ?`).bind(isPresent ? 1 : 0, groupId, userId)
    );
  }
  await env.DB.batch(statements);
  await updateReadiness(env.DB, groupId);
  return json({ success: true }, { headers: corsHeaders(env) });
}
__name(updateMemberPresence, "updateMemberPresence");
async function getUser(request, env) {
  const url = new URL(request.url);
  const clerkId = url.searchParams.get("clerkId");
  if (!clerkId) {
    return json({ success: false, error: { code: "VALIDATION_ERROR", message: "Missing clerkId." } }, { status: 422, headers: corsHeaders(env) });
  }
  const user = await env.DB.prepare(
    `SELECT id, clerk_id AS clerkId, email, name, image_url AS imageUrl,
            preferred_budget_min AS preferredBudgetMin, preferred_budget_max AS preferredBudgetMax,
            favorite_activities AS favoriteActivities
     FROM users WHERE clerk_id = ?`
  ).bind(clerkId).first();
  if (!user) {
    return json({ success: false, error: { code: "NOT_FOUND", message: "User not found." } }, { status: 404, headers: corsHeaders(env) });
  }
  return json({ success: true, data: user }, { headers: corsHeaders(env) });
}
__name(getUser, "getUser");
async function updateUserProfile(request, env) {
  const body = await readJson(request);
  const user = await findUserByClerkId(env.DB, body.clerkId);
  if (!user) {
    return json({ success: false, error: { code: "NOT_FOUND", message: "User not found." } }, { status: 404, headers: corsHeaders(env) });
  }
  const minB = body.preferredBudgetMin !== void 0 ? body.preferredBudgetMin : null;
  const maxB = body.preferredBudgetMax !== void 0 ? body.preferredBudgetMax : null;
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
__name(updateUserProfile, "updateUserProfile");
async function savePlans(request, env, groupId) {
  const body = await readJson(request);
  const group = await getGroupById(env.DB, groupId);
  if (!group) {
    return json({ success: false, error: { code: "NOT_FOUND", message: "Group not found." } }, { status: 404, headers: corsHeaders(env) });
  }
  const oldPlans = await env.DB.prepare(`SELECT id FROM plans WHERE group_id = ?`).bind(groupId).all();
  const oldPlanIds = (oldPlans.results || []).map((p) => p.id);
  const statements = [];
  if (oldPlanIds.length > 0) {
    for (const planId of oldPlanIds) {
      statements.push(env.DB.prepare(`DELETE FROM member_travel_metrics WHERE plan_id = ?`).bind(planId));
      statements.push(env.DB.prepare(`DELETE FROM plan_slots WHERE plan_id = ?`).bind(planId));
      statements.push(env.DB.prepare(`DELETE FROM votes WHERE plan_id = ?`).bind(planId));
    }
  }
  statements.push(env.DB.prepare(`DELETE FROM plans WHERE group_id = ?`).bind(groupId));
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
      plan.id,
      plan.groupId,
      plan.planIndex,
      plan.name,
      plan.tagline,
      plan.meetupZone,
      plan.budgetTier || "BALANCED",
      plan.totalEstimatedCostPerHead,
      plan.totalDurationMinutes,
      plan.score,
      plan.experienceScore,
      plan.travelScore,
      plan.budgetScore,
      plan.fairnessScore,
      plan.popularityScore,
      plan.groupTypeMatchScore,
      plan.vibeMatchScore,
      plan.compositeScore,
      plan.avgTrainTime,
      plan.avgCabTime,
      plan.avgTrainCost,
      plan.avgCabCost,
      plan.longestTravelTime,
      plan.shortestTravelTime,
      plan.travelFairnessScore,
      plan.mandatoryCost || 0,
      plan.optionalCostMin || 0,
      plan.optionalCostMax || 0,
      plan.whyRecommended || null,
      plan.avgAutoTime || 0,
      plan.avgAutoCost || 0,
      plan.avgTotalTime || 0,
      plan.avgTotalCost || 0,
      plan.avgWalkTime || 0,
      plan.generatedAt || (/* @__PURE__ */ new Date()).toISOString()
    ));
  }
  for (const slot of body.slots) {
    statements.push(env.DB.prepare(
      `INSERT INTO plan_slots (
        id, plan_id, slot_order, venue_id, experience_id, venue_name, name, category, 
        arrival_time, duration_minutes, travel_to_next_minutes, estimated_cost_per_head, note,
        travel_to_next_cost, image_url, link
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      slot.id,
      slot.planId,
      slot.slotOrder,
      slot.venueId || null,
      slot.experienceId || null,
      slot.venueName || null,
      slot.name,
      slot.category,
      slot.arrivalTime,
      slot.durationMinutes,
      slot.travelToNextMinutes || null,
      slot.estimatedCostPerHead,
      slot.note,
      slot.travelToNextCost || null,
      slot.imageUrl || null,
      slot.link || null
    ));
  }
  for (const t of body.memberTravels) {
    statements.push(env.DB.prepare(
      `INSERT INTO member_travel_metrics (
        id, plan_id, user_id, train_time, train_cost, cab_time, cab_cost, walk_time,
        auto_time, auto_cost, total_time, total_cost
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      t.id,
      t.planId,
      t.userId,
      t.trainTime,
      t.trainCost,
      t.cabTime,
      t.cabCost,
      t.walkTime,
      t.autoTime || 0,
      t.autoCost || 0,
      t.totalTime || 0,
      t.totalCost || 0
    ));
  }
  for (const slot of body.slots) {
    if (slot.venueId && !slot.venueId.startsWith("fallback_")) {
      statements.push(env.DB.prepare(
        `INSERT INTO ranking_metrics (place_id, times_generated, times_viewed, times_voted, times_won)
         VALUES (?, 1, 0, 0, 0)
         ON CONFLICT(place_id)
         DO UPDATE SET times_generated = times_generated + 1`
      ).bind(slot.venueId));
    }
  }
  const isFastTrackVal = group?.isFastTrack === 1 ? 1 : 0;
  const timerExpiresAt = isFastTrackVal === 1 ? new Date(Date.now() + 30 * 1e3).toISOString() : null;
  const genOptionsStr = body.generationOptions ? JSON.stringify(body.generationOptions) : null;
  statements.push(env.DB.prepare(
    `UPDATE groups SET status = 'VOTING', voting_status = 'OPEN', timer_expires_at = ?, generation_options = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
  ).bind(timerExpiresAt, genOptionsStr, groupId));
  await env.DB.batch(statements);
  return json({ success: true }, { headers: corsHeaders(env) });
}
__name(savePlans, "savePlans");
async function getPlans(request, env, groupId) {
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
  ).bind(groupId).all();
  const groupPlans = plansRes.results || [];
  if (groupPlans.length === 0) {
    return json({ success: true, data: [] }, { headers: corsHeaders(env) });
  }
  const planIds = groupPlans.map((p) => p.id);
  const slotsRes = await env.DB.prepare(
    `SELECT 
      id, plan_id AS planId, slot_order AS slotOrder, venue_id AS venueId,
      experience_id AS experienceId, venue_name AS venueName, name, category,
      arrival_time AS arrivalTime, duration_minutes AS durationMinutes,
      travel_to_next_minutes AS travelToNextMinutes, estimated_cost_per_head AS estimatedCostPerHead, note,
      travel_to_next_cost AS travelToNextCost, image_url AS imageUrl, link
     FROM plan_slots
     WHERE plan_id IN (${planIds.map(() => "?").join(", ")})
     ORDER BY slot_order`
  ).bind(...planIds).all();
  const slots = slotsRes.results || [];
  const slotsMap = slots.reduce((acc, slot) => {
    if (!acc[slot.planId]) acc[slot.planId] = [];
    acc[slot.planId].push(slot);
    return acc;
  }, {});
  const travelsRes = await env.DB.prepare(
    `SELECT 
      id, plan_id AS planId, user_id AS userId, train_time AS trainTime,
      train_cost AS trainCost, cab_time AS cabTime, cab_cost AS cabCost, walk_time AS walkTime,
      auto_time AS autoTime, auto_cost AS autoCost, total_time AS totalTime, total_cost AS totalCost,
      created_at AS createdAt
     FROM member_travel_metrics
     WHERE plan_id IN (${planIds.map(() => "?").join(", ")})`
  ).bind(...planIds).all();
  const travels = travelsRes.results || [];
  const travelsMap = travels.reduce((acc, t) => {
    if (!acc[t.planId]) acc[t.planId] = [];
    acc[t.planId].push(t);
    return acc;
  }, {});
  const data = groupPlans.map((p) => {
    let parsedWhyRecommended = [];
    if (p.whyRecommended) {
      try {
        parsedWhyRecommended = typeof p.whyRecommended === "string" ? JSON.parse(p.whyRecommended) : p.whyRecommended;
      } catch (e) {
        parsedWhyRecommended = [];
      }
    }
    return {
      ...p,
      whyRecommended: parsedWhyRecommended,
      slots: slotsMap[p.id] || [],
      memberTravelMetrics: travelsMap[p.id] || []
    };
  });
  const uniqueVenueIds = Array.from(new Set(slots.map((s) => s.venueId).filter((id) => id && !id.startsWith("fallback_"))));
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
      console.error("Failed to batch update times_viewed metrics:", err);
    }
  }
  return json({ success: true, data }, { headers: corsHeaders(env) });
}
__name(getPlans, "getPlans");
async function castVote(request, env, groupId) {
  const body = await readJson(request);
  const user = await findUserByClerkId(env.DB, body.clerkId);
  if (!user) {
    return json({ success: false, error: { code: "NOT_FOUND", message: "User not found." } }, { status: 404, headers: corsHeaders(env) });
  }
  const member = await env.DB.prepare(`SELECT role FROM group_members WHERE group_id = ? AND user_id = ?`).bind(groupId, user.id).first();
  if (!member) {
    return json({ success: false, error: { code: "FORBIDDEN", message: "Not group member." } }, { status: 403, headers: corsHeaders(env) });
  }
  const group = await getGroupById(env.DB, groupId);
  if (!group || group.status !== "VOTING" || group.votingStatus !== "OPEN") {
    return json({ success: false, error: { code: "VOTE_CLOSED", message: "Voting is closed." } }, { status: 400, headers: corsHeaders(env) });
  }
  const voteId = uuid();
  const now = (/* @__PURE__ */ new Date()).toISOString();
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
  try {
    const slotsRes = await env.DB.prepare(`SELECT venue_id FROM plan_slots WHERE plan_id = ?`).bind(body.planId).all();
    const voteVenueIds = (slotsRes.results || []).map((s) => s.venue_id).filter((id) => id && !id.startsWith("fallback_"));
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
    console.error("Failed to update times_voted metrics:", err);
  }
  return json({ success: true, data: vote }, { headers: corsHeaders(env) });
}
__name(castVote, "castVote");
async function tallyVotes(request, env, groupId) {
  const tallies = await env.DB.prepare(
    `SELECT plan_id AS planId, COUNT(id) AS count
     FROM votes
     WHERE group_id = ?
     GROUP BY plan_id`
  ).bind(groupId).all();
  return json({ success: true, data: tallies.results || [] }, { headers: corsHeaders(env) });
}
__name(tallyVotes, "tallyVotes");
async function getUserVote(request, env, groupId) {
  const url = new URL(request.url);
  const clerkId = url.searchParams.get("clerkId");
  if (!clerkId) {
    return json({ success: false, error: { code: "VALIDATION_ERROR", message: "Missing clerkId." } }, { status: 422, headers: corsHeaders(env) });
  }
  const user = await findUserByClerkId(env.DB, clerkId);
  if (!user) {
    return json({ success: false, error: { code: "NOT_FOUND", message: "User not found." } }, { status: 404, headers: corsHeaders(env) });
  }
  const vote = await env.DB.prepare(
    `SELECT plan_id AS planId FROM votes WHERE group_id = ? AND user_id = ?`
  ).bind(groupId, user.id).first();
  return json({ success: true, data: vote ? vote.planId : null }, { headers: corsHeaders(env) });
}
__name(getUserVote, "getUserVote");
async function closeVoting(request, env, groupId) {
  const body = await readJson(request);
  const user = await findUserByClerkId(env.DB, body.clerkId);
  if (!user) {
    return json({ success: false, error: { code: "NOT_FOUND", message: "User not found." } }, { status: 404, headers: corsHeaders(env) });
  }
  const member = await env.DB.prepare(`SELECT role FROM group_members WHERE group_id = ? AND user_id = ?`).bind(groupId, user.id).first();
  if (!member || member.role !== "ADMIN") {
    return json({ success: false, error: { code: "FORBIDDEN", message: "Only admin can close voting." } }, { status: 403, headers: corsHeaders(env) });
  }
  const historyId = uuid();
  const now = (/* @__PURE__ */ new Date()).toISOString();
  let winnerVenueIds = [];
  try {
    const winnerSlotsRes = await env.DB.prepare(`SELECT venue_id FROM plan_slots WHERE plan_id = ?`).bind(body.winnerPlanId).all();
    winnerVenueIds = (winnerSlotsRes.results || []).map((s) => s.venue_id).filter((id) => id && !id.startsWith("fallback_"));
  } catch (err) {
    console.error("Failed to query winning plan slots:", err);
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
      historyId,
      groupId,
      body.winnerPlanId,
      body.outingDate,
      body.groupName,
      body.planName,
      body.planTagline,
      body.venuesJson,
      body.participantsJson,
      body.totalCostPerHead,
      body.winningCategories || null,
      body.winningBudgetTier || null,
      body.winningActivities || null,
      now
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
__name(closeVoting, "closeVoting");
var DISCOVERY_ZONES = [
  { name: "Andheri", lat: 19.1136, lng: 72.8697, radius: 4e3 },
  { name: "Bandra", lat: 19.0596, lng: 72.8295, radius: 3e3 },
  { name: "Borivali", lat: 19.229, lng: 72.857, radius: 4e3 },
  { name: "Dadar", lat: 19.0178, lng: 72.8478, radius: 2500 },
  { name: "Kurla", lat: 19.0607, lng: 72.8826, radius: 3e3 },
  { name: "Ghatkopar", lat: 19.086, lng: 72.9082, radius: 3e3 },
  { name: "Powai", lat: 19.1176, lng: 72.906, radius: 3e3 },
  { name: "Lower Parel", lat: 19.0034, lng: 72.8276, radius: 2e3 },
  { name: "Worli", lat: 19.0176, lng: 72.8179, radius: 2500 },
  { name: "Thane", lat: 19.2183, lng: 72.9781, radius: 5e3 },
  { name: "Vashi", lat: 19.0745, lng: 72.9978, radius: 3500 },
  { name: "Belapur", lat: 19.018, lng: 73.0392, radius: 3500 },
  { name: "Nerul", lat: 19.033, lng: 73.018, radius: 2500 },
  { name: "Seawoods", lat: 19.0212, lng: 73.0192, radius: 2500 },
  { name: "Kharghar", lat: 19.0222, lng: 73.0644, radius: 3e3 },
  { name: "Panvel", lat: 18.9894, lng: 73.1175, radius: 4e3 }
];
var CONVERSATION_SCORES_WORKER = {
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
  SPORTS: 3,
  MALL: 3
};
function parseEventLocation(text) {
  const t = text.toLowerCase();
  if (t.includes("bandra")) return { lat: 19.0596, lng: 72.8295 };
  if (t.includes("andheri")) return { lat: 19.1136, lng: 72.8697 };
  if (t.includes("lower parel") || t.includes("parel")) return { lat: 19.0034, lng: 72.8276 };
  if (t.includes("worli")) return { lat: 19.0176, lng: 72.8179 };
  if (t.includes("juhu")) return { lat: 19.1075, lng: 72.8263 };
  if (t.includes("powai")) return { lat: 19.1176, lng: 72.906 };
  if (t.includes("borivali")) return { lat: 19.229, lng: 72.857 };
  if (t.includes("vashi")) return { lat: 19.0745, lng: 72.9978 };
  if (t.includes("belapur")) return { lat: 19.018, lng: 73.0392 };
  if (t.includes("thane")) return { lat: 19.2183, lng: 72.9781 };
  if (t.includes("dadar")) return { lat: 19.0178, lng: 72.8478 };
  return { lat: 19.0178, lng: 72.8478 };
}
__name(parseEventLocation, "parseEventLocation");
async function discoverZonePlaces(db, zoneName, lat, lng, radius, apiKey) {
  const categoriesToSearch = [
    { type: "cafe", cat: "CAFE" },
    { type: "restaurant", cat: "RESTAURANT" },
    { type: "amusement_park", cat: "ARCADE" },
    { type: "bowling_alley", cat: "BOWLING" },
    { type: "museum", cat: "MUSEUM" },
    { type: "shopping_mall", cat: "MALL" },
    { type: "park", cat: "PARK" }
  ];
  let discoveredCount = 0;
  const seenPlaceIds = /* @__PURE__ */ new Set();
  for (const { type, cat } of categoriesToSearch) {
    const url = `https://api.olamaps.io/places/v1/nearbysearch?layers=venue&types=${type}&location=${lat},${lng}&radius=${radius}&api_key=${apiKey}`;
    try {
      const res = await fetch(url, {
        headers: {
          "X-Request-Id": `hangoutt-discover-${Date.now()}`,
          "Referer": "http://localhost:3000",
          "Origin": "http://localhost:3000"
        }
      });
      if (!res.ok) continue;
      const data = await res.json();
      const results = data?.predictions || data?.results || [];
      for (const item of results.slice(0, 10)) {
        const placeId = item.place_id;
        if (!placeId || seenPlaceIds.has(placeId)) continue;
        seenPlaceIds.add(placeId);
        const detailsUrl = `https://api.olamaps.io/places/v1/details?place_id=${encodeURIComponent(placeId)}&api_key=${apiKey}`;
        const detailsRes = await fetch(detailsUrl, {
          headers: {
            "X-Request-Id": `hangoutt-details-${Date.now()}`,
            "Referer": "http://localhost:3000",
            "Origin": "http://localhost:3000"
          }
        });
        if (!detailsRes.ok) continue;
        const detailsData = await detailsRes.json();
        const result = detailsData?.result;
        if (!result) continue;
        const name = result.name || item.description || "Unknown Place";
        const address = result.formatted_address || result.vicinity || "";
        const placeLat = result.geometry?.location?.lat;
        const placeLng = result.geometry?.location?.lng;
        if (!placeLat || !placeLng) continue;
        const rating = result.rating || 0;
        const reviewCount = result.user_ratings_total || 0;
        const id = `OLA_${placeId}`;
        const businessStatus = (result.business_status || "").toUpperCase();
        if (businessStatus.includes("CLOSED")) {
          await db.prepare(`UPDATE places SET is_hidden = 1 WHERE id = ?`).bind(id).run().catch(() => {
          });
          continue;
        }
        if (rating < 4 || reviewCount < 50) {
          continue;
        }
        const types = result.types || [];
        const nameLower = name.toLowerCase();
        const exclusions = [
          "anchor",
          "emcee",
          "dj ",
          " dj",
          "mc ",
          " mc",
          "show host",
          "event planner",
          "wedding planner",
          "decorator",
          "caterer",
          "catering",
          "photographer",
          "videographer",
          "academy",
          "classes",
          "consultant",
          "office",
          "service"
        ];
        if (types.includes("delivery") || types.includes("meal_delivery") || nameLower.includes("delivery only") || nameLower.includes("cloud kitchen") || nameLower.includes("takeaway only") || exclusions.some((exc) => nameLower.includes(exc))) {
          continue;
        }
        let mandatoryCost = 0;
        let optionalCostMin = 0;
        let optionalCostMax = 0;
        if (cat === "CAFE") {
          mandatoryCost = 0;
          optionalCostMin = 200;
          optionalCostMax = 600;
        } else if (cat === "RESTAURANT") {
          mandatoryCost = 0;
          optionalCostMin = 300;
          optionalCostMax = 1e3;
        } else if (cat === "BOWLING") {
          mandatoryCost = 350;
          optionalCostMin = 100;
          optionalCostMax = 400;
        } else if (cat === "ARCADE") {
          mandatoryCost = 300;
          optionalCostMin = 100;
          optionalCostMax = 500;
        } else if (cat === "MUSEUM") {
          mandatoryCost = 150;
          optionalCostMin = 0;
          optionalCostMax = 0;
        } else if (cat === "MALL") {
          mandatoryCost = 0;
          optionalCostMin = 100;
          optionalCostMax = 500;
        } else if (cat === "PARK") {
          mandatoryCost = 0;
          optionalCostMin = 0;
          optionalCostMax = 0;
        }
        const now = (/* @__PURE__ */ new Date()).toISOString();
        let firstSeen = now;
        try {
          const existing = await db.prepare(`SELECT first_seen FROM places WHERE id = ?`).bind(id).first();
          if (existing?.first_seen) {
            firstSeen = existing.first_seen;
          }
        } catch (err) {
        }
        await db.prepare(
          `INSERT OR REPLACE INTO places (id, name, address, lat, lng, rating, review_count, source_name, source_place_id, last_verified, verified_at, first_seen, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'OLA', ?, ?, ?, ?, ?, ?)`
        ).bind(id, name, address, placeLat, placeLng, rating, reviewCount, placeId, now, now, firstSeen, now, now).run();
        const catId1 = crypto.randomUUID();
        await db.prepare(
          `INSERT OR IGNORE INTO place_categories (id, place_id, category) VALUES (?, ?, ?)`
        ).bind(catId1, id, cat).run();
        let experienceType = "OPTIONAL_STOP";
        if (["BOWLING", "ARCADE", "MUSEUM", "POTTERY"].includes(cat)) {
          experienceType = "PRIMARY_EXPERIENCE";
        } else if (["CAFE", "RESTAURANT", "DESSERT"].includes(cat)) {
          experienceType = "FOOD_STOP";
        }
        const catId2 = crypto.randomUUID();
        await db.prepare(
          `INSERT OR IGNORE INTO place_categories (id, place_id, category) VALUES (?, ?, ?)`
        ).bind(catId2, id, experienceType).run();
        await db.prepare(
          `INSERT OR REPLACE INTO place_costs (place_id, mandatory_cost, optional_cost_min, optional_cost_max)
           VALUES (?, ?, ?, ?)`
        ).bind(id, mandatoryCost, optionalCostMin, optionalCostMax).run();
        const popularity = rating / 5;
        const budgetFriendliness = Math.max(0, Math.min(1, 1 - mandatoryCost / 1500));
        const conversationScoreVal = (CONVERSATION_SCORES_WORKER[cat] || 5) / 10;
        const groupSuitability = ["CAFE", "RESTAURANT", "BOWLING", "ARCADE"].includes(cat) ? 0.8 : 0.5;
        const dateSuitability = ["CAFE", "PARK", "RESTAURANT"].includes(cat) ? 0.9 : 0.5;
        const friendsSuitability = ["BOWLING", "ARCADE", "CAFE"].includes(cat) ? 0.9 : 0.5;
        const familySuitability = ["MUSEUM", "PARK", "RESTAURANT"].includes(cat) ? 0.9 : 0.5;
        const weatherSuitability = ["PARK"].includes(cat) ? 0.6 : 1;
        const uniqueness = ["MUSEUM"].includes(cat) ? 0.8 : 0.5;
        const experienceScore = 0.8;
        const overall = (popularity + conversationScoreVal + experienceScore) / 3;
        await db.prepare(
          `INSERT OR REPLACE INTO place_scores (
            place_id, popularity, budget_friendliness, conversation, group_suitability,
            date_suitability, friends_suitability, family_suitability, weather_suitability,
            uniqueness, experience_score, overall
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          id,
          popularity,
          budgetFriendliness,
          conversationScoreVal,
          groupSuitability,
          dateSuitability,
          friendsSuitability,
          familySuitability,
          weatherSuitability,
          uniqueness,
          experienceScore,
          overall
        ).run();
        discoveredCount++;
      }
    } catch (err) {
      console.error(`Error discovering ${type} in ${zoneName}:`, err);
    }
  }
  return discoveredCount;
}
__name(discoverZonePlaces, "discoverZonePlaces");
function simpleHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
}
__name(simpleHash, "simpleHash");
async function rebuildFeaturedExperiences(db) {
  console.log("Rebuilding featured experiences (top 50 active events)...");
  await db.prepare(`DELETE FROM featured_experiences`).run();
  const topEvents = await db.prepare(
    `SELECT id, trending_score 
     FROM experiences 
     WHERE is_active = 1 
     ORDER BY trending_score DESC 
     LIMIT 50`
  ).all();
  const results = topEvents.results || [];
  console.log(`Found ${results.length} active events to feature.`);
  for (const event of results) {
    const featId = crypto.randomUUID();
    const now = (/* @__PURE__ */ new Date()).toISOString();
    await db.prepare(
      `INSERT INTO featured_experiences (id, experience_id, score, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`
    ).bind(featId, event.id, event.trending_score, now, now).run();
  }
  console.log("Featured experiences rebuilt.");
}
__name(rebuildFeaturedExperiences, "rebuildFeaturedExperiences");
async function discoverExperiences(db, tavilyApiKey) {
  await db.prepare(`INSERT OR IGNORE INTO experience_sources (id, name, reliability_weight) VALUES ('BOOKMYSHOW', 'BookMyShow', 1.0)`).run();
  await db.prepare(`INSERT OR IGNORE INTO experience_sources (id, name, reliability_weight) VALUES ('TAVILY', 'Tavily Search', 1.0)`).run();
  const categories = ["CONCERT", "WORKSHOP", "POTTERY", "PAINTING", "COMIC_CON", "ANIME_EVENT", "STANDUP_COMEDY", "ART_EXHIBITION"];
  for (const cat of categories) {
    await db.prepare(`INSERT OR IGNORE INTO experience_categories (id, name) VALUES (?, ?)`).bind(cat, cat).run();
  }
  const mockEvents = [
    {
      title: "Sanjay's Clay Pottery Masterclass",
      description: "Learn traditional clay wheel pottery from master artisan Sanjay in a cozy Bandra studio.",
      category: "POTTERY",
      city: "Mumbai",
      lat: 19.05,
      lng: 72.83,
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
  const nowTime = (/* @__PURE__ */ new Date()).toISOString();
  const nextMonthTime = new Date(Date.now() + 30 * 24 * 60 * 60 * 1e3).toISOString();
  for (const event of mockEvents) {
    const id = "exp_" + simpleHash(event.url);
    let firstSeen = nowTime;
    try {
      const existing = await db.prepare(`SELECT first_seen FROM experiences WHERE id = ?`).bind(id).first();
      if (existing?.first_seen) {
        firstSeen = existing.first_seen;
      }
    } catch (err) {
    }
    const daysSinceDiscovery = Math.max(0, (Date.now() - new Date(firstSeen).getTime()) / (1e3 * 60 * 60 * 24));
    const freshness = Math.exp(-daysSinceDiscovery / 14);
    const rating = 4.5;
    const popularity = 0.8;
    const trendingScore = 100 * freshness * popularity;
    await db.prepare(
      `INSERT OR REPLACE INTO experiences (
        id, title, description, category, city, latitude, longitude,
        start_date, end_date, ticket_price, source, source_url, image_url,
        rating, popularity_score, is_recurring, is_active, trending_score, first_seen, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'BOOKMYSHOW', ?, ?, ?, ?, 1, 1, ?, ?, ?, ?)`
    ).bind(
      id,
      event.title,
      event.description,
      event.category,
      event.city,
      event.lat,
      event.lng,
      nowTime,
      nextMonthTime,
      event.price,
      event.url,
      event.imageUrl,
      rating,
      popularity,
      trendingScore,
      firstSeen,
      nowTime,
      nowTime
    ).run();
    added++;
  }
  if (tavilyApiKey) {
    console.log("Tavily Search API key detected. Fetching live experiences...");
    const searchQueries = [
      { query: "upcoming workshops in Mumbai", cat: "WORKSHOP" },
      { query: "upcoming pottery classes in Mumbai", cat: "POTTERY" },
      { query: "upcoming painting classes in Mumbai", cat: "PAINTING" },
      { query: "upcoming comic cons in Mumbai", cat: "COMIC_CON" },
      { query: "upcoming anime events in Mumbai", cat: "ANIME_EVENT" },
      { query: "upcoming standup comedy shows in Mumbai", cat: "STANDUP_COMEDY" },
      { query: "upcoming art exhibitions in Mumbai", cat: "ART_EXHIBITION" },
      { query: "upcoming concerts in Mumbai", cat: "CONCERT" }
    ];
    for (const item of searchQueries) {
      try {
        const response = await fetch("https://api.tavily.com/search", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            api_key: tavilyApiKey,
            query: item.query,
            search_depth: "advanced",
            max_results: 5
          })
        });
        if (response.ok) {
          const searchData = await response.json();
          const results = searchData?.results || [];
          for (const res of results) {
            const title = res.title || "Special Mumbai Event";
            const description = res.content || "Enjoy an exciting event in Mumbai.";
            const url = res.url || "https://www.google.com/search?q=" + encodeURIComponent(title);
            const { lat, lng } = parseEventLocation(title + " " + description);
            const id = "exp_" + simpleHash(url);
            let firstSeen = nowTime;
            try {
              const existing = await db.prepare(`SELECT first_seen FROM experiences WHERE id = ?`).bind(id).first();
              if (existing?.first_seen) {
                firstSeen = existing.first_seen;
              }
            } catch (err) {
            }
            const daysSinceDiscovery = Math.max(0, (Date.now() - new Date(firstSeen).getTime()) / (1e3 * 60 * 60 * 24));
            const freshness = Math.exp(-daysSinceDiscovery / 14);
            const rating = 4.5;
            const popularity = 0.8;
            const trendingScore = 100 * freshness * popularity;
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
              id,
              title,
              description,
              item.cat,
              lat,
              lng,
              nowTime,
              nextMonthTime,
              price,
              url,
              "https://images.unsplash.com/photo-1543157145-f78c636d023d?w=500",
              rating,
              popularity,
              trendingScore,
              firstSeen,
              nowTime,
              nowTime
            ).run();
            added++;
          }
        }
      } catch (err) {
        console.error(`Error searching Tavily for ${item.query}:`, err);
      }
    }
  }
  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1e3).toISOString();
    await db.prepare(`UPDATE experiences SET is_active = 0 WHERE is_active = 1 AND updated_at < ?`).bind(thirtyDaysAgo).run();
    const todayStr = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
    await db.prepare(`UPDATE experiences SET is_active = 0 WHERE is_active = 1 AND end_date < ?`).bind(todayStr).run();
  } catch (err) {
    console.error("Error inactivating events:", err);
  }
  try {
    await rebuildFeaturedExperiences(db);
  } catch (err) {
    console.error("Error rebuilding featured experiences:", err);
  }
  return added;
}
__name(discoverExperiences, "discoverExperiences");
async function handleAdminDiscoverZone(request, env) {
  const body = await readJson(request);
  const zoneName = body.zoneName;
  if (!zoneName) {
    return json({ success: false, error: { message: "Missing zoneName" } }, { status: 400, headers: corsHeaders(env) });
  }
  const zone = DISCOVERY_ZONES.find((z) => z.name.toLowerCase() === zoneName.toLowerCase());
  if (!zone) {
    return json({ success: false, error: { message: `Zone ${zoneName} not supported` } }, { status: 400, headers: corsHeaders(env) });
  }
  const apiKey = env.OLA_MAPS_API_KEY || "";
  if (!apiKey) {
    return json({ success: false, error: { message: "OLA_MAPS_API_KEY not configured on worker" } }, { status: 500, headers: corsHeaders(env) });
  }
  const count = await discoverZonePlaces(env.DB, zone.name, zone.lat, zone.lng, zone.radius, apiKey);
  return json({ success: true, count }, { headers: corsHeaders(env) });
}
__name(handleAdminDiscoverZone, "handleAdminDiscoverZone");
async function handleAdminDiscoverExperiences(request, env) {
  const count = await discoverExperiences(env.DB, env.OLA_MAPS_API_KEY ? env.OLA_MAPS_API_KEY : void 0);
  return json({ success: true, count }, { headers: corsHeaders(env) });
}
__name(handleAdminDiscoverExperiences, "handleAdminDiscoverExperiences");
async function handleAdminCuratePlace(request, env, placeId) {
  const body = await readJson(request);
  const existing = await env.DB.prepare(`SELECT id FROM places WHERE id = ?`).bind(placeId).first();
  if (!existing) {
    return json({ success: false, error: { message: "Place not found" } }, { status: 404, headers: corsHeaders(env) });
  }
  const isFeaturedVal = body.isFeatured === true || body.isFeatured === 1 ? 1 : 0;
  const isHiddenVal = body.isHidden === true || body.isHidden === 1 ? 1 : 0;
  const boostFactorVal = typeof body.boostFactor === "number" ? body.boostFactor : 1;
  await env.DB.prepare(
    `UPDATE places
     SET is_featured = ?, is_hidden = ?, boost_factor = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).bind(isFeaturedVal, isHiddenVal, boostFactorVal, placeId).run();
  return json({ success: true }, { headers: corsHeaders(env) });
}
__name(handleAdminCuratePlace, "handleAdminCuratePlace");
async function getAdminPlacesWorker(request, env) {
  let zonesList = [];
  try {
    const zonesResult = await env.DB.prepare(`SELECT name, center_lat AS centerLat, center_lng AS centerLng FROM zones`).all();
    zonesList = zonesResult.results || [];
  } catch (err) {
    console.error("Error fetching zones in worker:", err);
  }
  function getDistance(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }
  __name(getDistance, "getDistance");
  const query = `
    SELECT 
      p.id, p.name, p.address, p.lat, p.lng, p.rating, p.review_count AS reviewCount, 
      p.is_featured AS isFeatured, p.is_hidden AS isHidden, p.boost_factor AS boostFactor,
      c.mandatory_cost AS mandatoryCost, c.optional_cost_min AS optionalCostMin, c.optional_cost_max AS optionalCostMax,
      s.popularity, s.budget_friendliness AS budgetFriendliness, s.overall,
      (SELECT group_concat(cat.category, ', ') FROM place_categories cat WHERE cat.place_id = p.id) AS categories
    FROM places p
    LEFT JOIN place_costs c ON c.place_id = p.id
    LEFT JOIN place_scores s ON s.place_id = p.id
    ORDER BY p.name ASC
  `;
  const result = await env.DB.prepare(query).all();
  const data = (result.results || []).map((r) => {
    let zoneName = "Mumbai";
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
      boostFactor: typeof r.boostFactor === "number" ? r.boostFactor : 1
    };
  });
  return json({ success: true, data }, { headers: corsHeaders(env) });
}
__name(getAdminPlacesWorker, "getAdminPlacesWorker");
async function handleAddPlace(request, env) {
  const body = await readJson(request);
  const placeId = body.id || uuid();
  const name = body.name || "Unknown Place";
  const address = body.address || "";
  const lat = Number(body.lat || 0);
  const lng = Number(body.lng || 0);
  const rating = Number(body.rating || 0);
  const reviewCount = Number(body.reviewCount || 0);
  const isFeaturedVal = body.isFeatured === true || body.isFeatured === 1 ? 1 : 0;
  const isHiddenVal = body.isHidden === true || body.isHidden === 1 ? 1 : 0;
  const boostFactorVal = typeof body.boostFactor === "number" ? body.boostFactor : 1;
  const now = (/* @__PURE__ */ new Date()).toISOString();
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
      placeId,
      popularity,
      budgetFriendliness,
      conversation,
      groupSuitability,
      dateSuitability,
      friendsSuitability,
      familySuitability,
      weatherSuitability,
      uniqueness,
      experienceScore,
      overall
    )
  ];
  const categories = Array.isArray(body.categories) ? body.categories : typeof body.categories === "string" ? body.categories.split(",").map((c) => c.trim()) : [];
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
__name(handleAddPlace, "handleAddPlace");
async function handleUpdatePlace(request, env, placeId) {
  const body = await readJson(request);
  const existing = await env.DB.prepare(`SELECT id FROM places WHERE id = ?`).bind(placeId).first();
  if (!existing) {
    return json({ success: false, error: { message: "Place not found" } }, { status: 404, headers: corsHeaders(env) });
  }
  const name = body.name;
  const address = body.address;
  const lat = body.lat !== void 0 ? Number(body.lat) : void 0;
  const lng = body.lng !== void 0 ? Number(body.lng) : void 0;
  const rating = body.rating !== void 0 ? Number(body.rating) : void 0;
  const reviewCount = body.reviewCount !== void 0 ? Number(body.reviewCount) : void 0;
  const isFeaturedVal = body.isFeatured !== void 0 ? body.isFeatured === true || body.isFeatured === 1 ? 1 : 0 : void 0;
  const isHiddenVal = body.isHidden !== void 0 ? body.isHidden === true || body.isHidden === 1 ? 1 : 0 : void 0;
  const boostFactorVal = body.boostFactor !== void 0 ? Number(body.boostFactor) : void 0;
  const mandatoryCost = body.mandatoryCost !== void 0 ? Number(body.mandatoryCost) : void 0;
  const optionalCostMin = body.optionalCostMin !== void 0 ? Number(body.optionalCostMin) : void 0;
  const optionalCostMax = body.optionalCostMax !== void 0 ? Number(body.optionalCostMax) : void 0;
  const popularity = body.popularity !== void 0 ? Number(body.popularity) : void 0;
  const budgetFriendliness = body.budgetFriendliness !== void 0 ? Number(body.budgetFriendliness) : void 0;
  const conversation = body.conversation !== void 0 ? Number(body.conversation) : void 0;
  const groupSuitability = body.groupSuitability !== void 0 ? Number(body.groupSuitability) : void 0;
  const dateSuitability = body.dateSuitability !== void 0 ? Number(body.dateSuitability) : void 0;
  const friendsSuitability = body.friendsSuitability !== void 0 ? Number(body.friendsSuitability) : void 0;
  const familySuitability = body.familySuitability !== void 0 ? Number(body.familySuitability) : void 0;
  const weatherSuitability = body.weatherSuitability !== void 0 ? Number(body.weatherSuitability) : void 0;
  const uniqueness = body.uniqueness !== void 0 ? Number(body.uniqueness) : void 0;
  const experienceScore = body.experienceScore !== void 0 ? Number(body.experienceScore) : void 0;
  const overall = body.overall !== void 0 ? Number(body.overall) : void 0;
  const statements = [];
  let placesUpdate = "UPDATE places SET updated_at = CURRENT_TIMESTAMP";
  const placesParams = [];
  if (name !== void 0) {
    placesUpdate += ", name = ?";
    placesParams.push(name);
  }
  if (address !== void 0) {
    placesUpdate += ", address = ?";
    placesParams.push(address);
  }
  if (lat !== void 0) {
    placesUpdate += ", lat = ?";
    placesParams.push(lat);
  }
  if (lng !== void 0) {
    placesUpdate += ", lng = ?";
    placesParams.push(lng);
  }
  if (rating !== void 0) {
    placesUpdate += ", rating = ?";
    placesParams.push(rating);
  }
  if (reviewCount !== void 0) {
    placesUpdate += ", review_count = ?";
    placesParams.push(reviewCount);
  }
  if (isFeaturedVal !== void 0) {
    placesUpdate += ", is_featured = ?";
    placesParams.push(isFeaturedVal);
  }
  if (isHiddenVal !== void 0) {
    placesUpdate += ", is_hidden = ?";
    placesParams.push(isHiddenVal);
  }
  if (boostFactorVal !== void 0) {
    placesUpdate += ", boost_factor = ?";
    placesParams.push(boostFactorVal);
  }
  placesUpdate += " WHERE id = ?";
  placesParams.push(placeId);
  statements.push(env.DB.prepare(placesUpdate).bind(...placesParams));
  let costsUpdate = "UPDATE place_costs SET place_id = place_id";
  const costsParams = [];
  if (mandatoryCost !== void 0) {
    costsUpdate += ", mandatory_cost = ?";
    costsParams.push(mandatoryCost);
  }
  if (optionalCostMin !== void 0) {
    costsUpdate += ", optional_cost_min = ?";
    costsParams.push(optionalCostMin);
  }
  if (optionalCostMax !== void 0) {
    costsUpdate += ", optional_cost_max = ?";
    costsParams.push(optionalCostMax);
  }
  costsUpdate += " WHERE place_id = ?";
  costsParams.push(placeId);
  statements.push(env.DB.prepare(costsUpdate).bind(...costsParams));
  let scoresUpdate = "UPDATE place_scores SET place_id = place_id";
  const scoresParams = [];
  if (popularity !== void 0) {
    scoresUpdate += ", popularity = ?";
    scoresParams.push(popularity);
  }
  if (budgetFriendliness !== void 0) {
    scoresUpdate += ", budget_friendliness = ?";
    scoresParams.push(budgetFriendliness);
  }
  if (conversation !== void 0) {
    scoresUpdate += ", conversation = ?";
    scoresParams.push(conversation);
  }
  if (groupSuitability !== void 0) {
    scoresUpdate += ", group_suitability = ?";
    scoresParams.push(groupSuitability);
  }
  if (dateSuitability !== void 0) {
    scoresUpdate += ", date_suitability = ?";
    scoresParams.push(dateSuitability);
  }
  if (friendsSuitability !== void 0) {
    scoresUpdate += ", friends_suitability = ?";
    scoresParams.push(friendsSuitability);
  }
  if (familySuitability !== void 0) {
    scoresUpdate += ", family_suitability = ?";
    scoresParams.push(familySuitability);
  }
  if (weatherSuitability !== void 0) {
    scoresUpdate += ", weather_suitability = ?";
    scoresParams.push(weatherSuitability);
  }
  if (uniqueness !== void 0) {
    scoresUpdate += ", uniqueness = ?";
    scoresParams.push(uniqueness);
  }
  if (experienceScore !== void 0) {
    scoresUpdate += ", experience_score = ?";
    scoresParams.push(experienceScore);
  }
  if (overall !== void 0) {
    scoresUpdate += ", overall = ?";
    scoresParams.push(overall);
  }
  scoresUpdate += " WHERE place_id = ?";
  scoresParams.push(placeId);
  statements.push(env.DB.prepare(scoresUpdate).bind(...scoresParams));
  if (body.categories !== void 0) {
    statements.push(env.DB.prepare(`DELETE FROM place_categories WHERE place_id = ?`).bind(placeId));
    const categories = Array.isArray(body.categories) ? body.categories : typeof body.categories === "string" ? body.categories.split(",").map((c) => c.trim()) : [];
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
__name(handleUpdatePlace, "handleUpdatePlace");
async function handleDeletePlace(request, env, placeId) {
  const existing = await env.DB.prepare(`SELECT id FROM places WHERE id = ?`).bind(placeId).first();
  if (!existing) {
    return json({ success: false, error: { message: "Place not found" } }, { status: 404, headers: corsHeaders(env) });
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
__name(handleDeletePlace, "handleDeletePlace");
async function health(env) {
  await env.DB.prepare(`SELECT id FROM users LIMIT 1`).first();
  return json({ ok: true, database: { reachable: true, driver: "d1-binding" } }, { headers: corsHeaders(env) });
}
__name(health, "health");
var api_default = {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders(env) });
    }
    const url = new URL(request.url);
    try {
      if (url.pathname === "/health/db" && request.method === "GET") {
        return health(env);
      }
      const unauthorized = await assertAuthorized(request, env);
      if (unauthorized) return unauthorized;
      if (url.pathname === "/api/admin/discover-zone" && request.method === "POST") return handleAdminDiscoverZone(request, env);
      if (url.pathname === "/api/admin/discover-experiences" && request.method === "POST") return handleAdminDiscoverExperiences(request, env);
      if (url.pathname === "/api/admin/places" && request.method === "GET") return getAdminPlacesWorker(request, env);
      if (url.pathname === "/api/admin/places" && request.method === "POST") return handleAddPlace(request, env);
      const curateMatch = url.pathname.match(/^\/api\/admin\/places\/([^/]+)\/curate$/);
      if (curateMatch && request.method === "PATCH") {
        const placeId = curateMatch[1];
        return handleAdminCuratePlace(request, env, placeId);
      }
      const placeMatch = url.pathname.match(/^\/api\/admin\/places\/([^/]+)$/);
      if (placeMatch) {
        const placeId = placeMatch[1];
        if (request.method === "PATCH") return handleUpdatePlace(request, env, placeId);
        if (request.method === "DELETE") return handleDeletePlace(request, env, placeId);
      }
      if (url.pathname === "/groups" && request.method === "POST") return createGroup(request, env);
      if (url.pathname === "/groups" && request.method === "GET") return listGroups(request, env);
      if (url.pathname === "/groups/join" && request.method === "POST") return joinGroup(request, env);
      if (url.pathname === "/users" && request.method === "GET") return getUser(request, env);
      if (url.pathname === "/users/profile" && request.method === "PATCH") return updateUserProfile(request, env);
      const groupMatch = url.pathname.match(/^\/groups\/([^/]+)(?:\/([^/]+))?$/);
      if (groupMatch) {
        const groupId = groupMatch[1];
        const action = groupMatch[2];
        if (!action && request.method === "GET") return getGroupDetails(request, env, groupId);
        if (action === "presence" && request.method === "PATCH") return updateMemberPresence(request, env, groupId);
        if (action === "start-details" && request.method === "PATCH") return startDetailsCollection(request, env, groupId);
        if (action === "budget" && request.method === "POST") return submitBudget(request, env, groupId);
        if (action === "location" && request.method === "POST") return submitLocation(request, env, groupId);
        if (action === "vibes" && request.method === "POST") return submitVibes(request, env, groupId);
        if (action === "plans" && request.method === "POST") return savePlans(request, env, groupId);
        if (action === "plans" && request.method === "GET") return getPlans(request, env, groupId);
        if (action === "vote" && request.method === "POST") return castVote(request, env, groupId);
        if (action === "votes" && request.method === "GET") return tallyVotes(request, env, groupId);
        if (action === "votes-user" && request.method === "GET") return getUserVote(request, env, groupId);
        if (action === "close-voting" && request.method === "PATCH") return closeVoting(request, env, groupId);
      }
      return json(
        { success: false, error: { code: "NOT_FOUND", message: "Route not found." } },
        { status: 404, headers: corsHeaders(env) }
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unexpected Worker error.";
      return json(
        { success: false, error: { code: "INTERNAL_ERROR", message } },
        { status: 500, headers: corsHeaders(env) }
      );
    }
  },
  async scheduled(event, env, ctx) {
    console.log(`Scheduled worker triggered with cron: ${event.cron}`);
    const apiKey = env.OLA_MAPS_API_KEY || "";
    if (!apiKey) {
      console.error("OLA_MAPS_API_KEY is not set. Scheduled run aborted.");
      return;
    }
    if (event.cron.includes("*/6") || event.cron.includes("place")) {
      const hour = (/* @__PURE__ */ new Date()).getHours();
      const index = Math.floor(hour / 6) % 4;
      const zonesToProcess = DISCOVERY_ZONES.slice(index * 4, (index + 1) * 4);
      for (const zone of zonesToProcess) {
        console.log(`Scheduled: Discovering places in zone ${zone.name}...`);
        await discoverZonePlaces(env.DB, zone.name, zone.lat, zone.lng, zone.radius, apiKey);
      }
    }
    if (event.cron.includes("*/12") || event.cron.includes("experience")) {
      console.log("Scheduled: Discovering experiences...");
      await discoverExperiences(env.DB);
    }
  }
};

// ../../../AppData/Roaming/npm/node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// ../../../AppData/Roaming/npm/node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    return Response.json(error, {
      status: 500,
      headers: { "MF-Experimental-Error-Stack": "true" }
    });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-uAwhid/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = api_default;

// ../../../AppData/Roaming/npm/node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-uAwhid/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=api.js.map
