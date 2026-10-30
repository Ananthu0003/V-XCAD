export interface ApiErrorDiagnostic {
  code: string;
  message: string;
  hint?: string;
}

/**
 * Universal error parser handling FastAPI detail strings/lists, validation reports,
 * structured { error: { message } }, and network HTTP codes.
 */
export function parseApiError(res?: Response | null, body?: any): ApiErrorDiagnostic {
  if (!body && !res) {
    return { code: 'UNKNOWN_ERROR', message: 'An unknown error occurred.' };
  }

  if (typeof body === 'string') {
    return {
      code: res?.status ? `HTTP_${res.status}` : 'ERROR',
      message: body,
    };
  }

  // 1. Pydantic 422 list: { detail: [{ loc: [...], msg: "...", type: "..." }] }
  if (body?.detail && Array.isArray(body.detail)) {
    const msgs = body.detail.map((d: any) => {
      const loc = Array.isArray(d.loc) ? d.loc.filter((l: any) => l !== 'body').join('.') : '';
      return loc ? `${loc}: ${d.msg || 'invalid'}` : (d.msg || 'invalid');
    });
    return {
      code: 'VALIDATION_ERROR',
      message: msgs.join('; ') || 'Validation error',
      hint: 'Check operation parameters against schema constraints.',
    };
  }

  // 2. FastAPI detail string: { detail: "..." }
  if (typeof body?.detail === 'string') {
    return {
      code: res?.status ? `HTTP_${res.status}` : 'ERROR',
      message: body.detail,
    };
  }

  // 3. Structured error: { error: { message, code, hint } }
  if (body?.error && typeof body.error === 'object') {
    return {
      code: body.error.code || (res?.status ? `HTTP_${res.status}` : 'ERROR'),
      message: body.error.message || 'Operation failed',
      hint: body.error.hint,
    };
  }

  // 4. Validation error: { validation: { error_message, error_code, suggestions } }
  if (body?.validation && typeof body.validation === 'object') {
    return {
      code: body.validation.error_code || 'GEOMETRY_FAILURE',
      message: body.validation.error_message || 'B-Rep geometry validation failed',
      hint: Array.isArray(body.validation.suggestions) ? body.validation.suggestions[0] : undefined,
    };
  }

  // 5. Direct error_diagnostic: { error_diagnostic: { code, message } }
  if (body?.error_diagnostic && typeof body.error_diagnostic === 'object') {
    return {
      code: body.error_diagnostic.code || 'ERROR',
      message: body.error_diagnostic.message || 'Operation failed',
    };
  }

  // 6. Generic message field: { message: "..." }
  if (typeof body?.message === 'string') {
    return {
      code: res?.status ? `HTTP_${res.status}` : 'ERROR',
      message: body.message,
    };
  }

  return {
    code: res?.status ? `HTTP_${res.status}` : 'ERROR',
    message: res?.statusText || 'Request failed',
  };
}

