ALTER TABLE public.profiles ALTER COLUMN onboarding_completed SET DEFAULT false; UPDATE public.profiles SET onboarding_completed = false WHERE onboarding_completed IS NULL;
