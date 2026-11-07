import { createHmac, randomBytes } from "node:crypto";
import { createServerFn } from "@tanstack/react-start";
import { getCookie, setCookie, setResponseHeader } from "@tanstack/react-start/server";
import { getSql } from "@/lib/db";
import { authMiddleware } from "@/lib/auth/middleware";
import { nextResetIso, weekKey, weekStartMs } from "@/lib/week";

const GRANT = 50;
const LIVE_TAGS = ["#t3x", "#t3xdrop"];

type BoardRow = { handle: string; score: number; prize: string };
type DropRow = { tweetId: string; coins: number; claimed: boolean };

async function xAccount(userId: string) {
  const sql = await getSql();
  const rows = await sql<{ accountId: string }>`
    select "accountId" from "account" where "userId" = ${userId} and "providerId" = 'grok-x' limit 1
  `;
  return rows[0]?.accountId ?? null;
}

async function pulse() {
  const sql = await getSql();
  const rows = await sql<{ handle: string; score: number }>`
    select w.handle as handle, count(t.tag)::int as score
    from tag_hits t
    join wallets w on w.user_id = t.user_id
    where w.handle is not null
    group by w.handle
    order by score desc, w.handle asc
    limit 100
  `;
  return rows.map((row, index) => ({ ...row, prize: prizeFor(index + 1) }));
}

function prizeFor(rank: number) {
  if (rank === 1) return "$200 + T3X";
  if (rank === 2) return "$50 + T3X";
  if (rank === 3) return "$10 + T3X";
  if (rank <= 100) return "T3X";
  return "";
}

function tagsIn(text: string) {
  const lower = text.toLowerCase();
  return LIVE_TAGS.filter((tag) => lower.includes(tag));
}

async function recordTags(userId: string, tweetId: string, text: string) {
  const sql = await getSql();
  const found = tagsIn(text);
  const added: string[] = [];
  for (const tag of found) {
    const rows = await sql<{ tag: string }>`
      insert into tag_hits (user_id, tag, tweet_id)
      values (${userId}, ${tag}, ${tweetId})
      on conflict (user_id, tag) do nothing
      returning tag
    `;
    if (rows[0]) added.push(rows[0].tag);
  }
  return { found, added };
}

export const getPulse = createServerFn({ method: "GET" }).handler(async () => {
  const week = weekKey();
  return { week, resetAt: nextResetIso(), tags: LIVE_TAGS, board: await pulse() };
});

export const getMine = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    const week = weekKey();
    const xId = await xAccount(context.userId);
    await sql`insert into wallets (user_id) values (${context.userId}) on conflict (user_id) do nothing`;
    const wallet = await sql<{ handle: string | null; xId: string | null; balance: number; address: string | null }>`
      select handle, x_id as "xId", balance, address from wallets where user_id = ${context.userId}
    `;
    const known = Boolean(xId || wallet[0]?.xId);
    if (known) {
      const grantId = `grant:${week}:${context.userId}`;
      await sql`
        insert into drops (user_id, week_key, tweet_id, coins, claimed)
        values (${context.userId}, ${week}, ${grantId}, ${GRANT}, false)
        on conflict (tweet_id) do nothing
      `;
    }
    const drops = await sql<DropRow>`
      select tweet_id as "tweetId", coins, claimed
      from drops
      where user_id = ${context.userId} and week_key = ${week}
      order by id
    `;
    const waiting = drops.filter((row) => !row.claimed).reduce((sum, row) => sum + row.coins, 0);
    return {
      week,
      resetAt: nextResetIso(),
      needsX: !known,
      handle: wallet[0]?.handle ?? null,
      address: wallet[0]?.address ?? null,
      balance: wallet[0]?.balance ?? 0,
      waiting,
      drops,
      board: await pulse(),
    };
  });

export const startProof = createServerFn({ method: "POST" })
  .validator((handle: string) => handle.trim().replace(/^@/, ""))
  .handler(async ({ data: handle }) => {
    if (!/^[A-Za-z0-9_]{1,15}$/.test(handle)) return { ok: false as const, error: "That is not an X handle." };
    const profile = await loadUser(handle);
    if (!profile) return { ok: false as const, error: "X did not show that account." };
    const code = `T3X-${randomBytes(4).toString("hex").toUpperCase()}`;
    const sql = await getSql();
    await sql`insert into x_proofs (code, handle) values (${code}, ${profile.screen})`;
    setCookie("t3x_proof", code, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 60 * 30 });
    const text = `#T3X #T3XDrop`;
    return {
      ok: true as const,
      handle: profile.screen,
      text,
      intent: `https://x.com/intent/post?text=${encodeURIComponent(text)}`,
    };
  });

export const finishProof = createServerFn({ method: "POST" })
  .validator((url: string) => url.trim())
  .handler(async ({ data: url }) => {
    const code = getCookie("t3x_proof");
    if (!code) return { ok: false as const, error: "Enter your handle again, then paste the post." };
    const id = url.match(/status(?:es)?\/(\d+)/)?.[1];
    if (!id) return { ok: false as const, error: "Paste the link to the post." };
    const sql = await getSql();
    const proof = await sql<{ handle: string }>`select handle from x_proofs where code = ${code} limit 1`;
    if (!proof[0]) return { ok: false as const, error: "Enter your handle again, then paste the post." };
    const tweet = await loadTweet(id);
    if (!tweet) return { ok: false as const, error: "X did not return that post." };
    const profile = await loadUser(proof[0].handle);
    if (!profile || tweet.authorId !== profile.id) return { ok: false as const, error: "That post is not from the handle you entered." };
    const found = tagsIn(tweet.text);
    if (!found.length) {
      return { ok: false as const, error: `The post needs one of ${LIVE_TAGS.join(" ")}. New tags go out on games and posters. Stay tuned.` };
    }
    const signed = await openSession(profile.screen);
    if (!signed.ok) return signed;
    await sql`insert into wallets (user_id, handle, x_id) values (${signed.userId}, ${profile.screen}, ${profile.id})
      on conflict (user_id) do update set handle = ${profile.screen}, x_id = ${profile.id}`;
    const recorded = await recordTags(signed.userId, id, tweet.text);
    void recorded;
    await sql`delete from x_proofs where code = ${code}`;
    setCookie("t3x_proof", "", { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 0 });
    return { ok: true as const };
  });

async function openSession(handle: string): Promise<{ ok: true; userId: string } | { ok: false; error: string }> {
  const { auth } = await import("@/lib/auth/server");
  const email = `${handle.toLowerCase()}@x.t3x-airdrop.local`;
  const secret = process.env.BETTER_AUTH_SECRET || "t3x-preview-session";
  const password = createHmac("sha256", secret).update(`t3x:${handle.toLowerCase()}`).digest("hex");
  const headers = new Headers();
  const requestHeaders = (await import("@tanstack/react-start/server")).getRequestHeaders();
  requestHeaders.forEach((value, key) => headers.set(key, value));
  let response = await auth.api.signUpEmail({
    body: { email, password, name: handle },
    headers,
    asResponse: true,
  });
  if (!response.ok) {
    response = await auth.api.signInEmail({
      body: { email, password },
      headers,
      asResponse: true,
    });
  }
  const cookies = response.headers.getSetCookie();
  if (cookies.length) setResponseHeader("set-cookie", cookies);
  if (!response.ok) return { ok: false, error: "The session could not be opened. Try again." };
  const body = (await response.json().catch(() => null)) as { user?: { id?: string } } | null;
  const userId = body?.user?.id;
  if (!userId) return { ok: false, error: "Signed in, but the account id was missing." };
  return { ok: true, userId };
}

export const assignWallet = createServerFn({ method: "POST" })
  .validator((address: string) => address.trim())
  .middleware([authMiddleware])
  .handler(async ({ context, data: raw }) => {
    const address = cleanAddress(raw);
    if (!address) return { ok: false as const, error: "Paste a wallet address." };
    const sql = await getSql();
    const taken = await sql<{ user_id: string }>`
      select user_id from wallets where lower(address) = lower(${address}) and user_id <> ${context.userId} limit 1
    `;
    if (taken.length) return { ok: false as const, error: "That wallet is already assigned." };
    await sql`insert into wallets (user_id) values (${context.userId}) on conflict (user_id) do nothing`;
    await sql`update wallets set address = ${address} where user_id = ${context.userId}`;
    return { ok: true as const, address };
  });

export const bindHandle = createServerFn({ method: "POST" })
  .validator((handle: string) => handle.trim().replace(/^@/, ""))
  .middleware([authMiddleware])
  .handler(async ({ context, data: handle }) => {
    if (!/^[A-Za-z0-9_]{1,15}$/.test(handle)) return { ok: false as const, error: "That is not an X handle." };
    const loginId = await xAccount(context.userId);
    if (!loginId) return { ok: false as const, error: "Sign in with X first." };
    const profile = await loadUser(handle);
    if (!profile) return { ok: false as const, error: "X did not show that account." };
    if (/^\d+$/.test(loginId) && loginId !== profile.id) {
      return { ok: false as const, error: "That handle is not the X account you signed in with." };
    }
    const sql = await getSql();
    await sql`insert into wallets (user_id) values (${context.userId}) on conflict (user_id) do nothing`;
    const taken = await sql<{ user_id: string }>`
      select user_id from wallets where lower(handle) = lower(${handle}) and user_id <> ${context.userId} limit 1
    `;
    if (taken.length) return { ok: false as const, error: "That handle is already on the board." };
    await sql`
      update wallets set handle = ${profile.screen}, x_id = ${profile.id}
      where user_id = ${context.userId}
    `;
    return { ok: true as const, handle: profile.screen };
  });

export const checkPost = createServerFn({ method: "POST" })
  .validator((url: string) => url.trim())
  .middleware([authMiddleware])
  .handler(async ({ context, data: url }) => {
    const id = url.match(/status(?:es)?\/(\d+)/)?.[1];
    if (!id) return { ok: false as const, error: "Paste the link to the post." };
    const wallet = await (await getSql())<{ handle: string | null; xId: string | null }>`
      select handle, x_id as "xId" from wallets where user_id = ${context.userId}
    `;
    const mine = wallet[0];
    if (!mine?.handle || !mine.xId) return { ok: false as const, error: "Sign in with X first." };
    const tweet = await loadTweet(id);
    if (!tweet) return { ok: false as const, error: "X did not return that post." };
    if (tweet.authorId !== mine.xId) return { ok: false as const, error: "That post is not from your X account." };
    const found = tagsIn(tweet.text);
    if (!found.length) {
      return { ok: false as const, error: `The post needs one of ${LIVE_TAGS.join(" ")}. New tags go out on games and posters. Stay tuned.` };
    }
    const recorded = await recordTags(context.userId, id, tweet.text);
    if (!recorded.added.length) return { ok: false as const, error: "Those tags already count. The same tag is not counted again." };
    return { ok: true as const, added: recorded.added };
  });

export const claimCoins = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    const week = weekKey();
    const wallet = await sql<{ address: string | null; balance: number }>`
      select address, balance from wallets where user_id = ${context.userId}
    `;
    if (!wallet[0]?.address) return { gained: 0, balance: wallet[0]?.balance ?? 0, error: "Assign a wallet first." };
    const rows = await sql<{ coins: number }>`
      update drops set claimed = true
      where user_id = ${context.userId} and week_key = ${week} and claimed = false
      returning coins
    `;
    const gained = rows.reduce((sum, row) => sum + row.coins, 0);
    if (gained > 0) {
      await sql`update wallets set balance = balance + ${gained} where user_id = ${context.userId}`;
    }
    const balance = await sql<{ balance: number }>`select balance from wallets where user_id = ${context.userId}`;
    return { gained, balance: balance[0]?.balance ?? 0, error: "" };
  });

function cleanAddress(raw: string) {
  const address = raw.trim();
  if (/^0x[a-fA-F0-9]{40}$/.test(address)) return address;
  if (/^[1-9A-HJ-NP-Za-km-z]{32,64}$/.test(address)) return address;
  return null;
}

async function loadUser(handle: string): Promise<{ id: string; screen: string } | null> {
  const body = await readJson(`https://api.fxtwitter.com/${encodeURIComponent(handle)}`);
  const user = body?.user as { id?: string; screen_name?: string } | undefined;
  if (!user?.id || !user.screen_name) return null;
  return { id: String(user.id), screen: user.screen_name };
}

async function loadTweet(id: string): Promise<{ authorId: string; text: string; at: number } | null> {
  const body = await readJson(`https://api.fxtwitter.com/status/${id}`);
  const tweet = body?.tweet as {
    text?: string;
    created_timestamp?: number;
    author?: { id?: string };
    entities?: { hashtags?: { text?: string }[] };
  } | undefined;
  if (!tweet?.author?.id || !tweet.text || !tweet.created_timestamp) return null;
  const tags = (tweet.entities?.hashtags ?? [])
    .map((tag) => (tag.text ? `#${tag.text}` : ""))
    .filter(Boolean)
    .join(" ");
  return {
    authorId: String(tweet.author.id),
    text: `${tweet.text} ${tags}`,
    at: tweet.created_timestamp * 1000,
  };
}

async function readJson(url: string): Promise<Record<string, unknown> | null> {
  const response = await fetch(url, { headers: { accept: "application/json", "user-agent": "T3XAirdrop" } });
  if (!response.ok) return null;
  return (await response.json()) as Record<string, unknown>;
}
