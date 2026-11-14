'use strict';
// Public submission endpoint. No login; database records are not publicly readable.
window.BasmatiDB = (() => {
  function config() {
    const c = window.APP_CONFIG || {};
    const url = new URL(c.SUPABASE_URL || 'https://invalid.local');
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash ||
        /YOUR_PROJECT|invalid\.local/.test(url.host) || !c.SUPABASE_ANON_KEY ||
        c.SUPABASE_ANON_KEY.startsWith('YOUR_')) {
      throw new Error('الخدمة غير جاهزة حاليًا. يُرجى التواصل مع مسؤولة النموذج.');
    }
    if (c.SUPABASE_ANON_KEY.startsWith('sb_secret_')) throw new Error('الخدمة غير جاهزة حاليًا. يُرجى التواصل مع مسؤولة النموذج.');
    return {url: url.origin, key: c.SUPABASE_ANON_KEY};
  }
  async function request(path, payload, timeoutMessage) {
    const c = config();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25000);
    try {
      const response = await fetch(c.url + '/rest/v1/rpc/' + path, {
        method: 'POST', signal: controller.signal,
        headers: {'Content-Type': 'application/json', apikey: c.key,
          ...(c.key.split('.').length === 3 ? {Authorization: 'Bearer ' + c.key} : {})},
        body: JSON.stringify(payload)
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) {
        console.error('Database request failed', {path, status: response.status, code: result?.code});
        if (timeoutMessage) throw new Error(timeoutMessage);
        if (result?.code === '22023') throw new Error('تعذّر اعتماد البيانات. راجعي الحقول والشواهد وحاولي مجددًا.');
        throw new Error('لم يكتمل إرسال التقييم. احتُفظ بالمسودة؛ أعيدي المحاولة.');
      }
      return result;
    } catch (error) {
      if (error.name === 'AbortError') throw new Error(timeoutMessage || 'انتهت مهلة الاتصال. احتُفظ بالمسودة؛ أعيدي المحاولة للتحقق من الحفظ.');
      if (error instanceof TypeError) throw new Error(timeoutMessage || 'تعذّر الاتصال بالإنترنت. احتُفظ بالمسودة؛ أعيدي المحاولة.');
      throw error;
    } finally { clearTimeout(timer); }
  }
  async function submit(record, deleteToken) {
    const result = await request('submit_basmati_evaluation', {p_id: record.id, p_data: record, p_delete_token: deleteToken});
    if (!result || result.id !== record.id || !result.saved_at) throw new Error('لم يكتمل إرسال التقييم. أعيدي المحاولة.');
    return result;
  }
  async function remove(id, deleteToken) {
    const result = await request('delete_basmati_evaluation', {p_id: id, p_delete_token: deleteToken}, 'تعذّر حذف السجل حاليًا. أعيدي المحاولة لاحقًا.');
    if (!result || result.id !== id || result.deleted !== true) throw new Error('لم يكتمل حذف السجل. أعيدي المحاولة.');
    return result;
  }
  return {submit, remove};
})();
