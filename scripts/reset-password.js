#!/usr/bin/env node
/**
 * Reset a JINSEI password and invalidate the user's active sessions.
 * Usage: node scripts/reset-password.js <username> <new-password>
 */

try {
  process.loadEnvFile('.env');
} catch {
  // Environment variables may already be supplied by the deployment shell.
}

const [, , username, newPassword] = process.argv;

if (!username || !newPassword) {
  console.error('Usage: node scripts/reset-password.js <username> <new-password>');
  process.exit(1);
}
if (newPassword.length < 8) {
  console.error('Password must be at least 8 characters.');
  process.exit(1);
}

const { bcrypt, supabaseAdmin } = await import('../lib/server-state.js');
const client = supabaseAdmin();
const { data: user, error: lookupError } = await client
  .from('jinsei_users')
  .select('id')
  .eq('username', username)
  .maybeSingle();

if (lookupError) throw lookupError;
if (!user) {
  console.error(`No user found with username "${username}".`);
  process.exit(1);
}

const passwordHash = bcrypt.hashSync(newPassword, 12);
const { error: updateError } = await client
  .from('jinsei_users')
  .update({ password_hash: passwordHash })
  .eq('id', user.id);
if (updateError) throw updateError;

const { error: sessionError, count } = await client
  .from('jinsei_sessions')
  .delete({ count: 'exact' })
  .eq('user_id', user.id);
if (sessionError) throw sessionError;

console.log(`Password updated for "${username}". ${count || 0} active session(s) cleared.`);
