/** Expected authentication validation/cancellation outcomes are not app failures. */
export function isExpectedErrorOutcome(message: string): boolean {
  return /Invalid login credentials|Invalid Refresh Token|New password should be different|Password is known to be weak|Password should be at least|^otp_invalid$|^Fetch is aborted$|^\[(hmr|vite)\]/i.test(message);
}