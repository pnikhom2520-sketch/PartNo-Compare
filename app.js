const { SUPABASE_URL, SUPABASE_ANON_KEY } = window.APP_CONFIG;
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const $ = (id) => document.getElementById(id);
let currentUser = null;
let pendingNg = null; // { a, b } รอกรอกสาเหตุ
let lastHistoryRows = [];

// ---------------------------------------------------------------- helpers
// Barcode scanner อาจส่งช่องว่าง/ตัวพิมพ์เล็กมา จึงตัดช่องว่างหัวท้ายและแปลงเป็นตัวพิมพ์ใหญ่ก่อนเทียบ
const normalize = (s) => s.trim().toUpperCase();

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

const fmtTime = (iso) => new Date(iso).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'medium' });

const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.toISOString(); };

let audioCtx;
function beep(ok) {
  try {
    audioCtx ??= new AudioContext();
    const pattern = ok ? [[1200, 0, 0.12]] : [[300, 0, 0.25], [300, 0.35, 0.25], [300, 0.7, 0.25]];
    for (const [freq, at, dur] of pattern) {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.frequency.value = freq;
      osc.type = ok ? 'sine' : 'square';
      gain.gain.value = 0.15;
      osc.connect(gain).connect(audioCtx.destination);
      const t = audioCtx.currentTime + at;
      osc.start(t);
      osc.stop(t + dur);
    }
  } catch { /* เสียงเป็นแค่ส่วนเสริม */ }
}

function setResult(cls, html) {
  const box = $('result-box');
  box.className = `result-box ${cls}`;
  box.innerHTML = html;
}

// ---------------------------------------------------------------- auth
async function renderAuth(session) {
  currentUser = session?.user ?? null;
  $('login-view').classList.toggle('hidden', !!currentUser);
  $('app-view').classList.toggle('hidden', !currentUser);
  if (currentUser) {
    $('user-email').textContent = currentUser.email;
    resetScan();
    refreshScanPanel();
  }
}

$('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('login-error').textContent = '';
  $('login-btn').disabled = true;
  const { error } = await sb.auth.signInWithPassword({
    email: $('login-email').value.trim(),
    password: $('login-password').value,
  });
  $('login-btn').disabled = false;
  if (error) $('login-error').textContent = 'เข้าสู่ระบบไม่สำเร็จ: ' + error.message;
  else $('login-password').value = '';
});

$('logout-btn').addEventListener('click', () => sb.auth.signOut());

sb.auth.onAuthStateChange((_event, session) => renderAuth(session));

// ---------------------------------------------------------------- tabs
document.querySelectorAll('.tab').forEach((btn) => btn.addEventListener('click', () => {
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b === btn));
  $('tab-scan').classList.toggle('hidden', btn.dataset.tab !== 'scan');
  $('tab-history').classList.toggle('hidden', btn.dataset.tab !== 'history');
  if (btn.dataset.tab === 'history') loadHistory();
  else $('scan-a').focus();
}));

// ---------------------------------------------------------------- scan flow
function resetScan() {
  $('scan-a').value = '';
  $('scan-b').value = '';
  $('scan-a').disabled = false;
  $('scan-b').disabled = true;
  setResult('idle', 'พร้อมสแกน');
  $('scan-a').focus();
}

$('reset-btn').addEventListener('click', resetScan);

$('scan-a').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  if (!normalize($('scan-a').value)) return;
  $('scan-b').disabled = false;
  $('scan-b').focus();
  setResult('idle', 'สแกนเอกสารชุดที่ 2');
});

$('scan-b').addEventListener('keydown', async (e) => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  const a = normalize($('scan-a').value);
  const b = normalize($('scan-b').value);
  if (!a) { $('scan-a').focus(); return; }
  if (!b) return;

  $('scan-a').disabled = true;
  $('scan-b').disabled = true;

  if (a === b) {
    setResult('saving', 'กำลังบันทึก...');
    const { error } = await saveLog({ part_no_a: a, part_no_b: b, result: 'OK' });
    if (error) {
      setResult('ng', 'บันทึกไม่สำเร็จ: ' + esc(error.message) + '<br><small>กด "ล้าง / สแกนใหม่" แล้วลองอีกครั้ง</small>');
      return;
    }
    beep(true);
    $('scan-a').value = '';
    $('scan-b').value = '';
    $('scan-a').disabled = false;
    $('scan-a').focus();
    setResult('ok', `OK — ตรงกัน<br><small>${esc(a)}</small>`);
    refreshScanPanel();
  } else {
    beep(false);
    setResult('ng', 'NG — ไม่ตรงกัน');
    openNgModal(a, b);
  }
});

// ---------------------------------------------------------------- NG modal
// NG ทุกครั้งต้องบันทึกพร้อมสาเหตุ จึงไม่มีปุ่มปิด modal โดยไม่บันทึก
function openNgModal(a, b) {
  pendingNg = { a, b };
  $('ng-a').textContent = a;
  $('ng-b').textContent = b;
  $('ng-category').value = '';
  $('ng-detail').value = '';
  $('ng-error').textContent = '';
  $('detail-req').classList.add('hidden');
  $('ng-modal').classList.remove('hidden');
  $('ng-category').focus();
}

$('ng-category').addEventListener('change', () => {
  $('detail-req').classList.toggle('hidden', $('ng-category').value !== 'อื่นๆ');
});

$('ng-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const category = $('ng-category').value;
  const detail = $('ng-detail').value.trim();
  if (!category) { $('ng-error').textContent = 'กรุณาเลือกสาเหตุ'; return; }
  if (category === 'อื่นๆ' && !detail) { $('ng-error').textContent = 'กรุณาระบุรายละเอียด'; return; }

  $('ng-save-btn').disabled = true;
  const { error } = await saveLog({
    part_no_a: pendingNg.a,
    part_no_b: pendingNg.b,
    result: 'NG',
    reason_category: category,
    reason_detail: detail || null,
  });
  $('ng-save-btn').disabled = false;
  if (error) { $('ng-error').textContent = 'บันทึกไม่สำเร็จ: ' + error.message; return; }

  $('ng-modal').classList.add('hidden');
  pendingNg = null;
  resetScan();
  setResult('ng', 'บันทึก NG แล้ว — พร้อมสแกนรายการถัดไป');
  refreshScanPanel();
});

// ---------------------------------------------------------------- data
function saveLog(row) {
  // user_id / user_email ถูกเติมโดย default ของฐานข้อมูลจาก session ที่ log in
  return sb.from('scan_logs').insert(row);
}

async function refreshScanPanel() {
  if (!currentUser) return;
  const since = startOfToday();
  const countQuery = (result) => sb.from('scan_logs')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', currentUser.id).eq('result', result).gte('created_at', since);

  const [ok, ng, recent] = await Promise.all([
    countQuery('OK'),
    countQuery('NG'),
    sb.from('scan_logs').select('*').eq('user_id', currentUser.id)
      .order('created_at', { ascending: false }).limit(10),
  ]);
  $('stat-ok').textContent = ok.count ?? '-';
  $('stat-ng').textContent = ng.count ?? '-';
  $('recent-body').innerHTML = (recent.data ?? []).map((r) => `
    <tr>
      <td>${fmtTime(r.created_at)}</td>
      <td class="mono">${esc(r.part_no_a)}</td>
      <td class="mono">${esc(r.part_no_b)}</td>
      <td><span class="badge ${r.result}">${r.result}</span></td>
      <td>${esc(r.reason_category)}</td>
    </tr>`).join('');
}

const HISTORY_LIMIT = 1000;

async function loadHistory() {
  $('history-info').textContent = 'กำลังโหลด...';
  let q = sb.from('scan_logs').select('*').order('created_at', { ascending: false }).limit(HISTORY_LIMIT);

  const from = $('f-from').value;
  const to = $('f-to').value;
  const result = $('f-result').value;
  // ตัดอักขระที่มีความหมายพิเศษในตัวกรอง or() ของ PostgREST ออก
  const search = $('f-search').value.trim().replace(/[,()%*]/g, '');

  if (from) q = q.gte('created_at', new Date(from + 'T00:00:00').toISOString());
  if (to) q = q.lte('created_at', new Date(to + 'T23:59:59.999').toISOString());
  if (result) q = q.eq('result', result);
  if (search) q = q.or(`part_no_a.ilike.*${search}*,part_no_b.ilike.*${search}*`);

  const { data, error } = await q;
  if (error) { $('history-info').textContent = 'โหลดข้อมูลไม่สำเร็จ: ' + error.message; return; }

  lastHistoryRows = data;
  const ngCount = data.filter((r) => r.result === 'NG').length;
  $('history-info').textContent =
    `พบ ${data.length} รายการ (OK ${data.length - ngCount} / NG ${ngCount})` +
    (data.length === HISTORY_LIMIT ? ` — แสดงสูงสุด ${HISTORY_LIMIT} รายการ กรุณากรองช่วงวันที่ให้แคบลง` : '');
  $('history-body').innerHTML = data.map((r) => `
    <tr>
      <td>${fmtTime(r.created_at)}</td>
      <td>${esc(r.user_email)}</td>
      <td class="mono">${esc(r.part_no_a)}</td>
      <td class="mono">${esc(r.part_no_b)}</td>
      <td><span class="badge ${r.result}">${r.result}</span></td>
      <td>${esc(r.reason_category)}</td>
      <td>${esc(r.reason_detail)}</td>
    </tr>`).join('');
}

$('filter-form').addEventListener('submit', (e) => { e.preventDefault(); loadHistory(); });

$('export-btn').addEventListener('click', () => {
  const header = ['เวลา', 'ผู้สแกน', 'Part No. ชุดที่ 1', 'Part No. ชุดที่ 2', 'ผล', 'สาเหตุ', 'รายละเอียด'];
  const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [header, ...lastHistoryRows.map((r) => [
    fmtTime(r.created_at), r.user_email, r.part_no_a, r.part_no_b, r.result, r.reason_category, r.reason_detail,
  ])].map((row) => row.map(cell).join(','));
  // ใส่ BOM เพื่อให้ Excel อ่านภาษาไทยได้ถูกต้อง
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `partno-compare-log-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
});

// ให้ช่องสแกนได้ focus กลับเสมอเมื่อคลิกพื้นที่ว่างในหน้าสแกน (สำหรับใช้กับเครื่องสแกนบาร์โค้ด)
$('tab-scan').addEventListener('click', (e) => {
  if (e.target.closest('input, button, select, textarea, a')) return;
  if (!$('scan-b').disabled) $('scan-b').focus();
  else if (!$('scan-a').disabled) $('scan-a').focus();
});
