/**
 * Attachment domain seam — the bits the upload feature shares across the Worker side
 * (server/routes.ts) AND the frontend composer (src/components/Composer.tsx). DOM-free /
 * secret-free so it bundles cleanly into both. TripDesk has no `domain/` dir (unlike
 * rebyte-app-kit, where these live in domain/agent.ts), so the single source of truth for the
 * upload cap + the wire directive lives here.
 */

/** Hard ceiling for ONE uploaded attachment, enforced on BOTH sides: the Composer rejects an
 *  oversize file before it touches the wire, and POST /api/app/files rejects it again (413) so a
 *  bypassed client can't get past it. 30 MB — bump if the relay's file API limit is higher. */
export const MAX_UPLOAD_BYTES = 30 * 1024 * 1024

/**
 * Appended to the prompt SENT TO THE RELAY when a turn carries files (never the stored UI text,
 * which stays the user's raw words / empty for an image-only send). The relay stages the bytes
 * into the sandbox at /code/<filename> but gives the manager only the PATH — no image pixels — so
 * an uploaded file still needs an explicit "open & Read it with coding_agent" nudge, or it
 * misroutes (OCR / "我看不到图"). Kept to ONE positive line; we intentionally do NOT stack
 * anti-OCR / anti-refusal / no-ask_user_question guards (mirrors rebyte-app-kit's trimmed suffix,
 * c421d97). Returns '' when there are no files.
 */
export function attachmentPromptSuffix(files: { filename: string }[]): string {
  if (!files.length) return ''
  const paths = files.map((f) => `/code/${f.filename}`).join('、')
  return `\n\n[附注] 用户上传了 ${paths}，用 coding_agent 打开并 Read（能直接看图）后回答。`
}
