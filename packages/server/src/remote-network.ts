import { Agent, fetch as undiciFetch } from 'undici';
import { AppError, ErrorCode, type PublishNetworkSettings } from '@agent-workflow/shared';

/** Remote publishing only. Connection and whole-response deadlines are independent. */
export function networkFetch(policy: PublishNetworkSettings): typeof fetch {
  return async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new AppError(ErrorCode.VALIDATION_FAILED, '发布网络地址必须是无凭据的 HTTP(S) URL');
    if (url.protocol === 'http:' && !policy.allowedHttpHosts.some((host) => host === url.hostname || host === url.host)) throw new AppError(ErrorCode.FORBIDDEN, '此 HTTP 主机未获发布网络许可，请在设置中明确添加或使用 HTTPS');
    const agent = new Agent({ connectTimeout: policy.connectTimeoutMs });
    const deadline = AbortSignal.timeout(policy.requestTimeoutMs);
    const signal = init?.signal ? AbortSignal.any([deadline, init.signal]) : deadline;
    try {
      const response = await undiciFetch(url, { ...(init as Parameters<typeof undiciFetch>[1]), dispatcher: agent, signal, redirect: 'error' });
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      if (response.body) for await (const chunk of response.body) {
        bytes += chunk.byteLength;
        if (bytes > 8 * 1024 * 1024) throw new AppError(ErrorCode.VALIDATION_FAILED, '远端响应超过8MiB读取上限');
        chunks.push(chunk);
      }
      return new Response(response.status === 204 || response.status === 205 || response.status === 304 ? null : Buffer.concat(chunks), { status: response.status, statusText: response.statusText, headers: response.headers });
    } finally { await agent.destroy(); }
  };
}
