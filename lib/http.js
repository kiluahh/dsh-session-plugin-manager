import { Buffer } from 'node:buffer'

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])
export const MAX_BODY_BYTES = 16 * 1024

/**
 * 只接受本机、同源、非跨站请求。
 * @param {import('node:http').IncomingMessage} request
 */
export function isTrustedRequest(request) {
  const address = request && request.socket ? request.socket.remoteAddress : undefined
  if (typeof address !== 'string' || !LOOPBACK.has(address)) return false

  const site = header(request, 'sec-fetch-site')
  if (site === 'cross-site') return false

  const origin = header(request, 'origin')
  if (typeof origin === 'string' && origin !== '') {
    let host
    try {
      host = new URL(origin).host
    } catch {
      return false
    }
    const requestHost = header(request, 'host')
    if (typeof requestHost !== 'string' || requestHost === '' || host !== requestHost) return false
  }
  return true
}

/**
 * 读请求头（兼容数组值）。
 * @param {import('node:http').IncomingMessage} request
 * @param {string} name
 */
export function header(request, name) {
  const value = request && request.headers ? request.headers[name.toLowerCase()] : undefined
  return Array.isArray(value) ? value[0] : value
}

/**
 * 读取并解析 JSON body；空 body 视作 {}。
 * @param {import('node:http').IncomingMessage} request
 * @param {number} maxBytes
 */
export async function readJsonBody(request, maxBytes = MAX_BODY_BYTES) {
  const chunks = []
  let total = 0
  for await (const chunk of request) {
    total += chunk.length
    if (total > maxBytes) {
      const error = new Error(`request body exceeds ${maxBytes} bytes`)
      error.code = 'body-too-large'
      throw error
    }
    chunks.push(chunk)
  }
  if (total === 0) return {}
  const text = Buffer.concat(chunks).toString('utf8')
  try {
    return JSON.parse(text)
  } catch {
    const error = new Error('request body is not valid JSON')
    error.code = 'bad-json'
    throw error
  }
}

/**
 * 写 JSON 响应。
 * @param {import('node:http').ServerResponse} response
 * @param {number} status
 * @param {unknown} body
 */
export function sendJson(response, status, body) {
  const text = JSON.stringify(body)
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  response.end(text)
}

/**
 * 统一错误响应。
 * @param {import('node:http').ServerResponse} response
 * @param {number} status
 * @param {string} code
 * @param {string} message
 */
export function fail(response, status, code, message) {
  sendJson(response, status, { ok: false, error: { code, message } })
}
