import { neon } from '@neondatabase/serverless';
import { createHash } from 'crypto';
const sql = neon(process.env.DATABASE_URL);
let ready;
const init = () => (ready ||= (async () => {
  await sql`create table if not exists users(name text primary key, h text)`;
  await sql`create table if not exists checks(name text, day date, rd bool default false, pr bool default false, primary key(name,day))`;
  await sql`create table if not exists prayers(id serial primary key, name text, body text, anon bool, status text default 'pending')`;
})());
const clean = s => String(s || '').trim().replace(/\s+/g, ' ');
const norm = s => clean(s).toLowerCase().replace(/\b\w/g, c => c.toUpperCase()).slice(0, 60);
const hash = p => createHash('sha256').update('enough26' + p).digest('hex');
export default async function handler(req, res) {
  try {
    if (!process.env.DATABASE_URL) return res.status(500).json({ error: 'Database is not connected yet (DATABASE_URL missing).' });
    await init();
    const b = req.body || {}, name = norm(b.name), pin = String(b.pin || '');
    const adm = !!process.env.ADMIN_CODE && b.code === process.env.ADMIN_CODE;
    const role = adm ? 'admin' : (process.env.LEADER_CODE && b.code === process.env.LEADER_CODE ? 'leader' : null);
    if (b.a === 'role') return res.json({ role });
    if (b.a === 'board') return res.json({ rows: await sql`select name, to_char(day,'YYYY-MM-DD') as day, rd, pr from checks` });
    if (b.a === 'prayers') return res.json({ rows: await sql`select id, case when anon then 'Anonymous' else name end as who, body from prayers where status='approved' order by id desc` });
    if (b.a === 'admin') {
      if (!adm) return res.status(403).json({ error: 'Wrong admin code' });
      if (b.op === 'approve') await sql`update prayers set status='approved' where id=${+b.id}`;
      if (b.op === 'delete') await sql`delete from prayers where id=${+b.id}`;
      if (b.op === 'reset') await sql`delete from users where name=${norm(b.target)}`;
      return res.json({ rows: await sql`select id, name, anon, body from prayers where status='pending' order by id` });
    }
    if (['login', 'join', 'checkin', 'pray'].includes(b.a)) {
      if (!name.includes(' ') || !/^\d{4}$/.test(pin)) return res.status(401).json({ error: 'Enter first and last name and a 4-digit PIN.' });
      const [u] = await sql`select h from users where name=${name}`;
      if (!u) {
        if (b.a !== 'login') return res.status(401).json({ error: 'Please sign in again.' });
        await sql`insert into users(name,h) values(${name},${hash(pin)})`;
      } else if (u.h !== hash(pin)) return res.status(401).json({ error: 'That name already has a different PIN. Check your PIN, or ask your leader to reset it.' });
      if (b.a === 'login') return res.json({ ok: 1 });
      if (b.a === 'pray') {
        if (!clean(b.body)) return res.status(400).json({ error: 'Write something first.' });
        await sql`insert into prayers(name,body,anon) values(${name},${clean(b.body).slice(0, 600)},${!!b.anon})`;
        return res.json({ ok: 1 });
      }
      if (!/^\d{4}-\d\d-\d\d$/.test(b.day) || b.day < '2026-11-22' || b.day > '2026-12-20') return res.status(400).json({ error: 'Bad day' });
      if (b.a === 'join') await sql`insert into checks(name,day,rd,pr) values(${name},${b.day},false,false) on conflict do nothing`;
      else await sql`insert into checks(name,day,rd,pr) values(${name},${b.day},${!!b.rd},${!!b.pr}) on conflict(name,day) do update set rd=${!!b.rd}, pr=${!!b.pr}`;
      return res.json({ ok: 1 });
    }
    res.status(400).json({ error: 'unknown' });
  } catch (e) { res.status(500).json({ error: String(e.message) }); }
}
