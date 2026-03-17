import twilioLogo from "@/assets/twilio-logo.png";
import telnyxLogo from "@/assets/telnyx-logo.png";
import googleCalendarLogo from "@/assets/google-calendar-logo.png";
import calcomLogo from "@/assets/calcom-logo.png";
import gohighlevelLogo from "@/assets/gohighlevel-logo.png";

type ProviderMeta = {
  id: string;
  name: string;
  logo: string;
};

const logoDataUrlCache = new Map<string, Promise<string>>();

async function assetUrlToDataUrl(assetUrl: string): Promise<string> {
  const response = await fetch(assetUrl);
  const blob = await response.blob();

  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }
      reject(new Error("Failed to read logo asset"));
    };
    reader.onerror = () => reject(reader.error || new Error("Failed to read logo asset"));
    reader.readAsDataURL(blob);
  });
}

export function getCachedLogoDataUrl(assetUrl: string): Promise<string> {
  const existing = logoDataUrlCache.get(assetUrl);
  if (existing) return existing;

  const pending = assetUrlToDataUrl(assetUrl);
  logoDataUrlCache.set(assetUrl, pending);
  return pending;
}

export const PHONE_PROVIDER_META: Record<string, ProviderMeta> = {
  twilio: {
    id: "twilio",
    name: "Twilio",
    logo: twilioLogo,
  },
  telnyx: {
    id: "telnyx",
    name: "Telnyx",
    logo: telnyxLogo,
  },
};

export const CALENDAR_PROVIDER_META: Record<string, ProviderMeta> = {
  google_calendar: {
    id: "google_calendar",
    name: "Google Calendar",
    logo: googleCalendarLogo,
  },
  cal_com: {
    id: "cal_com",
    name: "Cal.com",
    logo: calcomLogo,
  },
  gohighlevel: {
    id: "gohighlevel",
    name: "GoHighLevel",
    logo: gohighlevelLogo,
  },
};
