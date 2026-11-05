-- Run this separately in Supabase SQL Editor AFTER the owner account has registered.
-- Replace the email below with the exact email used by the owner account.
UPDATE public.profiles p
SET role = 'admin'
FROM auth.users u
WHERE p.id = u.id
  AND u.email = 'YOUR_OWNER_EMAIL_HERE';

-- Expected result: UPDATE 1. If UPDATE 0, check the email and confirm that the
-- account exists in Authentication -> Users and has a matching public.profiles row.
