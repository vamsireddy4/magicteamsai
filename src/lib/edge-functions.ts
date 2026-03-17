export function isEdgeFunctionUnavailable(error: unknown) {
  const message = getErrorMessage(error).toLowerCase();

  return (
    message.includes("failed to send a request to the edge function") ||
    message.includes("edge function returned a non-2xx status code") ||
    message.includes("functionsfetcherror") ||
    message.includes("network request failed") ||
    message.includes("failed to fetch")
  );
}

export function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return "Unknown error";
}

export function getFunctionUnavailableMessage(action: string) {
  return `${action} is not available because the required Supabase Edge Function is not deployed or reachable for this project yet.`;
}
