import DashboardLayout from "@/components/DashboardLayout";
import { MessageSquare, MapPin, Bell, MessageCircle } from "lucide-react";

const supportCards = [
  {
    icon: MessageSquare,
    title: "Feedback",
    badge: "New",
    description: "Share your thoughts, suggestions, and ideas to help improve Magic Teams",
    href: "https://magicteamsai.userjot.com/board/all?cursor=1&order=top&limit=10",
  },
  {
    icon: MapPin,
    title: "Product Roadmap",
    description: "See what features and improvements are coming to Magic Teams",
    href: "https://magicteamsai.userjot.com/roadmap?cursor=1&limit=10",
  },
  {
    icon: Bell,
    title: "Product Updates",
    description: "Stay informed about the latest changes and improvements",
    href: "https://magicteamsai.userjot.com/updates?cursor=1&limit=10",
  },
  {
    icon: MessageCircle,
    title: "WhatsApp Support",
    badge: "24/7",
    description: "Get instant support from our team via WhatsApp",
    href: "https://api.whatsapp.com/send/?phone=%2B971547857926&text&type=phone_number&app_absent=0",
  },
];

export default function Support() {
  return (
    <DashboardLayout>
      <div className="space-y-6 animate-fade-in">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Support & Resources</h1>
          <p className="text-muted-foreground mt-1">
            Get help, share feedback, and stay updated with Magic Teams
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {supportCards.map((card) => (
            <a
              key={card.title}
              href={card.href}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-start gap-4 rounded-xl border border-border bg-card p-6 transition-colors hover:bg-muted"
            >
              <card.icon className="h-6 w-6 shrink-0 text-muted-foreground mt-0.5" />
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-semibold">{card.title}</span>
                  {card.badge && (
                    <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
                      {card.badge}
                    </span>
                  )}
                </div>
                <p className="text-sm text-muted-foreground">{card.description}</p>
              </div>
            </a>
          ))}
        </div>

        <div className="mt-12 flex flex-col items-center gap-4">
          <p className="text-muted-foreground text-sm">
            Need immediate assistance? Our support team is available 24/7
          </p>
          <a
            href="https://api.whatsapp.com/send/?phone=%2B971547857926&text&type=phone_number&app_absent=0"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-6 py-3 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
          >
            <MessageCircle className="h-4 w-4" />
            Contact Support on WhatsApp
          </a>
        </div>
      </div>
    </DashboardLayout>
  );
}
