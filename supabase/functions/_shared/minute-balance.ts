export const DEFAULT_RATE_PER_MINUTE = 0.1;
export const FREE_SIGNUP_SECONDS = 300;
export const ADMIN_EMAIL = "saphaarelabs@gmail.com";

type SupabaseLike = {
  from: (table: string) => any;
  auth?: {
    admin?: {
      getUserById: (userId: string) => Promise<{ data?: { user?: { email?: string | null } | null }; error?: { message?: string } | null }>;
    };
  };
};

export type MinuteBalanceRow = {
  id: string;
  user_id: string;
  available_seconds: number;
  enterprise_rate_per_minute: number | string | null;
  last_enterprise_amount: number | string | null;
  last_enterprise_minutes: number | null;
};

export function secondsToMinutes(seconds: number) {
  return Math.floor(Math.max(0, seconds) / 60);
}

async function isUnlimitedAdmin(supabase: SupabaseLike, userId: string) {
  if (!supabase.auth?.admin?.getUserById) return false;
  const { data, error } = await supabase.auth.admin.getUserById(userId);
  if (error) throw error;
  return data?.user?.email === ADMIN_EMAIL;
}

export async function getMinuteBalance(supabase: SupabaseLike, userId: string) {
  const { data, error } = await supabase
    .from("user_minute_balances")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  return (data as MinuteBalanceRow | null) ?? null;
}

export async function ensureMinuteBalance(supabase: SupabaseLike, userId: string) {
  const existing = await getMinuteBalance(supabase, userId);
  if (existing) return existing;

  const insertPayload = {
    user_id: userId,
    available_seconds: FREE_SIGNUP_SECONDS,
    enterprise_rate_per_minute: DEFAULT_RATE_PER_MINUTE,
    last_enterprise_amount: 0,
    last_enterprise_minutes: 5,
  };

  const { data, error } = await supabase
    .from("user_minute_balances")
    .insert(insertPayload)
    .select("*")
    .single();

  if (error) throw error;

  await supabase.from("minute_transactions").insert({
    user_id: userId,
    kind: "signup_credit",
    source: "free",
    seconds_delta: FREE_SIGNUP_SECONDS,
    rate_per_minute: DEFAULT_RATE_PER_MINUTE,
    amount: 0,
    notes: "Balance created lazily with initial free signup credit",
  });

  return data as MinuteBalanceRow;
}

export async function requirePositiveBalance(supabase: SupabaseLike, userId: string) {
  if (await isUnlimitedAdmin(supabase, userId)) {
    return {
      user_id: userId,
      available_seconds: Number.POSITIVE_INFINITY,
      enterprise_rate_per_minute: DEFAULT_RATE_PER_MINUTE,
      last_enterprise_amount: 0,
      last_enterprise_minutes: null,
    } as MinuteBalanceRow;
  }
  const balance = await ensureMinuteBalance(supabase, userId);
  if ((balance.available_seconds ?? 0) <= 0) {
    throw new Error("No minutes available. Add minutes to continue.");
  }
  return balance;
}

export async function creditEnterpriseMinutes(
  supabase: SupabaseLike,
  params: {
    userId: string;
    purchaseAmount: number;
    ratePerMinute: number;
    adminEmail: string;
  },
) {
  const amount = Number(params.purchaseAmount);
  const rate = Number(params.ratePerMinute);

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Purchase amount must be greater than zero.");
  }
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new Error("Enterprise rate per minute must be greater than zero.");
  }

  const creditedMinutes = Math.floor(amount / rate);
  if (creditedMinutes <= 0) {
    throw new Error("Purchase amount is too low for the selected enterprise rate.");
  }

  const creditedSeconds = creditedMinutes * 60;
  const balance = await ensureMinuteBalance(supabase, params.userId);
  const nextAvailableSeconds = Math.max(0, Number(balance.available_seconds || 0)) + creditedSeconds;

  const { error: updateError } = await supabase
    .from("user_minute_balances")
    .update({
      available_seconds: nextAvailableSeconds,
      enterprise_rate_per_minute: rate,
      last_enterprise_amount: amount,
      last_enterprise_minutes: creditedMinutes,
    })
    .eq("user_id", params.userId);

  if (updateError) throw updateError;

  const { error: txError } = await supabase.from("minute_transactions").insert({
    user_id: params.userId,
    kind: "admin_credit",
    source: "enterprise",
    seconds_delta: creditedSeconds,
    rate_per_minute: rate,
    amount,
    notes: `Credited by ${params.adminEmail}`,
  });

  if (txError) throw txError;

  return {
    creditedMinutes,
    creditedSeconds,
    availableSeconds: nextAvailableSeconds,
    ratePerMinute: rate,
    purchaseAmount: amount,
  };
}

export async function creditPurchasedMinutes(
  supabase: SupabaseLike,
  params: {
    userId: string;
    purchaseAmount: number;
    ratePerMinute?: number;
  },
) {
  const amount = Number(params.purchaseAmount);
  const rate = Number(params.ratePerMinute ?? DEFAULT_RATE_PER_MINUTE);

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Purchase amount must be greater than zero.");
  }
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new Error("Rate per minute must be greater than zero.");
  }

  const creditedMinutes = Math.floor(amount / rate);
  if (creditedMinutes <= 0) {
    throw new Error("Purchase amount is too low to add any minutes.");
  }

  const creditedSeconds = creditedMinutes * 60;
  const balance = await ensureMinuteBalance(supabase, params.userId);
  const nextAvailableSeconds = Math.max(0, Number(balance.available_seconds || 0)) + creditedSeconds;

  const { error: updateError } = await supabase
    .from("user_minute_balances")
    .update({
      available_seconds: nextAvailableSeconds,
    })
    .eq("user_id", params.userId);

  if (updateError) throw updateError;

  const { error: txError } = await supabase.from("minute_transactions").insert({
    user_id: params.userId,
    kind: "direct_purchase",
    source: "standard",
    seconds_delta: creditedSeconds,
    rate_per_minute: rate,
    amount,
    notes: "Direct plan purchase",
  });

  if (txError) throw txError;

  return {
    creditedMinutes,
    creditedSeconds,
    availableSeconds: nextAvailableSeconds,
    ratePerMinute: rate,
    purchaseAmount: amount,
  };
}

export async function deductMinutesForCall(
  supabase: SupabaseLike,
  params: {
    userId: string;
    callLogId: string;
    durationSeconds: number;
    kind: "demo_deduction" | "live_deduction";
  },
) {
  if (await isUnlimitedAdmin(supabase, params.userId)) {
    const { error: updateLogError } = await supabase
      .from("call_logs")
      .update({
        billing_status: "charged",
        billing_source: "admin_unlimited",
        billed_seconds: 0,
        billed_minutes: 0,
        billed_rate_per_minute: 0,
        billed_amount: 0,
      })
      .eq("id", params.callLogId)
      .eq("user_id", params.userId);

    if (updateLogError) throw updateLogError;

    return {
      billedSeconds: 0,
      alreadyBilled: false,
      unlimitedAdmin: true,
    };
  }

  const roundedSeconds = Math.max(0, Math.round(Number(params.durationSeconds || 0)));

  const { data: existingLog, error: logError } = await supabase
    .from("call_logs")
    .select("id, billing_status, billed_seconds")
    .eq("id", params.callLogId)
    .eq("user_id", params.userId)
    .maybeSingle();

  if (logError) throw logError;
  if (!existingLog) throw new Error("Call log not found for billing.");
  if (existingLog.billing_status === "charged") {
    return {
      billedSeconds: existingLog.billed_seconds ?? 0,
      alreadyBilled: true,
    };
  }

  const balance = await ensureMinuteBalance(supabase, params.userId);
  const currentAvailableSeconds = Math.max(0, Number(balance.available_seconds || 0));
  const billedSeconds = Math.min(currentAvailableSeconds, roundedSeconds);
  const rate = Number(balance.enterprise_rate_per_minute ?? DEFAULT_RATE_PER_MINUTE);
  const billedAmount = Number(((billedSeconds / 60) * rate).toFixed(2));

  const { error: updateBalanceError } = await supabase
    .from("user_minute_balances")
    .update({
      available_seconds: Math.max(0, currentAvailableSeconds - billedSeconds),
    })
    .eq("user_id", params.userId);

  if (updateBalanceError) throw updateBalanceError;

  const { error: txError } = await supabase.from("minute_transactions").insert({
    user_id: params.userId,
    call_log_id: params.callLogId,
    kind: params.kind,
    source: Number(balance.enterprise_rate_per_minute ?? 0) !== DEFAULT_RATE_PER_MINUTE ? "enterprise" : "standard",
    seconds_delta: billedSeconds * -1,
    rate_per_minute: rate,
    amount: billedAmount,
    notes: params.kind === "demo_deduction" ? "Demo call deduction" : "Live call deduction",
  });

  if (txError) throw txError;

  const { error: updateLogError } = await supabase
    .from("call_logs")
    .update({
      billing_status: "charged",
      billing_source: Number(balance.enterprise_rate_per_minute ?? 0) !== DEFAULT_RATE_PER_MINUTE ? "enterprise" : "standard",
      billed_seconds: billedSeconds,
      billed_minutes: secondsToMinutes(billedSeconds),
      billed_rate_per_minute: rate,
      billed_amount: billedAmount,
    })
    .eq("id", params.callLogId)
    .eq("user_id", params.userId);

  if (updateLogError) throw updateLogError;

  return {
    billedSeconds,
    billedAmount,
    alreadyBilled: false,
  };
}
