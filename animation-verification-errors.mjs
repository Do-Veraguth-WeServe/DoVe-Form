// Only app-owned codes/messages cross the verifier boundary, never guest exception text.
const hints = Object.freeze({
 HTML: 'Use supported HTML: safe IDs, allowed tags/attributes/input types; no inline handlers or URL values.',
 TARGET: 'Ensure every animation target exists exactly once after startup.',
 STARTUP: 'Fix guest startup errors; use only supported ui APIs and bounded computation.',
 BUDGET: 'Simplify declared clips to fit the total 16-second verification budget.',
 EXECUTION: 'Fix declared clip execution; use supported targets and animation operations.',
 DEADLINE: 'Reduce startup and animation work to fit the isolated verification deadline.',
 CANCELLED: 'Verification was cancelled.',
 INTERNAL: 'Isolated verifier unavailable or rejected the artifact.'
});
export function verificationFailure(code) {
 const safe = Object.hasOwn(hints, code) ? code : 'INTERNAL';
 return {code:safe, message:'Animation browser verification rejected ['+safe+']: '+hints[safe]};
}
export function verificationError(code, message) {
 return Object.assign(new Error(message), {verificationCode:verificationFailure(code).code});
}
