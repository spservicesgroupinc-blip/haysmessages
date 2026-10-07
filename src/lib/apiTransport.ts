export interface ResponseDetails {
  action: string;
  backendUrl: string;
  status: number;
  contentType: string;
}

export class ApiError extends Error {
  code: string;
  details?: ResponseDetails;
  constructor(message: string, code: string, details?: ResponseDetails) {
    super(message); this.code = code; this.details = details;
  }
}

interface Envelope<T> { ok: boolean; data?: T; error?: string; code?: string }

// Only read actions may be replayed automatically. A lost response to a write
// does not establish whether it committed (reactions, for example, toggle).
const READ_ACTIONS = new Set([
  'registrationInfo', 'session', 'bootstrap', 'listMessages', 'searchMessages',
  'getThread', 'getPresence', 'salesDashboard', 'pushConfig', 'pushStatus',
]);
const TEMPORARY_ERRORS = new Set(['backend_unavailable', 'backend_throttled', 'bad_response']);

function responseError(body: string, response: Response, action: string, backendUrl: string): ApiError {
  const details = { action, backendUrl, status: response.status, contentType: response.headers.get('content-type') || 'unknown' };
  const context = ` Connected workspace: ${backendUrl}`;
  if (response.status === 429 || /too many (?:scripts|requests)|service invoked too many times|quota exceeded/i.test(body)) {
    return new ApiError('Google is limiting workspace requests. Wait a moment, then retry.' + context, 'backend_throttled', details);
  }
  if (/accounts\.google\.com/.test(response.url) || /Sign in - Google Accounts|ServiceLogin|Authorization is required|You need (?:permission|access)/i.test(body)) {
    return new ApiError('Google returned an authorization page. The workspace owner needs to check web app access and authorize the script.' + context, 'deployment_access', details);
  }
  if (response.status === 404 || /Script function not found|unable to open the file|file you have requested does not exist/i.test(body)) {
    return new ApiError('This Apps Script deployment is unavailable or is missing its request handler. The workspace owner needs to republish the complete script.' + context, 'deployment_missing', details);
  }
  if (response.status >= 500 || response.status === 408 || /temporarily unavailable|try again later|too many simultaneous/i.test(body)) {
    return new ApiError('Google could not complete the workspace request. Please retry in a moment.' + context, 'backend_unavailable', details);
  }
  const format = /<(?:!doctype|html|head|body)\b/i.test(body) ? 'an HTML page' : body.trim() ? 'an invalid response' : 'an empty response';
  return new ApiError(`The workspace returned ${format} for ${action} (HTTP ${response.status}). Retry; if it continues, share this error with the workspace owner.` + context, 'bad_response', details);
}

export async function decodeResponse<T>(response: Response, action: string, backendUrl: string): Promise<T> {
  const body = await response.text();
  let envelope: Envelope<T>;
  try { envelope = JSON.parse(body.replace(/^\uFEFF/, '')); }
  catch { throw responseError(body, response, action, backendUrl); }
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope) || typeof envelope.ok !== 'boolean') {
    throw responseError(body, response, action, backendUrl);
  }
  if (!envelope.ok) {
    throw new ApiError(typeof envelope.error === 'string' ? envelope.error : 'The request failed.', typeof envelope.code === 'string' ? envelope.code : 'unknown');
  }
  if (!response.ok || !Object.hasOwn(envelope, 'data')) throw responseError(body, response, action, backendUrl);
  return envelope.data as T;
}

function retryDelay(signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(new DOMException('Request cancelled', 'AbortError')); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, 750);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
}

export async function fetchWorkspace<T>(backendUrl: string, action: string, body: string, signal: AbortSignal): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetch(backendUrl, {
        method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body,
        signal, redirect: 'follow', credentials: 'omit', cache: 'no-store',
      });
      return await decodeResponse<T>(response, action, backendUrl);
    } catch (error) {
      const transient = error instanceof ApiError ? TEMPORARY_ERRORS.has(error.code) : error instanceof TypeError;
      if (attempt !== 0 || !READ_ACTIONS.has(action) || signal.aborted || !transient) throw error;
      await retryDelay(signal);
    }
  }
}
